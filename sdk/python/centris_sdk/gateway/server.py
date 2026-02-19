"""
Centris SDK Gateway Server

FastAPI-based HTTP server for the MCP Gateway.
"""

import asyncio
import logging
import json
from typing import Any, Optional, Awaitable, Callable
from datetime import datetime

from centris_sdk.gateway.gateway import MCPGateway
from centris_sdk.gateway.types import GatewayConfig, ToolCall
from centris_sdk.action_api import (
    ACTION_API_SPEC_VERSION,
    ActionApiRequestEnvelope,
    ActionApiResponseEnvelope,
)


logger = logging.getLogger("centris.gateway.server")


class GatewayServer:
    """
    HTTP server for the MCP Gateway.
    
    Provides endpoints:
    - GET /health - Health check
    - GET /mcp/tools - List all tools
    - POST /mcp/execute - Execute a tool
    - GET /mcp/schema - Full MCP schema
    - POST /rpc - JSON-RPC endpoint
    - GET /.well-known/agent.json - A2A agent card
    
    Example:
        gateway = MCPGateway()
        gateway.add_connector(my_connector)
        
        server = GatewayServer(gateway)
        server.run(port=8000)
    """
    
    def __init__(
        self,
        gateway: MCPGateway,
        config: Optional[GatewayConfig] = None,
        action_api_handler: Optional[
            Callable[[ActionApiRequestEnvelope], Awaitable[ActionApiResponseEnvelope]]
        ] = None,
    ):
        self.gateway = gateway
        self.config = config or gateway.config
        self.action_api_handler = action_api_handler
        self._app = None
    
    def create_app(self):
        """Create the FastAPI application."""
        try:
            from fastapi import FastAPI, Request, HTTPException, Depends
            from fastapi.responses import JSONResponse
            from fastapi.middleware.cors import CORSMiddleware
        except ImportError:
            raise ImportError("FastAPI not installed. Install with: pip install fastapi uvicorn")
        
        app = FastAPI(
            title=self.gateway.name,
            description="Centris MCP Gateway",
            version=self.gateway.version,
        )
        
        # CORS middleware
        app.add_middleware(
            CORSMiddleware,
            allow_origins=self.config.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
        
        # Auth dependency
        async def verify_auth(request: Request):
            if not self.config.require_auth:
                return True
            
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header[7:]
                if token in self.config.api_keys:
                    return True
            
            raise HTTPException(status_code=401, detail="Unauthorized")
        
        # Health endpoint
        @app.get("/health")
        async def health():
            return await self.gateway.health_check()
        
        # MCP Tools endpoint
        @app.get("/mcp/tools")
        async def mcp_tools(_: bool = Depends(verify_auth)):
            tools = self.gateway.get_tools()
            return {
                "tools": [t.to_dict() for t in tools]
            }
        
        # MCP Execute endpoint
        @app.post("/mcp/execute")
        async def mcp_execute(request: Request, _: bool = Depends(verify_auth)):
            body = await request.json()
            
            tool_id = body.get("tool") or body.get("tool_id") or body.get("name")
            params = body.get("params") or body.get("arguments") or body.get("input") or {}
            call_id = body.get("call_id") or body.get("id")
            context = body.get("context") or {}
            
            if not tool_id:
                return JSONResponse(
                    status_code=400,
                    content={"error": "Missing tool ID"}
                )
            
            call = ToolCall(
                tool_id=tool_id,
                params=params,
                call_id=call_id,
                context=context,
            )
            
            result = await self.gateway.execute(call)
            
            return {
                "success": result.success,
                "content": result.content,
                "call_id": result.call_id,
                "error": result.error,
                "metadata": result.metadata,
            }
        
        # MCP Schema endpoint
        @app.get("/mcp/schema")
        async def mcp_schema(_: bool = Depends(verify_auth)):
            return self.gateway.to_mcp_server().to_dict()
        
        # JSON-RPC endpoint (MCP protocol)
        @app.post("/rpc")
        async def json_rpc(request: Request, _: bool = Depends(verify_auth)):
            body = await request.json()
            
            method = body.get("method")
            params = body.get("params", {})
            rpc_id = body.get("id")
            
            try:
                if method == "tools/list":
                    tools = self.gateway.get_tools()
                    result = {"tools": [t.to_dict() for t in tools]}
                
                elif method == "tools/call":
                    tool_name = params.get("name")
                    tool_args = params.get("arguments", {})
                    
                    call = ToolCall(
                        tool_id=tool_name,
                        params=tool_args,
                        call_id=str(rpc_id) if rpc_id else None,
                    )
                    
                    tool_result = await self.gateway.execute(call)
                    result = {
                        "content": tool_result.content,
                        "isError": not tool_result.success,
                    }
                
                elif method == "initialize":
                    result = {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {
                            "tools": {"listChanged": True},
                        },
                        "serverInfo": {
                            "name": self.gateway.name,
                            "version": self.gateway.version,
                        },
                    }
                
                elif method == "notifications/initialized":
                    return JSONResponse(content={})  # No response needed
                
                else:
                    return JSONResponse(
                        content={
                            "jsonrpc": "2.0",
                            "id": rpc_id,
                            "error": {
                                "code": -32601,
                                "message": f"Method not found: {method}",
                            },
                        }
                    )
                
                return JSONResponse(
                    content={
                        "jsonrpc": "2.0",
                        "id": rpc_id,
                        "result": result,
                    }
                )
            
            except Exception as e:
                logger.error(f"RPC error: {e}")
                return JSONResponse(
                    content={
                        "jsonrpc": "2.0",
                        "id": rpc_id,
                        "error": {
                            "code": -32603,
                            "message": str(e),
                        },
                    }
                )
        
        # A2A Agent Card endpoint
        @app.get("/.well-known/agent.json")
        async def agent_card(request: Request):
            base_url = str(request.base_url).rstrip("/")
            card = self.gateway.to_agent_card(base_url)
            return card.to_dict()

        @app.post("/api/v1/action")
        async def action_api(request: Request, _: bool = Depends(verify_auth)):
            body = await request.json()
            if not self.action_api_handler:
                return JSONResponse(
                    status_code=501,
                    content={
                        "specVersion": ACTION_API_SPEC_VERSION,
                        "method": body.get("method", "observe"),
                        "ok": False,
                        "error": {
                            "code": "ACTION_API_UNAVAILABLE",
                            "message": "Action API handler is not configured on this server.",
                        },
                    },
                )

            envelope = ActionApiRequestEnvelope(
                spec_version=str(body.get("specVersion", ACTION_API_SPEC_VERSION)),
                method=body.get("method", "observe"),
                params=body.get("params") or {},
                id=body.get("id"),
            )
            result = await self.action_api_handler(envelope)

            status = 200 if result.ok else 400
            error_payload = None
            if result.error:
                error_payload = {
                    "code": result.error.code,
                    "message": result.error.message,
                    "details": result.error.details,
                }

            return JSONResponse(
                status_code=status,
                content={
                    "specVersion": result.spec_version,
                    "method": result.method,
                    "ok": result.ok,
                    "result": result.result,
                    "error": error_payload,
                    "id": result.id,
                },
            )
        
        # Connector status endpoints
        @app.get("/connectors")
        async def list_connectors(_: bool = Depends(verify_auth)):
            return {
                "connectors": [
                    {
                        "id": s.id,
                        "name": s.name,
                        "version": s.version,
                        "state": s.state.value,
                        "tool_count": s.tool_count,
                        "last_used": s.last_used.isoformat() if s.last_used else None,
                    }
                    for s in self.gateway.list_connectors()
                ]
            }
        
        @app.get("/connectors/{connector_id}")
        async def get_connector(connector_id: str, _: bool = Depends(verify_auth)):
            status = self.gateway.get_connector_status(connector_id)
            if not status:
                raise HTTPException(status_code=404, detail="Connector not found")
            
            return {
                "id": status.id,
                "name": status.name,
                "version": status.version,
                "state": status.state.value,
                "tool_count": status.tool_count,
                "last_used": status.last_used.isoformat() if status.last_used else None,
                "error_message": status.error_message,
            }
        
        self._app = app
        return app
    
    @property
    def app(self):
        """Get or create the FastAPI app."""
        if self._app is None:
            self.create_app()
        return self._app
    
    def run(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        reload: bool = False,
        log_level: str = "info",
    ):
        """
        Run the server.
        
        Args:
            host: Host to bind to
            port: Port to listen on
            reload: Enable auto-reload
            log_level: Logging level
        """
        try:
            import uvicorn
        except ImportError:
            raise ImportError("uvicorn not installed. Install with: pip install uvicorn")
        
        uvicorn.run(
            self.app,
            host=host or self.config.host,
            port=port or self.config.port,
            reload=reload,
            log_level=log_level,
        )
    
    async def run_async(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
    ):
        """Run the server asynchronously."""
        try:
            import uvicorn
        except ImportError:
            raise ImportError("uvicorn not installed. Install with: pip install uvicorn")
        
        config = uvicorn.Config(
            self.app,
            host=host or self.config.host,
            port=port or self.config.port,
        )
        server = uvicorn.Server(config)
        await server.serve()
