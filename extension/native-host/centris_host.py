#!/usr/bin/env python3
"""
Centris Native Messaging Host

This script acts as a bridge between the Chrome extension and the Centris backend.
It communicates with Chrome via stdin/stdout using the Native Messaging protocol.

Native Messaging Protocol:
- Messages are length-prefixed (4 bytes, little-endian) followed by JSON
- Chrome sends messages to stdin, host replies to stdout
- stderr can be used for logging (doesn't affect communication)

This host forwards messages to/from the Centris backend via:
1. Direct function calls (if running in same process as backend)
2. Local socket connection (if backend is separate process)
"""

import json
import logging
import os
import socket
import struct
import sys
import threading
import time
from typing import Any, Dict, Optional

# Configure logging to stderr (doesn't interfere with Native Messaging)
logging.basicConfig(
    level=logging.DEBUG,
    format='[NativeHost %(asctime)s] %(levelname)s: %(message)s',
    stream=sys.stderr
)
logger = logging.getLogger(__name__)

# Configuration
BACKEND_SOCKET_PATH = '/tmp/centris_backend.sock'  # Unix socket for backend communication
BACKEND_HOST = 'localhost'
BACKEND_PORT = 8766  # Different from WebSocket port (8765) to avoid conflicts


class NativeMessagingHost:
    """Native Messaging Host for Chrome extension communication."""
    
    def __init__(self):
        self.running = True
        self.backend_socket: Optional[socket.socket] = None
        self.pending_responses: Dict[str, Any] = {}
        self.response_events: Dict[str, threading.Event] = {}
        self.lock = threading.Lock()
        
        # Connection state
        self.backend_connected = False
        self.extension_id = None
        
        logger.info("Native Messaging Host initialized")
    
    def read_message(self) -> Optional[Dict[str, Any]]:
        """Read a message from Chrome (stdin).
        
        Native Messaging protocol:
        - First 4 bytes: message length (little-endian uint32)
        - Following bytes: JSON message
        """
        try:
            # Read message length (4 bytes, little-endian)
            raw_length = sys.stdin.buffer.read(4)
            if not raw_length:
                logger.info("stdin closed - Chrome disconnected")
                return None
            
            if len(raw_length) != 4:
                logger.error(f"Invalid message length bytes: {len(raw_length)}")
                return None
            
            message_length = struct.unpack('<I', raw_length)[0]
            
            if message_length == 0:
                logger.warning("Received empty message")
                return {}
            
            if message_length > 1024 * 1024 * 100:  # 100MB limit (same as WebSocket)
                logger.error(f"Message too large: {message_length} bytes")
                return None
            
            # Read message content
            message_bytes = sys.stdin.buffer.read(message_length)
            if len(message_bytes) != message_length:
                logger.error(f"Incomplete message: expected {message_length}, got {len(message_bytes)}")
                return None
            
            # Parse JSON
            message = json.loads(message_bytes.decode('utf-8'))
            
            logger.debug(f"Received message: type={message.get('type')}, id={message.get('id')}")
            return message
            
        except json.JSONDecodeError as e:
            logger.error(f"JSON decode error: {e}")
            return None
        except Exception as e:
            logger.error(f"Error reading message: {e}")
            return None
    
    def send_message(self, message: Dict[str, Any]) -> bool:
        """Send a message to Chrome (stdout).
        
        Native Messaging protocol:
        - First 4 bytes: message length (little-endian uint32)
        - Following bytes: JSON message
        """
        try:
            # Serialize to JSON
            message_bytes = json.dumps(message).encode('utf-8')
            message_length = len(message_bytes)
            
            # Write length prefix
            sys.stdout.buffer.write(struct.pack('<I', message_length))
            
            # Write message
            sys.stdout.buffer.write(message_bytes)
            sys.stdout.buffer.flush()
            
            logger.debug(f"Sent message: type={message.get('type')}, id={message.get('id')}, size={message_length}")
            return True
            
        except Exception as e:
            logger.error(f"Error sending message: {e}")
            return False
    
    def connect_to_backend(self) -> bool:
        """Connect to the Centris backend via TCP socket."""
        try:
            self.backend_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.backend_socket.connect((BACKEND_HOST, BACKEND_PORT))
            self.backend_socket.setblocking(False)
            self.backend_connected = True
            logger.info(f"Connected to backend at {BACKEND_HOST}:{BACKEND_PORT}")
            return True
        except Exception as e:
            logger.warning(f"Could not connect to backend socket: {e}")
            logger.info("Backend socket not available - will use direct WebSocket forwarding mode")
            self.backend_connected = False
            return False
    
    def forward_to_backend(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Forward message to backend and wait for response.
        
        If backend socket is connected, forward via socket.
        Otherwise, the extension should fall back to WebSocket.
        """
        if not self.backend_connected:
            # Signal to extension that it should use WebSocket
            return {
                'type': 'response',
                'id': message.get('id'),
                'success': False,
                'error': 'backend_not_connected',
                'fallback_to_websocket': True
            }
        
        try:
            # Send to backend
            message_bytes = json.dumps(message).encode('utf-8')
            length_prefix = struct.pack('<I', len(message_bytes))
            self.backend_socket.sendall(length_prefix + message_bytes)
            
            # Wait for response (with timeout)
            self.backend_socket.setblocking(True)
            self.backend_socket.settimeout(30.0)
            
            # Read response length
            raw_length = self.backend_socket.recv(4)
            if not raw_length:
                raise ConnectionError("Backend closed connection")
            
            response_length = struct.unpack('<I', raw_length)[0]
            
            # Read response
            response_bytes = b''
            while len(response_bytes) < response_length:
                chunk = self.backend_socket.recv(response_length - len(response_bytes))
                if not chunk:
                    raise ConnectionError("Backend closed connection during response")
                response_bytes += chunk
            
            response = json.loads(response_bytes.decode('utf-8'))
            return response
            
        except Exception as e:
            logger.error(f"Error forwarding to backend: {e}")
            self.backend_connected = False
            return {
                'type': 'response',
                'id': message.get('id'),
                'success': False,
                'error': str(e),
                'fallback_to_websocket': True
            }
    
    def handle_extension_ready(self, message: Dict[str, Any]) -> Dict[str, Any]:
        """Handle extension_ready handshake message."""
        self.extension_id = message.get('extensionId')
        logger.info(f"Extension ready: version={message.get('version')}, capabilities={message.get('capabilities')}")
        
        return {
            'type': 'handshake_ack',
            'id': 'handshake_ack',
            'success': True,
            'message': 'Native Messaging Host ready',
            'backend_connected': self.backend_connected
        }
    
    def handle_message(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Handle incoming message from extension."""
        msg_type = message.get('type')
        
        if msg_type == 'extension_ready':
            return self.handle_extension_ready(message)
        
        elif msg_type == 'ping':
            # Keep-alive ping
            return {
                'type': 'pong',
                'id': message.get('id'),
                'timestamp': time.time()
            }
        
        else:
            # Forward all other messages to backend
            return self.forward_to_backend(message)
    
    def run(self):
        """Main event loop - read messages from Chrome, process, respond."""
        logger.info("Native Messaging Host starting...")
        
        # Try to connect to backend
        self.connect_to_backend()
        
        # Send initial ready message
        self.send_message({
            'type': 'host_ready',
            'version': '1.0.0',
            'backend_connected': self.backend_connected,
            'pid': os.getpid()
        })
        
        while self.running:
            try:
                # Read message from Chrome
                message = self.read_message()
                
                if message is None:
                    # Chrome disconnected
                    logger.info("Chrome disconnected, shutting down")
                    break
                
                # Handle message
                response = self.handle_message(message)
                
                # Send response
                if response:
                    self.send_message(response)
                    
            except KeyboardInterrupt:
                logger.info("Received interrupt, shutting down")
                break
            except Exception as e:
                logger.error(f"Error in main loop: {e}")
                # Send error response if we have a message ID
                if message and message.get('id'):
                    self.send_message({
                        'type': 'response',
                        'id': message.get('id'),
                        'success': False,
                        'error': str(e)
                    })
        
        # Cleanup
        if self.backend_socket:
            try:
                self.backend_socket.close()
            except:
                pass
        
        logger.info("Native Messaging Host stopped")


def main():
    """Entry point."""
    host = NativeMessagingHost()
    host.run()


if __name__ == '__main__':
    main()

