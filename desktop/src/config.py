import os
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

# Base directory for all NIM JARVIS Desktop state
APP_DIR = Path(os.environ.get("NIM_JARVIS_HOME", Path.home() / ".nim_jarvis"))
SNAPSHOTS_DIR = APP_DIR / "snapshots"
LOGS_DIR = APP_DIR / "logs"
MEMORY_DIR = APP_DIR / "memory"
CHECKPOINTS_DIR = APP_DIR / "checkpoints"
SANDBOX_DIR = APP_DIR / "sandbox"

# Ensure runtime directories exist
for directory in [APP_DIR, SNAPSHOTS_DIR, LOGS_DIR, MEMORY_DIR, CHECKPOINTS_DIR, SANDBOX_DIR]:
    directory.mkdir(parents=True, exist_ok=True)

# Keyring Service Name for OS Credentials
KEYRING_SERVICE_NAME = "nim_jarvis_desktop"

# WebSocket Bridge Configuration
DEFAULT_BRIDGE_HOST = "127.0.0.1"
DEFAULT_BRIDGE_PORT = 7432

# Agent Safety & Budget Defaults
DEFAULT_MAX_ITERATIONS = 25
DEFAULT_MAX_TOKENS_PER_TASK = 100_000
DEFAULT_DAILY_USD_BUDGET = 5.0
DEFAULT_SNAPSHOT_RETENTION_HOURS = 48
DEFAULT_KILL_SWITCH_KEY = "ctrl+alt+esc"

@dataclass
class AgentConfig:
    provider_id: str = "gemini"
    base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    model: str = "gemini-3.6-flash"
    api_key: Optional[str] = None
    temperature: float = 0.2
    max_tokens: int = 4096
    max_iterations: int = DEFAULT_MAX_ITERATIONS

    bridge_port: int = DEFAULT_BRIDGE_PORT
    enable_hitl: bool = True
    enable_undo: bool = True
    active_user_check: bool = True
    daily_budget_usd: float = DEFAULT_DAILY_USD_BUDGET
