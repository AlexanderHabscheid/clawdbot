"""
Centris SDK CLI - Refine Command

AI-assisted connector refinement.

Takes a template-generated connector and uses LLM to:
1. Intelligently map data fields to element IDs
2. Generate robust automation logic
3. Add error handling and retries
4. Create comprehensive tests

Usage:
    centris refine ./my-connector
"""

import asyncio
import click
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from centris_sdk.cli.theme import theme
from centris_sdk.cli.progress import Spinner
from centris_sdk.cli.deps import CLIDeps, create_default_deps
from centris_sdk.cli.errors import CentrisCLIError


# =============================================================================
# AI Refinement Prompts
# =============================================================================

REFINEMENT_SYSTEM_PROMPT = """You are a Centris connector development expert.

Your task is to refine a browser automation connector by:
1. Mapping data fields to the correct element IDs
2. Generating robust automation code
3. Adding proper error handling
4. Creating field validation

Context:
- Centris uses runtime node IDs from live browser snapshots
- Elements have types: typeable (input fields), clickable (buttons), selectable (dropdowns)
- The connector should use browser_bridge methods: click_node, type_text, wait, press_key

Output ONLY valid Python code that can be directly written to connector.py.
"""

FIELD_MAPPING_PROMPT = """Given these form elements from the page:
{elements}

And this data structure to fill:
{data_structure}

Create a FIELD_MAPPING dictionary that maps data paths to element IDs.

Example output:
FIELD_MAPPING = {
    "company.name": 19,  # Company name field
    "company.url": 21,   # Company URL field
    "founders.count": 15, # Number of founders
}

Rules:
- Match field meanings, not just names
- Skip elements that don't have matching data
- Use dot notation for nested data paths
- Add comments explaining the mapping
"""


# =============================================================================
# AI Client
# =============================================================================

class AIClient:
    """
    Client for AI-assisted refinement.
    
    Supports multiple providers:
    - OpenAI (gpt-4o, gpt-4-turbo)
    - Anthropic (claude-3.5-sonnet)
    - DeepSeek (deepseek-chat)
    - Local (ollama)
    """
    
    def __init__(self, model: str = "auto"):
        self.model = model
        self._client = None
    
    def _detect_provider(self) -> str:
        """Auto-detect available provider from environment."""
        import os
        
        if os.environ.get("OPENAI_API_KEY"):
            return "openai"
        elif os.environ.get("ANTHROPIC_API_KEY"):
            return "anthropic"
        elif os.environ.get("DEEPSEEK_API_KEY"):
            return "deepseek"
        else:
            raise CentrisCLIError(
                "No AI provider configured",
                hint="Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or DEEPSEEK_API_KEY"
            )
    
    async def complete(
        self,
        system: str,
        user: str,
        max_tokens: int = 4096,
    ) -> str:
        """Generate completion from AI provider."""
        import os
        
        model = self.model
        if model == "auto":
            provider = self._detect_provider()
            model = {
                "openai": "gpt-4o",
                "anthropic": "claude-3-5-sonnet-20241022",
                "deepseek": "deepseek-chat",
            }[provider]
        
        # Determine provider from model name
        if "gpt" in model or "o1" in model:
            return await self._openai_complete(model, system, user, max_tokens)
        elif "claude" in model:
            return await self._anthropic_complete(model, system, user, max_tokens)
        elif "deepseek" in model:
            return await self._deepseek_complete(model, system, user, max_tokens)
        else:
            raise CentrisCLIError(f"Unknown model: {model}")
    
    async def _openai_complete(
        self, model: str, system: str, user: str, max_tokens: int
    ) -> str:
        """OpenAI completion."""
        try:
            import openai
        except ImportError:
            raise CentrisCLIError(
                "openai package required",
                hint="pip install openai"
            )
        
        import os
        client = openai.AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            max_tokens=max_tokens,
        )
        
        return response.choices[0].message.content
    
    async def _anthropic_complete(
        self, model: str, system: str, user: str, max_tokens: int
    ) -> str:
        """Anthropic completion."""
        try:
            import anthropic
        except ImportError:
            raise CentrisCLIError(
                "anthropic package required",
                hint="pip install anthropic"
            )
        
        import os
        client = anthropic.AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        
        response = await client.messages.create(
            model=model,
            system=system,
            messages=[{"role": "user", "content": user}],
            max_tokens=max_tokens,
        )
        
        return response.content[0].text
    
    async def _deepseek_complete(
        self, model: str, system: str, user: str, max_tokens: int
    ) -> str:
        """DeepSeek completion (OpenAI-compatible API)."""
        try:
            import openai
        except ImportError:
            raise CentrisCLIError(
                "openai package required",
                hint="pip install openai"
            )
        
        import os
        client = openai.AsyncOpenAI(
            api_key=os.environ.get("DEEPSEEK_API_KEY"),
            base_url="https://api.deepseek.com/v1"
        )
        
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            max_tokens=max_tokens,
        )
        
        return response.choices[0].message.content


