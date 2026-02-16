"""Centris AI Connectors.

This module provides access to all connectors:
- Google Workspace: Fast API access to Gmail, Calendar, Drive, etc.
- Gmail: Browser-based Gmail automation (fallback)
- Slack: Slack integration
"""

from __future__ import annotations

# Make connectors importable
__all__ = [
    "google_workspace",
    "gmail",
]
