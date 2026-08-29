import re
from typing import Any, Dict, List, Tuple

class SensitiveDataRedactor:
    """
    Scans and redacts sensitive data (API keys, SSNs, credit cards, passwords)
    from text, reasoning feeds, and visual overlays before external transmission.
    """

    PATTERNS = [
        # API Keys & Tokens
        (r"(?i)(api[_-]?key|bearer|token|secret|password|passwd|auth)\s*[:=]\s*['\"]?([a-zA-Z0-9_\-\.]{12,})['\"]?", r"\1: [REDACTED_SECRET]"),
        (r"(?i)sk-[a-zA-Z0-9]{20,}", "[REDACTED_OPENAI_KEY]"),
        (r"(?i)nvapi-[a-zA-Z0-9\-_]{20,}", "[REDACTED_NVIDIA_KEY]"),
        (r"(?i)gsk_[a-zA-Z0-9]{20,}", "[REDACTED_GROQ_KEY]"),
        (r"(?i)AIza[0-9A-Za-z-_]{35}", "[REDACTED_GOOGLE_KEY]"),
        (r"(?i)AQ\.[a-zA-Z0-9\-_]{40,}", "[REDACTED_GEMINI_KEY]"),
        (r"(?i)kira_[a-zA-Z0-9]{24,}", "[REDACTED_KIRA_KEY]"),
        (r"(?i)nim_pair_[a-zA-Z0-9]{16,}", "[REDACTED_PAIRING_TOKEN]"),

        # Credit Cards
        (r"\b(?:\d{4}[ -]?){3}\d{4}\b", "[REDACTED_CARD_NUMBER]"),

        # Social Security Numbers (US SSN)
        (r"\b\d{3}-\d{2}-\d{4}\b", "[REDACTED_SSN]"),

        # Generic Passwords / Private Keys
        (r"-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----", "[REDACTED_PRIVATE_KEY]"),
    ]

    @classmethod
    def redact_text(cls, text: str) -> str:
        """Redacts sensitive patterns from text strings."""
        if not text:
            return ""
        redacted = text
        for pattern, repl in cls.PATTERNS:
            redacted = re.sub(pattern, repl, redacted)
        return redacted

    @classmethod
    def redact_dict(cls, data: Dict[str, Any]) -> Dict[str, Any]:
        """Recursively redacts dictionary values."""
        clean_dict = {}
        for k, v in data.items():
            if isinstance(v, str):
                clean_dict[k] = cls.redact_text(v)
            elif isinstance(v, dict):
                clean_dict[k] = cls.redact_dict(v)
            elif isinstance(v, list):
                clean_dict[k] = [cls.redact_text(x) if isinstance(x, str) else x for x in v]
            else:
                clean_dict[k] = v
        return clean_dict