# =============================================================================
# Refinement Logic
# =============================================================================

async def refine_connector(
    connector_path: Path,
    data_file: Optional[Path] = None,
    model: str = "auto",
) -> Dict[str, Any]:
    """
    Use AI to refine a connector's field mappings and automation logic.
    
    Args:
        connector_path: Path to connector directory
        data_file: Optional JSON file with data structure to map
        model: AI model to use
    
    Returns:
        Refinement results
    """
    # Load connector manifest
    manifest_path = connector_path / "connector.json"
    if not manifest_path.exists():
        raise CentrisCLIError(
            f"No connector.json found in {connector_path}",
            hint="Run 'centris init' first to create a connector"
        )
    
    manifest = json.loads(manifest_path.read_text())
    
    # Load element mapping
    element_mapping = manifest.get("elementMapping", {})
    if not element_mapping:
        raise CentrisCLIError(
            "No element mapping found in connector.json",
            hint="Use runtime route recording and action APIs to build connector behavior"
        )
    
    # Load data structure (if provided)
    data_structure = {}
    if data_file and data_file.exists():
        data_structure = json.loads(data_file.read_text())
    
    # Format elements for AI
    elements_str = json.dumps(element_mapping, indent=2)
    data_str = json.dumps(data_structure, indent=2) if data_structure else "Not provided - infer from element labels"
    
    # Call AI
    ai = AIClient(model=model)
    
    prompt = FIELD_MAPPING_PROMPT.format(
        elements=elements_str,
        data_structure=data_str,
    )
    
    response = await ai.complete(
        system=REFINEMENT_SYSTEM_PROMPT,
        user=prompt,
    )
    
    return {
        "success": True,
        "refinement": response,
        "model": model,
    }


# =============================================================================
# CLI Command
# =============================================================================

@click.command("refine")
@click.argument("connector_path", type=click.Path(exists=True))
@click.option("--data", "-d", type=click.Path(exists=True), help="JSON file with data structure to map")
@click.option("--model", "-m", default="auto", help="AI model (auto, gpt-4o, claude-3.5-sonnet, deepseek)")
@click.option("--dry-run", is_flag=True, help="Show refinement without applying")
@click.pass_context
def refine_command(
    ctx: click.Context,
    connector_path: str,
    data: Optional[str],
    model: str,
    dry_run: bool,
) -> None:
    """
    Use AI to refine a connector's field mappings.
    
    Takes a template-generated connector and uses LLM to intelligently
    map data fields to element IDs.
    
    Examples:
        centris refine ./my-connector
        centris refine ./my-connector --data data.json
        centris refine ./my-connector --model claude-3.5-sonnet
    """
    _ = ctx
    _ = connector_path
    _ = data
    _ = model
    _ = dry_run
    raise CentrisCLIError(
        "centris refine is no longer supported in migrated runtime.",
        hint=(
            "Use runtime Action API route recording and verification "
            "instead of element-mapping refinement."
        ),
    )
    
    if dry_run:
        console.echo(f"\n{theme.muted('(dry run - no files modified)')}")
    else:
        # Apply refinement
        console.echo(f"\n{theme.heading('Next steps:')}")
        console.echo(f"  1. Review the suggested FIELD_MAPPING above")
        console.echo(f"  2. Copy into your connector.py")
        console.echo(f"  3. Run: centris validate {connector_path}")


__all__ = ["refine_command", "AIClient", "refine_connector"]
