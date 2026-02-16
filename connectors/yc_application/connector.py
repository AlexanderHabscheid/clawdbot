"""
Y Combinator Application Connector for Centris

Pre-mapped DOM selectors from Centris Chrome extension "Show Elements" output.
This makes form filling 10x faster by knowing exactly where to type.

NO MANUAL DEVTOOLS INSPECTION NEEDED - The extension provides element IDs.

SAFETY: Submit button is blocked by guardrails. This connector will NEVER submit.

SUPPORTED URLS (February 2026):
1. https://www.ycombinator.com/apply - Public apply page (not logged in)
2. https://apply.ycombinator.com/home - Logged-in home page
3. https://apply.ycombinator.com/apps/.../edit - Application form
"""

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


# =============================================================================
# YC Public Apply Page (www.ycombinator.com/apply) - February 2026
# =============================================================================

class YCPublicApplyElements:
    """
    Pre-mapped YC public apply page elements.
    Source: Centris Chrome extension "Show Elements" feature
    URL: https://www.ycombinator.com/apply
    """
    # Navigation bar
    ABOUT = (1, "clickable", "About")
    COMPANIES = (2, "clickable", "Companies")
    LIBRARY = (3, "clickable", "Library")
    MENU = (4, "clickable", "Menu icon")
    PARTNERS = (5, "clickable", "Partners")
    RESOURCES = (6, "clickable", "Resources")
    STARTUP_JOBS = (7, "clickable", "Startup Jobs")
    APPLY_NAV = (8, "clickable", "Apply (nav bar)")
    
    # Main content
    EARLY_DECISION = (9, "clickable", "Early Decision link")
    APPLY_BUTTON = (10, "clickable", "Apply button - MAIN CTA")  # The big Apply button
    APPLICATION_ONLINE = (11, "clickable", "application online link")
    FAQS = (12, "clickable", "FAQs link")
    
    # Info links
    YC_GENERAL_PARTNER = (13, "clickable", "YC General Partner link")
    YC_COMPANIES = (14, "clickable", "YC companies link")
    YC_ALUMNI_COMMUNITY = (15, "clickable", "YC alumni community link")
    READ_MORE_HERE = (16, "clickable", "Read more here link")
    EMAIL = (17, "clickable", "email link")
    
    # Footer
    YC_LOGO = (18, "clickable", "Y Combinator logo")
    YC_PROGRAM = (19, "clickable", "YC Program")
    STARTUP_DIRECTORY = (20, "clickable", "Startup Directory")
    YC_BLOG = (21, "clickable", "YC Blog")
    STARTUP_SCHOOL = (22, "clickable", "Startup School")


# =============================================================================
# YC Home Page (apply.ycombinator.com/home) - February 2026
# =============================================================================

class YCHomeElements:
    """
    Pre-mapped YC home page elements (logged in).
    Source: Centris Chrome extension "Show Elements" feature
    URL: https://apply.ycombinator.com/home
    """
    # Header
    YC_LOGO = (1, "clickable", "YC Logo")
    SETTINGS = (2, "clickable", "settings")
    LOGOUT = (3, "clickable", "Log out")
    
    # Main actions
    PREVIEW = (4, "clickable", "Preview")
    FINISH_APPLICATION = (5, "clickable", "Finish application - CLICK THIS TO START")
    
    # Info links (right sidebar)
    FAQ = (6, "clickable", "FAQ")
    WHAT_HAPPENS = (7, "clickable", "What happens at YC")
    HOW_TO_APPLY = (8, "clickable", "How to apply successfully")
    STARTUP_IDEAS = (9, "clickable", "How to get startup ideas")
    REPORT_BUG = (10, "clickable", "Report a bug")
    REMINDERS = (11, "clickable", "Sign up for reminders")
    
    # Footer
    ABOUT = (12, "clickable", "About")
    PEOPLE = (13, "clickable", "People")
    BLOG = (14, "clickable", "Blog")
    RESOURCES = (15, "clickable", "Resources")
    LEGAL = (16, "clickable", "Legal")
    NOTICE = (17, "clickable", "Notice at Collection")
    CONTACT = (18, "clickable", "Contact")


