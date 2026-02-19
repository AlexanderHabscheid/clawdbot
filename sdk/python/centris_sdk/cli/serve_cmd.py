"""
Centris SDK CLI - Serve Command

Start a local development server with MCP endpoints and playground UI.
"""

import click
import json
import asyncio
import sys
import importlib.util
from pathlib import Path
from typing import Optional, Any


def load_connector(path: Path) -> Any:
    """Load connector module from path."""
    connector_py = path / "connector.py"
    if not connector_py.exists():
        raise FileNotFoundError(f"connector.py not found in {path}")
    
    sys.path.insert(0, str(path))
    
    try:
        spec = importlib.util.spec_from_file_location("connector", connector_py)
        if spec is None or spec.loader is None:
            raise ImportError("Cannot load connector module")
        
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        
        if hasattr(module, "connector"):
            return module.connector
        elif hasattr(module, "plugin"):
            return module.plugin
        else:
            raise AttributeError("No 'connector' or 'plugin' export found")
    finally:
        sys.path.remove(str(path))


PLAYGROUND_HTML = '''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{name} - Centris Connector Playground</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            color: #e0e0e0;
        }}
        .container {{
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
        }}
        header {{
            text-align: center;
            margin-bottom: 2rem;
        }}
        h1 {{
            color: #7c3aed;
            margin-bottom: 0.5rem;
        }}
        .subtitle {{
            color: #a0a0a0;
        }}
        .grid {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 2rem;
        }}
        .panel {{
            background: rgba(255, 255, 255, 0.05);
            border-radius: 12px;
            padding: 1.5rem;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }}
        .panel h2 {{
            color: #7c3aed;
            margin-bottom: 1rem;
            font-size: 1.1rem;
        }}
        .capability {{
            background: rgba(0, 0, 0, 0.2);
            padding: 1rem;
            border-radius: 8px;
            margin-bottom: 0.5rem;
            cursor: pointer;
            transition: all 0.2s;
        }}
        .capability:hover {{
            background: rgba(124, 58, 237, 0.2);
        }}
        .capability.selected {{
            background: rgba(124, 58, 237, 0.3);
            border: 1px solid #7c3aed;
        }}
        .capability h3 {{
            font-size: 0.9rem;
            margin-bottom: 0.25rem;
        }}
        .capability p {{
            font-size: 0.8rem;
            color: #a0a0a0;
        }}
        textarea, input {{
            width: 100%;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            padding: 0.75rem;
            color: #e0e0e0;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 0.85rem;
        }}
        textarea {{
            min-height: 200px;
            resize: vertical;
        }}
        textarea:focus, input:focus {{
            outline: none;
            border-color: #7c3aed;
        }}
        button {{
            background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%);
            color: white;
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.2s;
            margin-top: 1rem;
        }}
        button:hover {{
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(124, 58, 237, 0.4);
        }}
        button:disabled {{
            opacity: 0.5;
            cursor: not-allowed;
        }}
        .result {{
            background: rgba(0, 0, 0, 0.3);
            border-radius: 6px;
            padding: 1rem;
            margin-top: 1rem;
            font-family: monospace;
            font-size: 0.85rem;
            white-space: pre-wrap;
            overflow-x: auto;
        }}
        .result.error {{
            border: 1px solid #ef4444;
            color: #fca5a5;
        }}
        .result.success {{
            border: 1px solid #10b981;
        }}
        .info {{
            font-size: 0.8rem;
            color: #a0a0a0;
            margin-top: 1rem;
        }}
        .endpoints {{
            margin-top: 2rem;
            padding: 1rem;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 8px;
        }}
        .endpoints h3 {{
            color: #7c3aed;
            margin-bottom: 0.5rem;
        }}
        .endpoint {{
            font-family: monospace;
            font-size: 0.85rem;
            margin: 0.25rem 0;
        }}
        .endpoint a {{
            color: #a855f7;
            text-decoration: none;
        }}
        .endpoint a:hover {{
            text-decoration: underline;
        }}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>{name}</h1>
            <p class="subtitle">{description}</p>
        </header>
        
        <div class="grid">
            <div class="panel">
                <h2>Capabilities</h2>
                <div id="capabilities"></div>
            </div>
            
            <div class="panel">
                <h2>Test</h2>
                <div id="test-area">
                    <p style="color: #a0a0a0;">Select a capability to test</p>
                </div>
            </div>
        </div>
        
        <div class="endpoints">
            <h3>API Endpoints</h3>
            <div class="endpoint">MCP Tools: <a href="/mcp/tools" target="_blank">/mcp/tools</a></div>
            <div class="endpoint">MCP Execute: POST /mcp/execute</div>
            <div class="endpoint">Health: <a href="/health" target="_blank">/health</a></div>
            <div class="endpoint">Agent Card: <a href="/.well-known/agent.json" target="_blank">/.well-known/agent.json</a></div>
        </div>
    </div>
    
    <script>
        const capabilities = {capabilities_json};
        let selectedCapability = null;
        
        function renderCapabilities() {{
            const container = document.getElementById('capabilities');
            container.innerHTML = capabilities.map(cap => `
                <div class="capability" data-id="${{cap.id}}" onclick="selectCapability('${{cap.id}}')">
                    <h3>${{cap.name}}</h3>
                    <p>${{cap.description}}</p>
                </div>
            `).join('');
        }}
        
        function selectCapability(id) {{
            selectedCapability = capabilities.find(c => c.id === id);
            
            document.querySelectorAll('.capability').forEach(el => {{
                el.classList.toggle('selected', el.dataset.id === id);
            }});
            
            const testArea = document.getElementById('test-area');
            const schema = selectedCapability.input_schema || {{}};
            const sampleInput = generateSampleInput(schema);
            
            testArea.innerHTML = `
                <label>Input Parameters (JSON):</label>
                <textarea id="input-params">${{JSON.stringify(sampleInput, null, 2)}}</textarea>
                <button onclick="executeCapability()">Execute</button>
                <div id="result"></div>
            `;
        }}
        
        function generateSampleInput(schema) {{
            if (schema.type !== 'object') return {{}};
            const result = {{}};
            for (const [key, prop] of Object.entries(schema.properties || {{}})) {{
                if (prop.type === 'string') result[key] = prop.default || 'example';
                else if (prop.type === 'number') result[key] = prop.default || 0;
                else if (prop.type === 'boolean') result[key] = prop.default || true;
            }}
            return result;
        }}
        
        async function executeCapability() {{
            if (!selectedCapability) return;
            
            const inputEl = document.getElementById('input-params');
            const resultEl = document.getElementById('result');
            
            let params;
            try {{
                params = JSON.parse(inputEl.value);
            }} catch (e) {{
                resultEl.className = 'result error';
                resultEl.textContent = 'Invalid JSON: ' + e.message;
                return;
            }}
            
            resultEl.className = 'result';
            resultEl.textContent = 'Executing...';
            
            try {{
                const response = await fetch('/mcp/execute', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{
                        tool: selectedCapability.id,
                        params: params
                    }})
                }});
                
                const data = await response.json();
                
                if (data.success) {{
                    resultEl.className = 'result success';
                    resultEl.textContent = JSON.stringify(data.data, null, 2);
                }} else {{
                    resultEl.className = 'result error';
                    resultEl.textContent = 'Error: ' + (data.error?.message || 'Unknown error');
                }}
            }} catch (e) {{
                resultEl.className = 'result error';
                resultEl.textContent = 'Request failed: ' + e.message;
            }}
        }}
        
        renderCapabilities();
    </script>
</body>
</html>
'''


