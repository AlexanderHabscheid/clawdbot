"""Google Classroom API Connector for Centris AI.

Education automation via API.

API Docs: https://developers.google.com/classroom/reference/rest
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from .base import GoogleWorkspaceConnectorBase, GoogleApiTool

logger = logging.getLogger(__name__)


class ClassroomApiConnector(GoogleWorkspaceConnectorBase):
    """Google Classroom API connector.
    
    Capabilities:
    - List courses
    - Get coursework/assignments
    - List students
    - Post announcements
    """
    
    SERVICE_NAME = "classroom"
    SERVICE_VERSION = "v1"
    REQUIRED_SCOPES = [
        "https://www.googleapis.com/auth/classroom.courses",
        "https://www.googleapis.com/auth/classroom.coursework.me",
        "https://www.googleapis.com/auth/classroom.coursework.students",
        "https://www.googleapis.com/auth/classroom.rosters",
        "https://www.googleapis.com/auth/classroom.announcements",
    ]
    
    @property
    def id(self) -> str:
        return "classroom-api"
    
    @property
    def name(self) -> str:
        return "Google Classroom API"
    
    @property
    def description(self) -> str:
        return "Education automation - courses, assignments, students."
    
    async def list_courses(
        self,
        user_id: str,
        course_states: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """List user's courses."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Classroom API access"}
        
        try:
            params = {}
            if course_states:
                params['courseStates'] = course_states
            
            results = service.courses().list(**params).execute()
            courses = results.get('courses', [])
            
            formatted = []
            for course in courses:
                formatted.append({
                    'id': course.get('id'),
                    'name': course.get('name'),
                    'section': course.get('section'),
                    'state': course.get('courseState'),
                    'enrollment_code': course.get('enrollmentCode'),
                    'link': course.get('alternateLink')
                })
            
            return {
                "success": True,
                "courses": formatted,
                "count": len(formatted)
            }
            
        except Exception as e:
            logger.error(f"[Classroom API] List courses failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def list_coursework(
        self,
        user_id: str,
        course_id: str
    ) -> Dict[str, Any]:
        """List assignments/coursework for a course."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Classroom API access"}
        
        try:
            results = service.courses().courseWork().list(
                courseId=course_id
            ).execute()
            
            coursework = results.get('courseWork', [])
            
            formatted = []
            for work in coursework:
                formatted.append({
                    'id': work.get('id'),
                    'title': work.get('title'),
                    'description': work.get('description'),
                    'state': work.get('state'),
                    'due_date': work.get('dueDate'),
                    'max_points': work.get('maxPoints'),
                    'link': work.get('alternateLink')
                })
            
            return {
                "success": True,
                "course_id": course_id,
                "coursework": formatted,
                "count": len(formatted)
            }
            
        except Exception as e:
            logger.error(f"[Classroom API] List coursework failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def post_announcement(
        self,
        user_id: str,
        course_id: str,
        text: str
    ) -> Dict[str, Any]:
        """Post an announcement to a course."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Classroom API access"}
        
        try:
            announcement = {
                'text': text,
                'state': 'PUBLISHED'
            }
            
            result = service.courses().announcements().create(
                courseId=course_id,
                body=announcement
            ).execute()
            
            logger.info(f"[Classroom API] Announcement posted: {result.get('id')}")
            
            return {
                "success": True,
                "announcement_id": result.get('id'),
                "course_id": course_id,
                "text": text
            }
            
        except Exception as e:
            logger.error(f"[Classroom API] Post announcement failed: {e}")
            return {"success": False, "error": str(e)}
    
    def get_tools(self) -> List[GoogleApiTool]:
        return [
            GoogleApiTool(
                name="classroom_api_courses",
                label="List Courses",
                description="List Google Classroom courses.",
                parameters={
                    "type": "object",
                    "properties": {}
                },
                execute=self.list_courses,
                tags=["classroom", "courses", "education", "api"]
            ),
            GoogleApiTool(
                name="classroom_api_assignments",
                label="List Assignments",
                description="List assignments for a course.",
                parameters={
                    "type": "object",
                    "properties": {
                        "course_id": {"type": "string", "description": "Course ID"},
                    },
                    "required": ["course_id"]
                },
                execute=self.list_coursework,
                tags=["classroom", "assignments", "api"]
            ),
            GoogleApiTool(
                name="classroom_api_announce",
                label="Post Announcement",
                description="Post an announcement to a course.",
                parameters={
                    "type": "object",
                    "properties": {
                        "course_id": {"type": "string", "description": "Course ID"},
                        "text": {"type": "string", "description": "Announcement text"},
                    },
                    "required": ["course_id", "text"]
                },
                execute=self.post_announcement,
                tags=["classroom", "announcement", "api"]
            ),
        ]


classroom_api_connector = ClassroomApiConnector()