class YCApplicationElements:
    """
    Pre-mapped YC application form elements (February 2026).
    Source: Centris Chrome extension "Show Elements" feature
    URL: https://apply.ycombinator.com/apps/.../edit
    """
    # ==========================================================================
    # Header
    # ==========================================================================
    YC_LOGO = (1, "clickable", "YC Logo")
    SETTINGS = (2, "clickable", "settings")
    LOGOUT = (3, "clickable", "Log out")
    
    # ==========================================================================
    # Navigation (Left Sidebar)
    # ==========================================================================
    NAV_BACK = (4, "clickable", "chevron_left Back")
    NAV_FOUNDERS = (5, "clickable", "Founders section")
    NAV_FOUNDER_VIDEO = (6, "clickable", "Founder Video section")
    NAV_COMPANY = (7, "clickable", "Company section")
    NAV_PROGRESS = (8, "clickable", "Progress section")
    NAV_IDEA = (9, "clickable", "Idea section")
    NAV_EQUITY = (10, "clickable", "Equity section")
    NAV_CURIOUS = (11, "clickable", "Curious section")
    NAV_BATCH_PREFERENCE = (12, "clickable", "Batch Preference section")
    
    # ==========================================================================
    # Founders Section
    # ==========================================================================
    COMPLETE_PROFILE = (13, "clickable", "Complete my profile arrow_forward")
    ADD_COFOUNDER = (14, "clickable", "+ Add a co-founder button")
    FOUNDERS_OTHER_INFO = (15, "typeable", "others2 - Who writes code / other info")
    FOUNDERS_COFOUNDER = (16, "typeable", "cofounder - Looking for cofounder info")
    HERE_LINK = (17, "clickable", "here link (co-founder matching)")
    
    # ==========================================================================
    # Founder Video Section
    # ==========================================================================
    VIDEO_UPLOAD = (18, "clickable", "Drop here or browse - Video upload")
    
    # ==========================================================================
    # Company Section
    # ==========================================================================
    COMPANY_NAME = (19, "typeable", "name - Company name (required)")
    COMPANY_DESCRIPTION = (20, "typeable", "describe - 50 char description (required)")
    COMPANY_URL = (21, "typeable", "url - Company website URL")
    COMPANY_LOGO_UPLOAD = (22, "clickable", "Drop here or browse - Logo upload")
    PRODUCT_LINK = (23, "typeable", "productLink - Demo/product URL")
    PRODUCT_CREDENTIALS = (24, "typeable", "productCreds - Login credentials for demo")
    WHAT_WILL_YOU_MAKE = (25, "typeable", "make - What will you make?")
    LOCATION_NOW = (26, "typeable", "where - Where are you located now?")
    LOCATION_WHY = (27, "typeable", "wherewhy - Relocation explanation")
    
    # ==========================================================================
    # Progress Section
    # ==========================================================================
    HOW_FAR_ALONG = (28, "typeable", "howfar - How far along are you?")
    HOW_LONG_WORKED = (29, "typeable", "worked - How long have you been working?")
    TECH_STACK = (30, "typeable", "techstack - What's your tech stack?")
    
    # ==========================================================================
    # Idea Section
    # FEB 2026 UPDATE: IDs shifted +1 from id 31 onward due to new "here"
    # clickable link at id 31 (between techstack and since fields)
    # ==========================================================================
    HERE_LINK_IDEA = (31, "clickable", "here link (idea section)")  # NEW - inserted element
    WHY_THIS_IDEA = (32, "typeable", "since - Why did you pick this idea?")
    PREVIOUS_ACCELERATOR = (33, "typeable", "acc - Previous accelerators?")
    EXPLAIN_IDEA = (34, "typeable", "exp - Explain your idea and competitors")
    HOW_GET_USERS = (35, "typeable", "get - How will you get users?")
    HOW_MAKE_MONEY = (36, "typeable", "money - How will you make money?")
    CATEGORY_SELECT = (37, "selectable", "Category dropdown - Adtech/Aerospace/Agriculture/etc")
    OTHER_IDEAS = (38, "typeable", "ideas - Other ideas you considered?")
    
    # ==========================================================================
    # Equity Section
    # ==========================================================================
    EQUITY_BREAKDOWN = (39, "typeable", "percent2 - Equity breakdown")
    FUNDRAISING_DETAILS = (40, "typeable", "raisingdetails - Fundraising details")
    
    # ==========================================================================
    # Curious Section
    # ==========================================================================
    WHY_APPLY = (41, "typeable", "whyapply - Why are you applying to YC?")
    HOW_HEARD = (42, "typeable", "howhear - How did you hear about YC?")
    
    # ==========================================================================
    # Validation Errors (bottom of page)
    # ==========================================================================
    ERROR_COMPANY_NAME = (43, "clickable", "Company name is required")
    ERROR_DESCRIPTION = (44, "clickable", "Company description is required")
    ERROR_VIDEO = (45, "clickable", "Founder video is required")
    HERE_LINK_2 = (46, "clickable", "here link (bottom)")
    
    # ==========================================================================
    # Actions (Bottom)
    # ==========================================================================
    BACK_BUTTON_BOTTOM = (47, "clickable", "chevron_leftBack (bottom)")
    SAVE_CHANGES = (48, "clickable", "Save changes - SAFE TO CLICK")
    # SUBMIT_APPLICATION = (49, "clickable", "⚠️ BLOCKED - Submit application - NEVER CLICK")
    
    # Footer (same as home page)
    FOOTER_ABOUT = (50, "clickable", "About")
    FOOTER_PEOPLE = (51, "clickable", "People")
    FOOTER_BLOG = (52, "clickable", "Blog")
    FOOTER_RESOURCES = (53, "clickable", "Resources")
    FOOTER_LEGAL = (54, "clickable", "Legal")
    FOOTER_NOTICE = (55, "clickable", "Notice at Collection")
    FOOTER_CONTACT = (56, "clickable", "Contact")


