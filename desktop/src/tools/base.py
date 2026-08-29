from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, Optional
from src.llm.types import ToolDefinition
from src.security.guard import ActionRiskLevel

@dataclass
class ToolContext:
    task_id: str
    session_id: Optional[str] = None
    user_approved: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)

@dataclass
class ToolResult:
    success: bool
    data: Any
    error: Optional[str] = None
    risk_level: ActionRiskLevel = ActionRiskLevel.SAFE
    snapshot_id: Optional[str] = None

    def to_output_str(self) -> str:
        if not self.success:
            return f"Error: {self.error or 'Tool execution failed'}"
        if isinstance(self.data, (dict, list)):
            import json
            return json.dumps(self.data, indent=2)
        return str(self.data)

class BaseTool(ABC):
    """
    Abstract base class for all tools in the NIM JARVIS ecosystem.
    Shared schema shape across Desktop, Browser Bridge, and MCP servers.
    """

    name: str = ""
    description: str = ""
    parameters: Dict[str, Any] = {}
    risk_level: ActionRiskLevel = ActionRiskLevel.SAFE
    origin: str = "desktop"  # "desktop" | "browser" | "mcp"

    def to_tool_definition(self) -> ToolDefinition:
        return ToolDefinition(
            type="function",
            function={
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters
            }
        )

    @abstractmethod
    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        """Executes the tool with the provided arguments and context."""
        pass
