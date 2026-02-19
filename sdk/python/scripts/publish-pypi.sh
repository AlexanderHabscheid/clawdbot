#!/bin/bash
#
# Centris SDK PyPI Publishing Script
#
# Usage:
#   ./scripts/publish-pypi.sh              # Publish to production PyPI
#   ./scripts/publish-pypi.sh --test       # Publish to TestPyPI first
#   ./scripts/publish-pypi.sh --dry-run    # Build only, don't upload
#   ./scripts/publish-pypi.sh --version 1.0.1  # Bump version before publish
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_DIR="$(dirname "$SCRIPT_DIR")"

# Defaults
USE_TEST_PYPI=false
DRY_RUN=false
NEW_VERSION=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --test)
            USE_TEST_PYPI=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --version)
            NEW_VERSION="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --test       Publish to TestPyPI instead of production"
            echo "  --dry-run    Build package but don't upload"
            echo "  --version X  Set version before publishing"
            echo "  -h, --help   Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Centris SDK PyPI Publisher${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

cd "$SDK_DIR"

# Check for required tools
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: python3 is required${NC}"
    exit 1
fi

# Ensure build tools are installed
python3 -m pip install --quiet build twine

echo -e "${GREEN}✓ Prerequisites OK${NC}"
echo ""

# Get current version
CURRENT_VERSION=$(grep -E '^version = ' pyproject.toml | sed 's/version = "\(.*\)"/\1/')
echo -e "Current version: ${BLUE}$CURRENT_VERSION${NC}"

# Update version if requested
if [[ -n "$NEW_VERSION" ]]; then
    echo -e "Updating to version: ${BLUE}$NEW_VERSION${NC}"
    sed -i.bak "s/version = \"$CURRENT_VERSION\"/version = \"$NEW_VERSION\"/" pyproject.toml
    rm -f pyproject.toml.bak
    CURRENT_VERSION="$NEW_VERSION"
fi

echo ""

# Clean previous builds
echo -e "${YELLOW}Cleaning previous builds...${NC}"
rm -rf dist/ build/ *.egg-info/ centris_sdk.egg-info/
echo -e "${GREEN}✓ Cleaned${NC}"
echo ""

# Run tests first
echo -e "${YELLOW}Running SDK tests...${NC}"
if python3 -c "import centris_sdk; print(f'SDK version: {centris_sdk.__version__ if hasattr(centris_sdk, \"__version__\") else \"1.0.0\"}')" 2>/dev/null; then
    echo -e "${GREEN}✓ SDK imports correctly${NC}"
else
    echo -e "${RED}Error: SDK import failed${NC}"
    exit 1
fi

# Verify CLI works
if python3 -m centris_sdk.cli.main --help > /dev/null 2>&1; then
    echo -e "${GREEN}✓ CLI works correctly${NC}"
else
    echo -e "${RED}Error: CLI failed${NC}"
    exit 1
fi
echo ""

# Build the package
echo -e "${YELLOW}Building package...${NC}"
python3 -m build

# Show what was built
echo ""
echo -e "${GREEN}✓ Package built successfully${NC}"
echo ""
echo "Built files:"
ls -la dist/
echo ""

if [[ "$DRY_RUN" == true ]]; then
    echo -e "${YELLOW}Dry run mode - skipping upload${NC}"
    echo ""
    echo "To upload manually:"
    echo "  python3 -m twine upload dist/*"
    exit 0
fi

# Upload
if [[ "$USE_TEST_PYPI" == true ]]; then
    echo -e "${YELLOW}Uploading to TestPyPI...${NC}"
    python3 -m twine upload --repository testpypi dist/*
    echo ""
    echo -e "${GREEN}✓ Published to TestPyPI${NC}"
    echo ""
    echo "Install from TestPyPI with:"
    echo "  pip install --index-url https://test.pypi.org/simple/ centris-sdk"
else
    echo -e "${YELLOW}Uploading to PyPI...${NC}"
    echo ""
    read -p "Publish centris-sdk v$CURRENT_VERSION to PyPI? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        python3 -m twine upload dist/*
        echo ""
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}  ✓ Published centris-sdk v$CURRENT_VERSION to PyPI!${NC}"
        echo -e "${GREEN}========================================${NC}"
        echo ""
        echo "Install with:"
        echo "  pip install centris-sdk"
        echo ""
        echo "Next steps:"
        echo "  1. Create git tag: git tag v$CURRENT_VERSION && git push --tags"
        echo "  2. Update documentation"
        echo "  3. Announce the release"
    else
        echo -e "${YELLOW}Aborted.${NC}"
        exit 1
    fi
fi
