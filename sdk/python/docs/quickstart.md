# Installation and quickstart

## Requirements

From `sdk/python/pyproject.toml`:

- Python `>=3.10`

## Install options

```bash
# Core
pip install centris-sdk

# All optional features
pip install centris-sdk[all]
```

Optional extras from package metadata:

- `server`: FastAPI + uvicorn
- `browser`: Playwright
- `desktop`: pyautogui + pillow
- `cli`: rich + python-dotenv
- `all`: includes all extras above

## Quickstart: Python API client

```python
from centris_sdk import Centris

centris = Centris(api_key="ck_live_xxx")
result = centris.do("Open Gmail and summarize my first email")
print(result.text)
```

## Quickstart: connector development

```bash
centris-py init my-connector
cd my-connector
centris-py validate .
centris-py test .
centris-py serve .
```

## Quickstart: local-first mode

```python
from centris_sdk import Centris

centris = Centris(local=True)
result = centris.do("Open Gmail")
print(result.text)
```

In local mode, the client runs local execution logic instead of calling the hosted API.
