import re
import logging
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

class ActionRiskLevel(str, Enum):
    SAFE = "safe"
    MODERATE = "moderate"
    DESTRUCTIVE = "destructive"
    CRITICAL = "critical"

# Sensitive information patterns for read/write redaction
SENSITIVE_PATTERNS = [
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[REDACTED_SSN]"),
    (re.compile(r"\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12}|(?:2131|1800|35\d{3})\d{11})\b"), "[REDACTED_CARD]"),
    (re.compile(r"(?i)\b(?:password|passwd|secret|api[_-]?key|auth[_-]?token|bearer)\s*[:=]\s*['\"]?([a-zA-Z0-9_\-\.]{8,})['\"]?"), "[REDACTED_SECRET]"),
    (re.compile(r"\b[A-Za-z0-9+/]{40,}[=]{0,2}\b"), "[REDACTED_TOKEN]"),  # High entropy tokens / private keys
]

# Dangerous command keywords and patterns in shell execution
DANGEROUS_SHELL_PATTERNS = [
    re.compile(r"(?i)\b(format\s+[a-zA-Z]:|diskpart|bcdedit|vssadmin\s+delete)\b"),
    re.compile(r"(?i)\bdel\s+(/f\s+|/q\s+|/s\s+)*(c:\\|c:/\s*|\*.*)"),
    re.compile(r"(?i)\brmdir\s+(/s\s+|/q\s+)*(c:\\|c:/\s*)"),
    re.compile(r"(?i)\b(reg\s+delete\s+hklm|reg\s+delete\s+hkcr)\b"),
    re.compile(r"(?i)\b(Remove-Item\s+-Recurse\s+-Force\s+[A-Za-z]:\\)"),
]

class SecurityGuard:
    """
    Evaluates action risk, performs sensitive content redaction before cloud transmission,
    and enforces Human-in-the-Loop (HITL) requirements for destructive operations.
    """

    @staticmethod
    def redact_sensitive_text(text: str) -> str:
        """Sanitizes text by replacing sensitive patterns with placeholders."""
        if not text:
            return text
        sanitized = text
        for pattern, replacement in SENSITIVE_PATTERNS:
            sanitized = pattern.sub(replacement, sanitized)
        return sanitized

    @staticmethod
    def evaluate_shell_command(command: str) -> Tuple[ActionRiskLevel, Optional[str]]:
        """Checks if a shell command contains dangerous system-altering instructions."""
        for pattern in DANGEROUS_SHELL_PATTERNS:
            if pattern.search(command):
                return ActionRiskLevel.CRITICAL, f"Blocked dangerous system command pattern: {command}"
        return ActionRiskLevel.MODERATE, None

    @staticmethod
    def evaluate_tool_call(tool_name: str, args: Dict[str, Any]) -> ActionRiskLevel:
        """Classifies the risk level of an intended tool call."""
        if tool_name in ["delete_file", "kill_process", "run_command"]:
            if tool_name == "run_command":
                cmd = str(args.get("command", ""))
                risk, _ = SecurityGuard.evaluate_shell_command(cmd)
                return risk
            if tool_name == "kill_process":
                target = str(args.get("pid_or_name", "")).lower()
                if any(k in target for k in ["explorer", "system", "csrss", "svchost", "smss", "lsass", "services", "wininit", "winlogon", "dwm"]):
                    return ActionRiskLevel.CRITICAL
            return ActionRiskLevel.DESTRUCTIVE

        if tool_name == "send_hotkey":
            keys_val = str(args.get("keys") or args.get("hotkey_string") or "").lower()
            if any(k in keys_val for k in ["alt+f4", "win+l", "ctrl+alt+del", "ctrl+w"]):
                return ActionRiskLevel.MODERATE
            return ActionRiskLevel.SAFE

        if tool_name in ["click_element", "click_coordinate"]:
            el_name = str(args.get("element_name", "")).lower()
            if any(k in el_name for k in ["delete", "format", "erase", "uninstall", "shutdown", "restart"]):
                return ActionRiskLevel.MODERATE
            return ActionRiskLevel.SAFE

        if tool_name == "close_window":
            win_pat = str(args.get("window_pattern", "")).lower()
            if any(k in win_pat for k in ["explorer", "system", "csrss", "smss", "services", "lsass"]):
                return ActionRiskLevel.CRITICAL
            if bool(args.get("force", False)):
                return ActionRiskLevel.DESTRUCTIVE
            return ActionRiskLevel.MODERATE

        if tool_name in ["send_email", "reply_email"]:
            to_list = args.get("to", [])
            if isinstance(to_list, list) and len(to_list) > 5:
                return ActionRiskLevel.DESTRUCTIVE
            subj_body = (str(args.get("subject", "")) + " " + str(args.get("body", ""))).lower()
            if any(k in subj_body for k in ["wire transfer", "bank routing", "credit card", "payroll transfer", "urgent invoice"]):
                return ActionRiskLevel.DESTRUCTIVE
            return ActionRiskLevel.MODERATE

        if tool_name in ["write_file", "move_file", "set_clipboard"]:
            return ActionRiskLevel.MODERATE

        return ActionRiskLevel.SAFE
