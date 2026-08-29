from typing import Any, Dict
from src.tools.base import BaseTool, ToolContext, ToolResult
from src.security.guard import ActionRiskLevel
from .server import get_bridge_server

class BrowserResearchTool(BaseTool):
    name = "browser_research"
    description = (
        "Delegate complex web browsing, research, or multi-page data extraction to the "
        "connected NIM Agent browser extension. The browser agent will navigate, search, "
        "and return structured findings and extracted tables."
    )
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "The research goal or web task description."},
            "context": {"type": "object", "description": "Optional context data (e.g. data to cross-check or target sites)."},
            "timeout_seconds": {"type": "integer", "description": "Timeout in seconds (default: 120).", "default": 120}
        },
        "required": ["query"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "browser"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        query = str(args.get("query"))
        task_context = args.get("context", {})
        timeout = int(args.get("timeout_seconds", 120))

        server = get_bridge_server()
        result = await server.delegate_browser_task(
            goal=query,
            context=task_context,
            timeout=timeout
        )

        return ToolResult(
            success=result.success,
            data={
                "summary": result.summary,
                "extracted_data": result.extracted_data,
                "screenshots_count": len(result.screenshots)
            },
            error=result.error
        )
