"""
Unified Tool System for Desktop, Browser Bridge, and MCP
"""

from .base import BaseTool, ToolResult, ToolContext
from .registry import UnifiedToolRegistry, get_tool_registry

__all__ = [
    "BaseTool",
    "ToolResult",
    "ToolContext",
    "UnifiedToolRegistry",
    "get_tool_registry",
]
