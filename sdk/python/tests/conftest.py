"""
Shared test fixtures for Centris SDK tests.

Follows Clawdbot pattern: reusable fixtures for isolation and mocking.
"""

import os
import sys
import json
import tempfile
import pytest
from pathlib import Path
from typing import Any, Dict, Generator
from unittest.mock import MagicMock, AsyncMock


# =============================================================================
# Environment Fixtures
# =============================================================================

@pytest.fixture
def clean_env() -> Generator[Dict[str, str], None, None]:
    """Provide a clean environment with no Centris vars."""
    original = os.environ.copy()
    
    # Remove Centris-related vars
    for key in list(os.environ.keys()):
        if "CENTRIS" in key or "DEEPSEEK" in key or "OPENAI" in key:
            del os.environ[key]
    
    yield os.environ
    
    # Restore
    os.environ.clear()
    os.environ.update(original)


@pytest.fixture
def mock_env(clean_env: Dict[str, str]) -> Dict[str, str]:
    """Provide mock environment with test API key."""
    clean_env["CENTRIS_API_KEY"] = "ck_test_mock_key_123"
    clean_env["CENTRIS_API_URL"] = "http://localhost:9999"
    return clean_env


# =============================================================================
# Temporary Directory Fixtures
# =============================================================================

@pytest.fixture
def temp_dir() -> Generator[Path, None, None]:
    """Create a temporary directory for test files."""
    with tempfile.TemporaryDirectory(prefix="centris_test_") as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def temp_connector(temp_dir: Path) -> Path:
    """Create a minimal connector project structure."""
    connector_json = {
        "id": "test-connector",
        "name": "Test Connector",
        "description": "A test connector",
        "version": "1.0.0",
        "capabilities": [
            {"id": "test_action", "name": "Test Action"}
        ]
    }
    
    connector_py = '''"""Test connector."""
from centris_sdk import CentrisConnector

connector = CentrisConnector(
    connector_id="test-connector",
    name="Test Connector",
    description="A test connector",
)

@connector.capability(
    id="test_action",
    name="Test Action",
    description="A test action",
    input_schema={"type": "object", "properties": {"message": {"type": "string"}}},
)
async def test_action(params: dict, context: dict) -> dict:
    return {"ok": True, "message": params.get("message", "")}

__all__ = ["connector"]
'''
    
    (temp_dir / "connector.json").write_text(json.dumps(connector_json, indent=2))
    (temp_dir / "connector.py").write_text(connector_py)
    
    return temp_dir


@pytest.fixture
def invalid_connector(temp_dir: Path) -> Path:
    """Create a connector project with validation errors."""
    # Missing required fields
    connector_json = {"name": "Invalid"}
    (temp_dir / "connector.json").write_text(json.dumps(connector_json))
    
    # Syntax error in Python
    (temp_dir / "connector.py").write_text("def broken(:\n    pass")
    
    return temp_dir


# =============================================================================
# Mock Fixtures
# =============================================================================

@pytest.fixture
def mock_httpx_client() -> MagicMock:
    """Create a mock httpx client."""
    mock = MagicMock()
    mock.post = MagicMock()
    mock.get = MagicMock()
    mock.close = MagicMock()
    mock.__enter__ = MagicMock(return_value=mock)
    mock.__exit__ = MagicMock(return_value=False)
    return mock


@pytest.fixture
def mock_response() -> MagicMock:
    """Create a mock HTTP response."""
    response = MagicMock()
    response.status_code = 200
    response.json = MagicMock(return_value={
        "task_id": "ctask_test123",
        "status": "completed",
        "result": "Test completed",
        "actions": [],
    })
    return response


# =============================================================================
# CLI Fixtures  
# =============================================================================

@pytest.fixture
def cli_runner():
    """Create a Click test runner."""
    from click.testing import CliRunner
    return CliRunner()


@pytest.fixture
def mock_runtime():
    """Create a mock runtime for CLI testing."""
    from centris_sdk.cli.runtime import MockRuntime
    return MockRuntime()


@pytest.fixture
def mock_deps(temp_dir: Path, request):
    """Create mock CLI dependencies.
    
    Uses temp_dir if the test is in centris_sdk/cli/ (colocated test),
    otherwise uses a fresh temp directory.
    """
    from centris_sdk.cli.deps import MockRuntime as DepsMockRuntime
    
    class MockFileSystem:
        def __init__(self, base: Path):
            self.base = base
            
        def exists(self, path: Path) -> bool:
            return path.exists()
        
        def read_text(self, path: Path) -> str:
            return path.read_text()
        
        def write_text(self, path: Path, content: str) -> None:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        
        def mkdir(self, path: Path, parents: bool = False, exist_ok: bool = False) -> None:
            path.mkdir(parents=parents, exist_ok=exist_ok)
    
    class MockConsole:
        def __init__(self):
            self.output: list[str] = []
            
        def echo(self, msg: str, **kwargs: Any) -> None:
            self.output.append(msg)
            
        def print(self, *args: Any, **kwargs: Any) -> None:
            self.output.append(" ".join(str(a) for a in args))
            
        def error(self, msg: str) -> None:
            self.output.append(f"ERROR: {msg}")
            
        def warn(self, msg: str) -> None:
            self.output.append(f"WARN: {msg}")
            
        def success(self, msg: str) -> None:
            self.output.append(f"OK: {msg}")
            
        def info(self, msg: str) -> None:
            self.output.append(f"INFO: {msg}")
    
    class MockConfigLoader:
        def load(self) -> Dict[str, Any]:
            return {}
        
        def get(self, key: str, default: Any = None) -> Any:
            return default
        
        def get_settings(self) -> None:
            return None
    
    class MockBackendClient:
        async def health_check(self) -> Dict[str, Any]:
            return {"status": "ok"}
        
        async def get_status(self) -> Dict[str, Any]:
            return {"status": "running"}
        
        def is_available(self) -> bool:
            return False
    
    # Import here to avoid circular deps
    from centris_sdk.cli.deps import CLIDeps
    import logging
    
    return CLIDeps(
        console=MockConsole(),
        config_loader=MockConfigLoader(),
        backend_client=MockBackendClient(),
        file_system=MockFileSystem(temp_dir),
        logger=logging.getLogger("test"),
        verbose=False,
        quiet=False,
        json_output=False,
    )
