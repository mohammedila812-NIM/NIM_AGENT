import logging
from typing import Dict, List, Optional
from .base import BaseTool, ToolContext, ToolResult
from src.llm.types import ToolDefinition
from src.security.audit import get_audit_logger
from src.security.guard import ActionRiskLevel, SecurityGuard

logger = logging.getLogger(__name__)

class UnifiedToolRegistry:
    """
    Central registry for all tools in NIM JARVIS.
    Combines Desktop Native tools, Browser Bridge proxy tools, and MCP tools
    under one coherent schema.
    """

    def __init__(self):
        self._tools: Dict[str, BaseTool] = {}
        self.audit_logger = get_audit_logger()

    def register(self, tool: BaseTool) -> None:
        self._tools[tool.name] = tool
        logger.debug("Registered tool: %s (origin: %s, risk: %s)", tool.name, tool.origin, tool.risk_level)

    def unregister(self, tool_name: str) -> bool:
        if tool_name in self._tools:
            del self._tools[tool_name]
            return True
        return False

    def get_tool(self, tool_name: str) -> Optional[BaseTool]:
        return self._tools.get(tool_name)

    def list_tools(self) -> List[BaseTool]:
        return list(self._tools.values())

    def get_tool_definitions(self) -> List[ToolDefinition]:
        return [tool.to_tool_definition() for tool in self._tools.values()]

    async def execute_tool(
        self,
        tool_name: str,
        args: Dict[str, object],
        context: ToolContext
    ) -> ToolResult:
        tool = self.get_tool(tool_name)
        if not tool:
            err_msg = f"Tool '{tool_name}' is not registered in the system."
            self.audit_logger.log_tool_call(
                tool_name=tool_name,
                arguments=args,
                risk_level="safe",
                task_id=context.task_id,
                result_summary=err_msg,
                blocked=True
            )
            return ToolResult(success=False, data=None, error=err_msg)

        # Dynamic risk evaluation
        calculated_risk = SecurityGuard.evaluate_tool_call(tool_name, args)
        if calculated_risk == ActionRiskLevel.CRITICAL:
            err_msg = f"Action blocked: Tool '{tool_name}' violated critical security policy."
            self.audit_logger.log_tool_call(
                tool_name=tool_name,
                arguments=args,
                risk_level=calculated_risk.value,
                task_id=context.task_id,
                result_summary=err_msg,
                blocked=True
            )
            return ToolResult(success=False, data=None, error=err_msg, risk_level=calculated_risk)

        # Execute the tool
        try:
            result = await tool.execute(args, context)
            self.audit_logger.log_tool_call(
                tool_name=tool_name,
                arguments=args,
                risk_level=result.risk_level.value,
                task_id=context.task_id,
                result_summary=f"Success: {result.success}, output length: {len(result.to_output_str())}",
                blocked=not result.success
            )
            return result
        except Exception as e:
            logger.error("Exception executing tool %s: %s", tool_name, e, exc_info=True)
            err_msg = f"Tool execution failed with unexpected error: {str(e)}"
            self.audit_logger.log_tool_call(
                tool_name=tool_name,
                arguments=args,
                risk_level=tool.risk_level.value,
                task_id=context.task_id,
                result_summary=err_msg,
                blocked=True,
                details=str(e)
            )
            return ToolResult(success=False, data=None, error=err_msg, risk_level=tool.risk_level)

_global_tool_registry: Optional[UnifiedToolRegistry] = None

def get_tool_registry() -> UnifiedToolRegistry:
    global _global_tool_registry
    if _global_tool_registry is None:
        _global_tool_registry = UnifiedToolRegistry()
    return _global_tool_registry
