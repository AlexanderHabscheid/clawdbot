"""Google Contacts (People) API Connector for Centris AI.

Contact management via API.

API Docs: https://developers.google.com/people/api
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from .base import GoogleWorkspaceConnectorBase, GoogleApiTool

logger = logging.getLogger(__name__)


class ContactsApiConnector(GoogleWorkspaceConnectorBase):
    """Google People/Contacts API connector.
    
    Capabilities:
    - List contacts
    - Search contacts
    - Create contacts
    - Get contact details
    """
    
    SERVICE_NAME = "people"
    SERVICE_VERSION = "v1"
    REQUIRED_SCOPES = [
        "https://www.googleapis.com/auth/contacts",
        "https://www.googleapis.com/auth/contacts.readonly",
    ]
    
    @property
    def id(self) -> str:
        return "contacts-api"
    
    @property
    def name(self) -> str:
        return "Google Contacts API"
    
    @property
    def description(self) -> str:
        return "Contact management via API."
    
    async def list_contacts(
        self,
        user_id: str,
        max_results: int = 100
    ) -> Dict[str, Any]:
        """List user's contacts."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Contacts API access"}
        
        try:
            results = service.people().connections().list(
                resourceName='people/me',
                pageSize=max_results,
                personFields='names,emailAddresses,phoneNumbers,organizations'
            ).execute()
            
            connections = results.get('connections', [])
            
            contacts = []
            for person in connections:
                names = person.get('names', [{}])
                emails = person.get('emailAddresses', [])
                phones = person.get('phoneNumbers', [])
                orgs = person.get('organizations', [])
                
                contacts.append({
                    'resource_name': person.get('resourceName'),
                    'name': names[0].get('displayName') if names else None,
                    'email': emails[0].get('value') if emails else None,
                    'phone': phones[0].get('value') if phones else None,
                    'organization': orgs[0].get('name') if orgs else None
                })
            
            return {
                "success": True,
                "contacts": contacts,
                "count": len(contacts)
            }
            
        except Exception as e:
            logger.error(f"[Contacts API] List contacts failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def search_contacts(
        self,
        user_id: str,
        query: str
    ) -> Dict[str, Any]:
        """Search contacts by name or email."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Contacts API access"}
        
        try:
            results = service.people().searchContacts(
                query=query,
                readMask='names,emailAddresses,phoneNumbers'
            ).execute()
            
            matches = results.get('results', [])
            
            contacts = []
            for result in matches:
                person = result.get('person', {})
                names = person.get('names', [{}])
                emails = person.get('emailAddresses', [])
                phones = person.get('phoneNumbers', [])
                
                contacts.append({
                    'resource_name': person.get('resourceName'),
                    'name': names[0].get('displayName') if names else None,
                    'email': emails[0].get('value') if emails else None,
                    'phone': phones[0].get('value') if phones else None
                })
            
            return {
                "success": True,
                "query": query,
                "contacts": contacts,
                "count": len(contacts)
            }
            
        except Exception as e:
            logger.error(f"[Contacts API] Search contacts failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def create_contact(
        self,
        user_id: str,
        name: str,
        email: Optional[str] = None,
        phone: Optional[str] = None,
        organization: Optional[str] = None
    ) -> Dict[str, Any]:
        """Create a new contact."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Contacts API access"}
        
        try:
            person = {
                'names': [{'givenName': name}]
            }
            
            if email:
                person['emailAddresses'] = [{'value': email}]
            if phone:
                person['phoneNumbers'] = [{'value': phone}]
            if organization:
                person['organizations'] = [{'name': organization}]
            
            result = service.people().createContact(body=person).execute()
            
            logger.info(f"[Contacts API] Contact created: {result.get('resourceName')}")
            
            return {
                "success": True,
                "resource_name": result.get('resourceName'),
                "name": name,
                "email": email
            }
            
        except Exception as e:
            logger.error(f"[Contacts API] Create contact failed: {e}")
            return {"success": False, "error": str(e)}
    
    def get_tools(self) -> List[GoogleApiTool]:
        return [
            GoogleApiTool(
                name="contacts_api_list",
                label="List Contacts",
                description="List Google Contacts.",
                parameters={
                    "type": "object",
                    "properties": {
                        "max_results": {"type": "integer", "default": 100},
                    }
                },
                execute=self.list_contacts,
                tags=["contacts", "people", "list", "api"]
            ),
            GoogleApiTool(
                name="contacts_api_search",
                label="Search Contacts",
                description="Search contacts by name or email.",
                parameters={
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query"},
                    },
                    "required": ["query"]
                },
                execute=self.search_contacts,
                tags=["contacts", "search", "api"]
            ),
            GoogleApiTool(
                name="contacts_api_create",
                label="Create Contact",
                description="Create a new contact.",
                parameters={
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Contact name"},
                        "email": {"type": "string", "description": "Email address"},
                        "phone": {"type": "string", "description": "Phone number"},
                        "organization": {"type": "string", "description": "Company/organization"},
                    },
                    "required": ["name"]
                },
                execute=self.create_contact,
                tags=["contacts", "create", "api"]
            ),
        ]


contacts_api_connector = ContactsApiConnector()
