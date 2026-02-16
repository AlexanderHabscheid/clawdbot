# YC Application Connector

Pre-mapped DOM elements for fast Y Combinator application filling.

## How It Was Created

1. Navigate to `https://apply.ycombinator.com/application`
2. Open Centris Chrome extension popup
3. Click **"Show Elements on Page"**
4. Copy the element list output
5. Map element IDs to field names

The extension's "Show Elements" feature extracts all interactive elements with their:

- **Element ID** - Used by `click_node(node_id=N)`
- **Type** - clickable, typeable, selectable
- **Name/Label** - Human-readable description
- **Bounds** - Position and size

## Element Mapping

| Field Name | Element ID | Type        | Description         |
| ---------- | ---------- | ----------- | ------------------- |
| name       | 19         | typeable    | Company name        |
| describe   | 20         | typeable    | 50-char description |
| url        | 21         | typeable    | Company URL         |
| make       | 25         | typeable    | What will you make  |
| howfar     | 28         | typeable    | How far along       |
| techstack  | 30         | typeable    | Tech stack          |
| whyapply   | 40         | typeable    | Why applying to YC  |
| howhear    | 41         | typeable    | How did you hear    |
| **save**   | 47         | clickable   | Save changes button |
| ~~submit~~ | 48         | **BLOCKED** | Never exposed       |

## Usage

```python
# The agent can use these tools:
yc_fill_application(data_path="data/yc_application_data.json")
yc_navigate_section(section="company")
yc_fill_field(element_id=19, value="Centris AI")
yc_save_changes()
```

## Safety

The submit button (element ID 48) is intentionally NOT exposed.
This connector will **never submit** your application.

## Developer Workflow (For Creating New Connectors)

### ONE COMMAND - Fully Automated (Recommended)

```bash
# Navigate to URL, capture elements, generate connector - all automated
centris init my-connector --capture-url https://example.com

# With custom wait time for slow pages
centris init my-connector --capture-url https://example.com --wait 5
```

### Alternative: Two-Step Process

```bash
# 1. Capture elements from URL
centris elements capture https://example.com --sdk -o elements.json

# 2. Generate connector from elements
centris init my-connector --from-elements elements.json
```

### Alternative: From Current Browser Page

```bash
# 1. Navigate via CLI
centris browser navigate https://example.com

# 2. Generate connector from current page
centris elements generate my-connector
```

### Legacy: Manual Extension Workflow

1. Navigate to the target website
2. Click "Show Elements on Page" in extension popup
3. Click "Export for SDK" button
4. Run: `centris init my-connector --from-elements elements.json`

## Files

- `connector.py` - Main connector with tool implementations
- `connector.json` - Manifest with element mappings
- `README.md` - This file

## Data File Format

See `data/yc_application_data.json` for the expected data structure.
