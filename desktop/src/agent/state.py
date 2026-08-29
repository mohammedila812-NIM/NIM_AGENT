import json
import time
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional
from src.config import CHECKPOINTS_DIR

class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    PAUSED_HITL = "paused_hitl"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

@dataclass
class AgentStep:
    index: int
    reasoning: Optional[str] = None
    tool_name: Optional[str] = None
    tool_args: Optional[Dict[str, Any]] = None
    tool_result: Optional[str] = None
    snapshot_id: Optional[str] = None
    success: bool = True
    timestamp: float = field(default_factory=time.time)

@dataclass
class TaskState:
    task_id: str
    goal: str
    status: TaskStatus = TaskStatus.PENDING
    steps: List[AgentStep] = field(default_factory=list)
    final_answer: Optional[str] = None
    error: Optional[str] = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    estimated_usd_cost: float = 0.0
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def add_step(self, step: AgentStep):
        self.steps.append(step)
        self.updated_at = time.time()
        self.save_checkpoint()

    def save_checkpoint(self):
        ckpt_file = CHECKPOINTS_DIR / f"{self.task_id}.json"
        try:
            data = asdict(self)
            data["status"] = self.status.value
            with open(ckpt_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception:
            pass

    @classmethod
    def load_checkpoint(cls, task_id: str) -> Optional["TaskState"]:
        ckpt_file = CHECKPOINTS_DIR / f"{task_id}.json"
        if not ckpt_file.exists():
            return None
        try:
            with open(ckpt_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            data["status"] = TaskStatus(data.get("status", "pending"))
            data["steps"] = [AgentStep(**s) for s in data.get("steps", [])]
            return cls(**data)
        except Exception:
            return None