@click.command("serve")
@click.argument("path", type=click.Path(exists=True), default=".")
@click.option("--port", "-p", default=8000, help="Port to listen on")
@click.option("--host", "-h", default="127.0.0.1", help="Host to bind to")
@click.option("--reload", is_flag=True, help="Enable auto-reload on changes")
@click.option("--no-playground", is_flag=True, help="Disable playground UI")
@click.pass_context
def serve_command(
    ctx: click.Context,
    path: str,
    port: int,
    host: str,
    reload: bool,
    no_playground: bool,
) -> None:
    """
    Start a local development server.
    
    Provides:
    - MCP endpoints (/mcp/tools, /mcp/execute)
    - Playground UI for testing
    - Health check endpoint
    - Agent card endpoint
    
    Examples:
        centris serve .
        centris serve . --port 3000
        centris serve . --reload
    """
    verbose = ctx.obj.get("verbose", False)
    connector_path = Path(path).resolve()
    
    click.echo(f"Starting server for connector at: {connector_path}")
    
    # Load connector
    try:
        connector = load_connector(connector_path)
        click.echo(f"Loaded connector: {connector.name}")
    except Exception as e:
        click.echo(click.style(f"Failed to load connector: {e}", fg="red"))
        sys.exit(1)
    
    # Try to import FastAPI
    try:
        from fastapi import FastAPI, Request
        from fastapi.responses import HTMLResponse, JSONResponse
        import uvicorn
    except ImportError:
        click.echo(click.style("FastAPI not installed. Install with: pip install fastapi uvicorn", fg="red"))
        sys.exit(1)
    
    # Create FastAPI app
    app = FastAPI(
        title=connector.name,
        description=connector.card.description,
        version=connector.card.version,
    )
    
    # Health endpoint
    @app.get("/health")
    async def health():
        return {"status": "healthy", "connector": connector.id}
    
    # MCP Tools endpoint
    @app.get("/mcp/tools")
    async def mcp_tools():
        return connector.to_mcp_schema()
    
    # MCP Execute endpoint
    @app.post("/mcp/execute")
    async def mcp_execute(request: Request):
        body = await request.json()
        tool = body.get("tool")
        params = body.get("params", {})
        
        result = await connector.execute(tool, params)
        
        return {
            "success": result.success,
            "data": result.data,
            "error": {"message": result.error.message} if result.error else None,
        }
    
    # Agent card endpoint
    @app.get("/.well-known/agent.json")
    async def agent_card():
        return connector.to_agent_card()
    
    # Playground UI
    if not no_playground:
        @app.get("/", response_class=HTMLResponse)
        async def playground():
            capabilities = [
                {
                    "id": cap.id,
                    "name": cap.name,
                    "description": cap.description,
                    "input_schema": cap.input_schema,
                }
                for cap in connector.capabilities
            ]
            
            html = PLAYGROUND_HTML.format(
                name=connector.name,
                description=connector.card.description,
                capabilities_json=json.dumps(capabilities),
            )
            return HTMLResponse(content=html)
    
    # Print info
    click.echo()
    click.echo(click.style("Server running!", fg="green", bold=True))
    click.echo()
    click.echo(f"  Playground: http://{host}:{port}/")
    click.echo(f"  MCP Tools:  http://{host}:{port}/mcp/tools")
    click.echo(f"  Health:     http://{host}:{port}/health")
    click.echo(f"  Agent Card: http://{host}:{port}/.well-known/agent.json")
    click.echo()
    click.echo("Press Ctrl+C to stop")
    click.echo()
    
    # Run server
    uvicorn.run(app, host=host, port=port, reload=reload, log_level="info" if verbose else "warning")