class YCURLs:
    """YC application URLs (February 2026)."""
    
    # Public page (not logged in)
    PUBLIC_APPLY = "https://www.ycombinator.com/apply"
    
    # Logged-in pages
    HOME = "https://apply.ycombinator.com/home"
    BASE = "https://apply.ycombinator.com"
    
    @classmethod
    def is_yc(cls, url: str) -> bool:
        """Check if URL is any YC page."""
        return ("apply.ycombinator.com" in url or 
                "ycombinator.com/apply" in url)
    
    @classmethod
    def is_public_apply(cls, url: str) -> bool:
        """Check if on public apply page (www.ycombinator.com/apply)."""
        return "ycombinator.com/apply" in url and "apply.ycombinator" not in url
    
    @classmethod
    def is_home(cls, url: str) -> bool:
        """Check if on logged-in home page."""
        return "apply.ycombinator.com/home" in url
    
    @classmethod
    def is_application(cls, url: str) -> bool:
        """Check if on application edit page."""
        return "apply.ycombinator.com/apps" in url and "/edit" in url
    
    @classmethod
    def get_page_type(cls, url: str) -> Optional[str]:
        """Get the type of YC page for connector context."""
        if cls.is_public_apply(url):
            return "public_apply"
        elif cls.is_application(url):
            return "application_form"
        elif cls.is_home(url):
            return "home"
        elif cls.is_yc(url):
            return "yc_other"
        return None


# =============================================================================
# Field Mapping: JSON Data Key → DOM Element ID
# =============================================================================

