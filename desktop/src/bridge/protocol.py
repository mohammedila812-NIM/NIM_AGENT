import time
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

class BridgeMessageType(str, Enum):
    AUTH_REQUEST = "auth_request"
    AUTH_RESPONSE = "auth_response"
    BROWSER_TASK = "browser_task"
    BROWSER_RESULT = "browser_result"
    SCREEN_CONTEXT = "screen_context"
    HANDOFF_REQUEST = "handoff_request"
    PING = "ping"
    PONG = "pong"
    ERROR = "error"

@dataclass
class BrowserTaskPayload:
    task_id: str
    goal: str
    context: Dict[str, Any] = field(default_factory=dict)
    tool_allowlist: Optional[List[str]] = None
    timeout_seconds: int = 120

@dataclass
class BrowserResultPayload:
    task_id: str
    success: bool
    summary: str
    extracted_data: Optional[Any] = None
    screenshots: List[str] = field(default_factory=list)
    error: Optional[str] = None

@dataclass
class HandoffPayload:
    task_id: str
    direction: str  # "to_browser" | "to_desktop"
    reason: str     # "captcha_detected", "login_required", "file_downloaded"
    state_snapshot: Dict[str, Any] = field(default_factory=dict)

@dataclass
class BridgeMessage:
    type: BridgeMessageType
    payload: Dict[str, Any]
    msg_id: str = field(default_factory=lambda: f"msg_{uuid.uuid4().hex[:10]}")
    timestamp: float = field(default_factory=time.time)
    auth_token: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type.value if isinstance(self.type, BridgeMessageType) else str(self.type),
            "payload": self.payload,
            "msg_id": self.msg_id,
            "timestamp": self.timestamp,
            "auth_token": self.auth_token
        }
