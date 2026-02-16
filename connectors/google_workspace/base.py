"""Base class for Google Workspace API connectors.

Provides shared functionality:
- Token management (get from Supabase, auto-refresh)
- Google API client building
- Error handling
- Rate limiting
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Callable
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Google API client imports (lazy loaded)
GOOGLE_API_AVAILABLE = False
try:
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    GOOGLE_API_AVAILABLE = True
except ImportError:
    Credentials = None
    build = None
    HttpError = Exception


@dataclass
class GoogleApiTool:
    """Tool definition for Google API operations."""
    name: str
    description: str
    parameters: Dict[str, Any]
    execute: Callable
    label: Optional[str] = None
    tags: List[str] = field(default_factory=list)


class GoogleWorkspaceConnectorBase(ABC):
    """Base class for all Google Workspace API connectors.
    
    Subclasses implement specific APIs (Gmail, Calendar, Drive, etc.)
    but share token management and client building.
    """
    
    # Subclasses override these
    SERVICE_NAME: str = "unknown"
    SERVICE_VERSION: str = "v1"
    REQUIRED_SCOPES: List[str] = []
    
    def __init__(self):
        self._service = None
        self._credentials = None
    
    def _get_credentials(self, user_id: str) -> Optional[Credentials]:
        """Get Google OAuth credentials for a user.
        
        Fetches stored tokens from Supabase and creates Credentials object.
        """
        if not GOOGLE_API_AVAILABLE:
            logger.error("Google API client not installed. Run: pip install google-api-python-client google-auth")
            return None
        
        try:
            from backend.services.auth_service import get_auth_service
            auth_service = get_auth_service()
            
            # Get stored Google tokens
            token = auth_service.get_google_api_token(user_id)
            if not token:
                logger.warning(f"No Google API token found for user {user_id}")
                return None
            
            # Create credentials object
            # Note: In production, also fetch refresh_token and handle refresh
            credentials = Credentials(
                token=token,
                # These would come from your GCP project
                # client_id=settings.google_client_id,
                # client_secret=settings.google_client_secret,
            )
            
            return credentials
            
        except Exception as e:
            logger.error(f"Failed to get credentials for user {user_id}: {e}")
            return None
    
    def _build_service(self, credentials: Credentials):
        """Build the Google API service client."""
        if not GOOGLE_API_AVAILABLE:
            return None
        
        try:
            service = build(
                self.SERVICE_NAME,
                self.SERVICE_VERSION,
                credentials=credentials,
                cache_discovery=False
            )
            return service
        except Exception as e:
            logger.error(f"Failed to build {self.SERVICE_NAME} service: {e}")
            return None
    
    def get_service(self, user_id: str):
        """Get authenticated service for a user.
        
        Returns None if user doesn't have Google API access.
        """
        credentials = self._get_credentials(user_id)
        if not credentials:
            return None
        
        return self._build_service(credentials)
    
    def has_api_access(self, user_id: str) -> bool:
        """Check if user has Google API access for this service."""
        try:
            from backend.services.auth_service import get_auth_service
            return get_auth_service().has_google_api_access(user_id)
        except Exception:
            return False
    
    @abstractmethod
    def get_tools(self) -> List[GoogleApiTool]:
        """Return list of tools this connector provides."""
        pass
    
    @property
    @abstractmethod
    def id(self) -> str:
        """Unique identifier for this connector."""
        pass
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable name."""
        pass
    
    @property
    @abstractmethod
    def description(self) -> str:
        """Description of what this connector does."""
        pass


def handle_google_api_error(func):
    """Decorator to handle Google API errors gracefully."""
    async def wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except HttpError as e:
            error_content = e.content.decode() if hasattr(e, 'content') else str(e)
            logger.error(f"Google API error: {e.resp.status} - {error_content}")
            return {
                "success": False,
                "error": f"Google API error: {e.resp.status}",
                "details": error_content
            }
        except Exception as e:
            logger.error(f"Unexpected error in Google API call: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    return wrapper