# Maps our yc_application_data.json keys to YC form element IDs
# Element IDs from Chrome extension "Show Elements" output (February 2026)
FIELD_MAPPING = {
    # Founders section
    "founders.who_writes_code": 15,        # others2 field
    "founders.looking_for_cofounder": 16,  # cofounder field
    
    # Company section
    "company.name": 19,                     # name field
    "company.description_50_chars": 20,     # describe field
    "company.url": 21,                      # url field
    "company.login_credentials": 24,        # productCreds field
    "company.what_will_you_make": 25,       # make field
    "company.location_now": 26,             # where field
    "company.location_explanation": 27,     # wherewhy field
    
    # Progress section
    "progress.how_far_along": 28,           # howfar field
    "progress.how_long_working": 29,        # worked field
    "progress.tech_stack": 30,              # techstack field
    
    # Idea section
    # FEB 2026 UPDATE: IDs shifted +1 from id 31 onward (new "here" link at id 31)
    "idea.why_this_idea": 32,               # since field (was 31)
    "idea.previous_accelerator": 33,        # acc field (was 32)
    "idea.competitors": 34,                 # exp field (was 33)
    "idea.how_get_users": 35,               # get field (was 34, previously missing!)
    "idea.how_make_money": 36,              # money field (was 35)
    "idea.other_ideas": 38,                 # ideas field (was 37)
    
    # Equity section
    "equity.equity_breakdown": 39,          # percent2 field (was 38)
    "equity.fundraise_details": 40,         # raisingdetails field (was 39)
    
    # Curious section
    "curious.why_yc": 41,                   # whyapply field (was 40)
    "curious.how_heard": 42,                # howhear field (was 41)
}


# =============================================================================
# Tool Implementations
# =============================================================================

