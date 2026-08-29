"""
Browser Bridge Subsystem - WebSocket link with NIM Agent Extension
"""

from .protocol import (
    BridgeMessageType,
    BridgeMessage,
    BrowserTaskPayload,
    BrowserResultPayload,
    HandoffPayload
)
from .server import BridgeServer, get_bridge_server

__all__ = [
    "BridgeMessageType",
    "BridgeMessage",
    "BrowserTaskPayload",
    "BrowserResultPayload",
    "HandoffPayload",
    "BridgeServer",
    "get_bridge_server",
]
