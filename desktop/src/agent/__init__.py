"""
Agent Orchestrator and ReAct Loop Subsystem
"""

from .prompts import SYSTEM_PROMPT, INTENT_CLASSIFICATION_PROMPT
from .state import TaskState, AgentStep, TaskStatus
from .memory import MemoryStore, get_memory_store

def __getattr__(name: str):
    if name == "AgentOrchestrator":
        from .loop import AgentOrchestrator
        return AgentOrchestrator
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = [
    "SYSTEM_PROMPT",
    "INTENT_CLASSIFICATION_PROMPT",
    "TaskState",
    "AgentStep",
    "TaskStatus",
    "MemoryStore",
    "get_memory_store",
    "AgentOrchestrator",
]
