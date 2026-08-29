import json
import logging
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional
from src.config import LOGS_DIR

logger = logging.getLogger(__name__)

@dataclass
class AuditEvent:
    event_id: str
    timestamp: float
    event_type: str  # "tool_call", "hitl_prompt", "hitl_response", "security_block", "snapshot", "undo", "error"
    risk_level: str  # "safe", "moderate", "destructive", "critical"
    tool_name: Optional[str] = None
    arguments: Optional[Dict[str, Any]] = None
    result_summary: Optional[str] = None
    task_id: Optional[str] = None
    blocked: bool = False
    details: Optional[str] = None

class SecurityAuditLogger:
    """
    Append-only security audit logger.
    Tracks all agent actions, tool executions, and security decisions.
    """

    def __init__(self, log_dir: Path = LOGS_DIR):
        self.log_dir = log_dir
        self.log_file = self.log_dir / "audit.jsonl"

    def log(self, event: AuditEvent):
        try:
            with open(self.log_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(asdict(event)) + "\n")
        except Exception as e:
            logger.error("Failed to write to audit log: %s", e)

    def log_tool_call(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        risk_level: str,
        task_id: Optional[str] = None,
        result_summary: Optional[str] = None,
        blocked: bool = False,
        details: Optional[str] = None
    ):
        event = AuditEvent(
            event_id=f"evt_{int(time.time()*1000)}",
            timestamp=time.time(),
            event_type="tool_call",
            risk_level=risk_level,
            tool_name=tool_name,
            arguments=arguments,
            result_summary=result_summary,
            task_id=task_id,
            blocked=blocked,
            details=details
        )
        self.log(event)

    def get_recent_logs(self, limit: int = 50) -> List[Dict[str, Any]]:
        if not self.log_file.exists():
            return []
        try:
            with open(self.log_file, "r", encoding="utf-8") as f:
                lines = f.readlines()
                return [json.loads(line) for line in reversed(lines[-limit:])]
        except Exception as e:
            logger.error("Failed to read audit logs: %s", e)
            return []

_global_audit_logger: Optional[SecurityAuditLogger] = None

def get_audit_logger() -> SecurityAuditLogger:
    global _global_audit_logger
    if _global_audit_logger is None:
        _global_audit_logger = SecurityAuditLogger()
    return _global_audit_logger
