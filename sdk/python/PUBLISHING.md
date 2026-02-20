# Publishing centris-sdk to PyPI

This guide covers publishing the Centris SDK to PyPI so developers can `pip install centris-sdk`.

## Prerequisites

1. **PyPI Account**: Create accounts on [PyPI](https://pypi.org) and [TestPyPI](https://test.pypi.org)
2. **API Tokens**: Generate API tokens for authentication
3. **Build Tools**: `pip install build twine`

## Quick Publish (Production)

```bash
cd sdk/python

# Build the package
python -m build

# Upload to PyPI
python -m twine upload dist/*
```

## Step-by-Step Guide

### 1. Set Up Authentication

Create `~/.pypirc`:

```ini
[distutils]
index-servers =
    pypi
    testpypi

[pypi]
username = __token__
password = pypi-YOUR_API_TOKEN_HERE

[testpypi]
username = __token__
password = pypi-YOUR_TESTPYPI_TOKEN_HERE
```

Or use environment variables:

```bash
export TWINE_USERNAME=__token__
export TWINE_PASSWORD=pypi-YOUR_API_TOKEN
```

### 2. Clean Previous Builds

```bash
rm -rf dist/ build/ *.egg-info/
```

### 3. Build the Package

```bash
python -m build
```

This creates:

- `dist/centris_sdk-1.0.0-py3-none-any.whl` (wheel)
- `dist/centris_sdk-1.0.0.tar.gz` (source)

### 4. Test on TestPyPI First

```bash
python -m twine upload --repository testpypi dist/*
```

Verify installation:

```bash
pip install --index-url https://test.pypi.org/simple/ centris-sdk
```

### 5. Upload to Production PyPI

```bash
python -m twine upload dist/*
```

### 6. Verify Installation

```bash
pip install centris-sdk
centris-py --version
```

## Version Bumping

Update version in `pyproject.toml`:

```toml
[project]
name = "centris-sdk"
version = "1.0.1"  # Bump this
```

## Automation Script

Use the publish script:

```bash
./scripts/publish-pypi.sh
```

Or with options:

```bash
./scripts/publish-pypi.sh --test    # Publish to TestPyPI
./scripts/publish-pypi.sh --version 1.0.1  # Set version
```

## Troubleshooting

### "File already exists"

You can't overwrite existing versions. Bump the version number.

### "Invalid API token"

Regenerate your token on PyPI and update `~/.pypirc`.

### "Package name taken"

The name `centris-sdk` should be available. If not, use `centris-ai-sdk`.

## Package Details

**Name**: centris-sdk  
**Author**: Centris AI  
**License**: MIT  
**Python**: >=3.10

**Dependencies**:

- click>=8.0.0
- httpx>=0.25.0

**Optional Dependencies**:

- `centris-sdk[server]` - FastAPI server for MCP gateway
- `centris-sdk[browser]` - Playwright for browser automation
- `centris-sdk[desktop]` - PyAutoGUI for desktop automation
- `centris-sdk[all]` - All optional dependencies
- `centris-sdk[dev]` - Development tools (pytest, black, etc.)

## Entry Points

The package registers:

- **CLI**: `centris-py` command
- **Entry Point Group**: `centris.connectors` for connector discovery

## Post-Publication

After publishing:

1. Update documentation at docs.centris.ai/sdk
2. Announce on Discord/Twitter
3. Tag release in Git: `git tag v1.0.0 && git push --tags`