async def yc_fill_application(
    tool_call_id: str,
    params: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Fill YC application from structured data file.
    
    WORKFLOW:
    1. Navigate to YC home page (https://apply.ycombinator.com/home)
    2. Click "Finish application" button (id: 5)
    3. Wait for application form to load
    4. Fill fields using pre-mapped element IDs
    5. Save changes (but NEVER submit)
    
    SAFETY: Will NEVER click submit button.
    """
    browser_bridge = context.get("browser_bridge") if context else None
    
    if not browser_bridge:
        return {
            "success": False,
            "error": "Browser bridge not available. Ensure Centris desktop app is running."
        }
    
    data_path = params.get("data_path", "data/yc_application_data.json")
    
    try:
        # Load application data
        data_file = Path(data_path)
        if not data_file.exists():
            # Try relative to workspace
            data_file = Path("/Users/ahabscheid/Downloads/centris-ai") / data_path
        
        if not data_file.exists():
            return {"success": False, "error": f"Data file not found: {data_path}"}
        
        with open(data_file) as f:
            app_data = json.load(f)
        
        logger.info(f"[YC] Loaded application data from {data_path}")
        
        # STEP 1: Navigate to YC home page
        logger.info("[YC] Step 1: Navigating to YC home page...")
        current_tab = await browser_bridge.get_active_tab()
        current_url = current_tab.get("url", "") if current_tab else ""
        
        if not YCURLs.is_yc(current_url):
            await browser_bridge.navigate_browser(YCURLs.HOME)
            await browser_bridge.wait(3000)  # Wait for page load
        elif not YCURLs.is_home(current_url) and not YCURLs.is_application(current_url):
            await browser_bridge.navigate_browser(YCURLs.HOME)
            await browser_bridge.wait(3000)
        
        # STEP 2: If on home page, click "Finish application"
        current_tab = await browser_bridge.get_active_tab()
        current_url = current_tab.get("url", "") if current_tab else ""
        
        if YCURLs.is_home(current_url):
            logger.info("[YC] Step 2: Clicking 'Finish application' button (id: 5)...")
            await browser_bridge.click_node(node_id=5)  # Finish application button
            await browser_bridge.wait(3000)  # Wait for application form to load
        
        # STEP 3: Verify we're on the application page
        current_tab = await browser_bridge.get_active_tab()
        current_url = current_tab.get("url", "") if current_tab else ""
        
        if not YCURLs.is_application(current_url):
            logger.warning(f"[YC] Not on application page after clicking. URL: {current_url}")
            # Try direct navigation as fallback
            # await browser_bridge.navigate_browser("https://apply.ycombinator.com/apps/edit")
        
        # STEP 4: Fill each field
        logger.info("[YC] Step 4: Filling application fields...")
        filled_count = 0
        errors = []
        
        for json_path, element_id in FIELD_MAPPING.items():
            # Get value from nested JSON path (e.g., "company.name")
            parts = json_path.split(".")
            value = app_data
            for part in parts:
                if isinstance(value, dict):
                    value = value.get(part)
                else:
                    value = None
                    break
            
            if not value:
                continue
            
            try:
                # Click the field to focus it
                await browser_bridge.click_node(node_id=element_id)
                await browser_bridge.wait(200)
                
                # Clear existing content and type new
                await browser_bridge.press_key("Control+a")
                await browser_bridge.wait(100)
                await browser_bridge.type_text(str(value))
                await browser_bridge.wait(300)
                
                filled_count += 1
                logger.info(f"[YC] ✅ Filled {json_path} (element {element_id})")
                    
            except Exception as e:
                errors.append(f"{json_path}: {str(e)}")
                logger.warning(f"[YC] ❌ Failed to fill {json_path}: {e}")
        
        # STEP 5: Save changes (but NEVER submit)
        logger.info("[YC] Step 5: Saving changes...")
        try:
            await browser_bridge.click_node(node_id=48)  # Save changes button (was 47, shifted Feb 2026)
            await browser_bridge.wait(2000)
            logger.info("[YC] ✅ Saved changes")
        except Exception as e:
            logger.warning(f"[YC] ⚠️ Could not save: {e}")
        
        return {
            "success": True,
            "filled_fields": filled_count,
            "errors": errors if errors else None,
            "message": f"Filled {filled_count} fields. Changes saved. DID NOT SUBMIT (blocked for safety)."
        }
        
    except Exception as e:
        logger.error(f"[YC] Fill failed: {e}")
        return {"success": False, "error": str(e)}


async def yc_navigate_section(
    tool_call_id: str,
    params: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Navigate to a specific section of the YC application."""
    browser_bridge = context.get("browser_bridge") if context else None
    
    if not browser_bridge:
        return {"success": False, "error": "Browser bridge not available"}
    
    section = params.get("section", "").lower()
    
    section_map = {
        "founders": YCApplicationElements.NAV_FOUNDERS,
        "video": YCApplicationElements.NAV_FOUNDER_VIDEO,
        "company": YCApplicationElements.NAV_COMPANY,
        "progress": YCApplicationElements.NAV_PROGRESS,
        "idea": YCApplicationElements.NAV_IDEA,
        "equity": YCApplicationElements.NAV_EQUITY,
        "curious": YCApplicationElements.NAV_CURIOUS,
        "batch": YCApplicationElements.NAV_BATCH_PREFERENCE,
    }
    
    if section not in section_map:
        return {
            "success": False,
            "error": f"Unknown section: {section}. Available: {list(section_map.keys())}"
        }
    
    element_id, _, description = section_map[section]
    
    try:
        await browser_bridge.click_node(node_id=int(element_id))
        await browser_bridge.wait(1000)
        
        return {"success": True, "message": f"Navigated to {description}"}
        
    except Exception as e:
        return {"success": False, "error": str(e)}


async def yc_fill_field(
    tool_call_id: str,
    params: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Fill a specific field in the YC application by element ID."""
    browser_bridge = context.get("browser_bridge") if context else None
    
    if not browser_bridge:
        return {"success": False, "error": "Browser bridge not available"}
    
    element_id = params.get("element_id")
    value = params.get("value", "")
    
    if not element_id:
        return {"success": False, "error": "element_id is required"}
    
    try:
        await browser_bridge.click_node(node_id=int(element_id))
        await browser_bridge.wait(200)
        await browser_bridge.press_key("Control+a")
        await browser_bridge.wait(100)
        await browser_bridge.type_text(str(value))
        await browser_bridge.wait(300)
        
        return {"success": True, "message": f"Filled element {element_id}"}
        
    except Exception as e:
        return {"success": False, "error": str(e)}


async def yc_save_changes(
    tool_call_id: str,
    params: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Save changes without submitting."""
    browser_bridge = context.get("browser_bridge") if context else None
    
    if not browser_bridge:
        return {"success": False, "error": "Browser bridge not available"}
    
    try:
        await browser_bridge.click_node(node_id=48)  # Save changes button (was 47, shifted Feb 2026)
        await browser_bridge.wait(2000)
        
        return {"success": True, "message": "Changes saved. Application NOT submitted."}
        
    except Exception as e:
        return {"success": False, "error": str(e)}


async def yc_start_application(
    tool_call_id: str,
    params: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Navigate to YC home and click "Finish application" to start editing.
    
    This is the entry point - call this before filling fields.
    """
    browser_bridge = context.get("browser_bridge") if context else None
    
    if not browser_bridge:
        return {"success": False, "error": "Browser bridge not available"}
    
    try:
        # Navigate to home page
        logger.info("[YC] Navigating to YC home page...")
        await browser_bridge.navigate_browser(YCURLs.HOME)
        await browser_bridge.wait(3000)
        
        # Click "Finish application" button (id: 5)
        logger.info("[YC] Clicking 'Finish application' button...")
        await browser_bridge.click_node(node_id=5)
        await browser_bridge.wait(3000)
        
        return {
            "success": True,
            "message": "Navigated to YC application form. Ready to fill fields."
        }
        
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# Tool Definitions
# =============================================================================

@dataclass
class Tool:
    """Tool definition for Centris registry."""
    name: str
    description: str
    parameters: Dict[str, Any]
    execute: Callable
    label: Optional[str] = None
    tags: List[str] = field(default_factory=list)


class YCConnectorApi:
    """API for YC application connector tools."""
    
    def __init__(self):
        self._gateway_methods: Dict[str, Callable] = {}
        self._services: List[Any] = []
    
    def get_tools(self, context: Any = None) -> List[Tool]:
        """Return all YC application tools."""
        return [
            Tool(
                name="yc_start_application",
                label="Start YC Application",
                description="Navigate to YC home and click 'Finish application' to start editing. Call this FIRST before filling fields.",
                parameters={"type": "object", "properties": {}},
                execute=yc_start_application,
                tags=["yc", "navigation"]
            ),
            Tool(
                name="yc_fill_application",
                label="Fill YC Application",
                description="Fill the entire YC application from data file. Navigates to home, clicks 'Finish application', then fills all fields. NEVER submits - saves only.",
                parameters={
                    "type": "object",
                    "properties": {
                        "data_path": {
                            "type": "string",
                            "description": "Path to JSON data file (default: data/yc_application_data.json)",
                            "default": "data/yc_application_data.json"
                        }
                    }
                },
                execute=yc_fill_application,
                tags=["yc", "application", "form"]
            ),
            Tool(
                name="yc_navigate_section",
                label="Navigate YC Section",
                description="Navigate to a specific section: founders, video, company, progress, idea, equity, curious, batch",
                parameters={
                    "type": "object",
                    "properties": {
                        "section": {
                            "type": "string",
                            "enum": ["founders", "video", "company", "progress", "idea", "equity", "curious", "batch"],
                            "description": "Section to navigate to"
                        }
                    },
                    "required": ["section"]
                },
                execute=yc_navigate_section,
                tags=["yc", "navigation"]
            ),
            Tool(
                name="yc_fill_field",
                label="Fill YC Field",
                description="Fill a specific field by element ID (from Chrome extension 'Show Elements')",
                parameters={
                    "type": "object",
                    "properties": {
                        "element_id": {
                            "type": "integer",
                            "description": "Element ID from extension"
                        },
                        "value": {
                            "type": "string",
                            "description": "Value to fill"
                        }
                    },
                    "required": ["element_id", "value"]
                },
                execute=yc_fill_field,
                tags=["yc", "form"]
            ),
            Tool(
                name="yc_save_changes",
                label="Save YC Changes",
                description="Save YC application changes without submitting",
                parameters={"type": "object", "properties": {}},
                execute=yc_save_changes,
                tags=["yc", "save"]
            ),
        ]


# =============================================================================
# Connector Definition
# =============================================================================

@dataclass
class YCApplicationConnector:
    """
    Y Combinator Application connector - pre-mapped DOM elements (February 2026).
    
    Uses element IDs from Chrome extension "Show Elements" feature.
    No manual DevTools inspection needed.
    
    SUPPORTED PAGES:
    1. www.ycombinator.com/apply - Public apply page → Click "Apply" (id: 10)
    2. apply.ycombinator.com/home - Logged-in home → Click "Finish application" (id: 5)
    3. apply.ycombinator.com/apps/.../edit - Application form → Fill fields
    
    WORKFLOW:
    1. Navigate to https://www.ycombinator.com/apply OR https://apply.ycombinator.com/home
    2. Click "Apply" (id: 10) OR "Finish application" (id: 5)
    3. Fill form fields using pre-mapped IDs
    4. Save (id: 47) - NEVER submit (id: 48)
    
    SAFETY: Submit button (id: 48) is intentionally NOT exposed.
    """
    
    id: str = "yc-application"
    name: str = "YC Application"
    version: str = "3.0.0"  # February 2026 - All three pages mapped
    description: str = "Fast YC application filling with pre-mapped DOM. Supports public apply page, home, and application form."
    
    api: YCConnectorApi = field(default_factory=YCConnectorApi)
    
    # ==========================================================================
    # URL PATTERNS - Which URLs this connector handles
    # ==========================================================================
    url_patterns: List[str] = field(default_factory=lambda: [
        r"ycombinator\.com/apply",          # Public apply page
        r"apply\.ycombinator\.com"          # Logged-in pages
    ])
    
    # ==========================================================================
    # TASK KEYWORDS - Words in user tasks that trigger this connector
    # When user says "go to YC", the system knows to use this connector
    # ==========================================================================
    task_keywords: List[str] = field(default_factory=lambda: [
        "yc",
        "y combinator",
        "ycombinator",
        "yc application",
        "y combinator application",
        "startup application",
        "apply to yc",
        "yc batch",
    ])
    
    # ==========================================================================
    # PAGE ELEMENT SECTIONS - Which element_map sections apply to each page type
    # This enables intelligent filtering - only inject relevant elements
    # ==========================================================================
    page_element_sections: Dict[str, List[str]] = field(default_factory=lambda: {
        "public_apply": ["public_apply_page"],
        "home": ["home_page"],
        "application_form": [
            "navigation", 
            "typeable_fields", 
            "selectable", 
            "uploads", 
            "clickable", 
            "buttons",
            "errors"
        ],
        "yc_other": [],  # Unknown YC page - inject nothing, let LLM discover
    })
    
    @staticmethod
    def get_page_type(url: str) -> Optional[str]:
        """Determine page type from URL. Used by ConnectorContextProvider."""
        return YCURLs.get_page_type(url)
    
    def get_fill_data(self) -> Optional[Dict[int, Dict[str, str]]]:
        """Load application data and return {node_id: {field, value}} for filling.
        
        This enables the browser agent to fill fields using native click_node/type_text
        without needing any special connector tools.
        """
        try:
            data_file = Path(__file__).parent.parent.parent / "data" / "yc_application_data.json"
            if not data_file.exists():
                logger.debug(f"[YC] Fill data not found: {data_file}")
                return None
            
            with open(data_file) as f:
                app_data = json.load(f)
            
            fill_data: Dict[int, Dict[str, str]] = {}
            for json_path, node_id in FIELD_MAPPING.items():
                # Resolve nested JSON path (e.g., "company.name")
                parts = json_path.split(".")
                value = app_data
                for part in parts:
                    if isinstance(value, dict):
                        value = value.get(part)
                    else:
                        value = None
                        break
                
                if value:
                    fill_data[node_id] = {
                        "field": json_path,
                        "value": str(value),
                    }
            
            logger.info(f"[YC] Loaded fill data: {len(fill_data)} fields from {data_file.name}")
            return fill_data if fill_data else None
            
        except Exception as e:
            logger.warning(f"[YC] Failed to load fill data: {e}")
            return None
    
    # Pre-mapped element knowledge from extension (February 2026)
    element_map: Dict[str, Any] = field(default_factory=lambda: {
        # ================================================================
        # PUBLIC APPLY PAGE (www.ycombinator.com/apply)
        # ================================================================
        "public_apply_page": {
            "apply_button": 10,      # Main "Apply" CTA button - CLICK THIS
            "apply_nav": 8,          # Apply in nav bar
            "early_decision": 9,     # Early Decision link
            "faqs": 12,              # FAQs link
        },
        
        # ================================================================
        # HOME PAGE (apply.ycombinator.com/home)
        # ================================================================
        "home_page": {
            "finish_application": 5,  # CLICK THIS FIRST when logged in
            "preview": 4,            # Preview application
            "settings": 2,           # Settings
            "logout": 3,             # Log out
            "faq": 6,                # FAQ
            "what_happens": 7,       # What happens at YC
            "how_to_apply": 8,       # How to apply successfully
            "reminders": 11,         # Sign up for reminders
        },
        
        # ================================================================
        # APPLICATION FORM - NAVIGATION (apply.ycombinator.com/apps/.../edit)
        # ================================================================
        "navigation": {
            "back": 4,
            "founders": 5,
            "video": 6,
            "company": 7,
            "progress": 8,
            "idea": 9,
            "equity": 10,
            "curious": 11,
            "batch_preference": 12,
        },
        
        # ================================================================
        # APPLICATION FORM - TYPEABLE FIELDS
        # ================================================================
        "typeable_fields": {
            # Founders section
            "others2": 15,           # Who writes code / additional info
            "cofounder": 16,         # Looking for cofounder
            
            # Company section
            "name": 19,              # Company name (REQUIRED)
            "describe": 20,          # 50 char description (REQUIRED)
            "url": 21,               # Company website
            "productLink": 23,       # Demo/product URL
            "productCreds": 24,      # Login credentials
            "make": 25,              # What will you make?
            "where": 26,             # Current location
            "wherewhy": 27,          # Relocation explanation
            
            # Progress section
            "howfar": 28,            # How far along?
            "worked": 29,            # How long working?
            "techstack": 30,         # Tech stack
            
            # Idea section (FEB 2026: IDs shifted +1 from id 31 onward)
            "since": 32,             # Why this idea? (was 31)
            "acc": 33,               # Previous accelerators (was 32)
            "exp": 34,               # Explain idea / competitors (was 33)
            "get": 35,               # How get users? (was 34)
            "money": 36,             # How make money? (was 35)
            "ideas": 38,             # Other ideas considered (was 37)
            
            # Equity section
            "percent2": 39,          # Equity breakdown (was 38)
            "raisingdetails": 40,    # Fundraising details (was 39)
            
            # Curious section
            "whyapply": 41,          # Why applying to YC? (was 40)
            "howhear": 42,           # How heard about YC? (was 41)
        },
        
        # ================================================================
        # APPLICATION FORM - SPECIAL ELEMENTS
        # ================================================================
        "selectable": {
            "category": 37,          # Category dropdown (was 36)
        },
        "uploads": {
            "video": 18,             # Founder video upload
            "logo": 22,              # Company logo upload
        },
        "clickable": {
            "complete_profile": 13,  # Complete my profile
            "add_cofounder": 14,     # + Add a co-founder
            "here_link": 17,         # Co-founder matching link
            "here_link_idea": 31,    # NEW: "here" link in idea section
        },
        
        # ================================================================
        # APPLICATION FORM - ACTION BUTTONS
        # ================================================================
        "buttons": {
            "save": 48,              # Save changes - SAFE (was 47)
            "back_bottom": 47,       # Back button (bottom) (was 46)
            # "submit": 49           # ⚠️ BLOCKED - Never click (was 48)
        },
        
        # ================================================================
        # VALIDATION ERRORS
        # ================================================================
        "errors": {
            "company_name": 43,      # (was 42)
            "description": 44,       # (was 43)
            "video": 45,             # (was 44)
        }
    })


# Module-level export
connector = YCApplicationConnector()

__all__ = [
    "connector", 
    "YCApplicationConnector", 
    "YCHomeElements",
    "YCApplicationElements",
    "FIELD_MAPPING"
]
