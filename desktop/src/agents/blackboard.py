"""
blackboard.py
-------------
Shared multi-agent Blackboard for NIM JARVIS Desktop subagent system.

Inspired by the NIM_Web SubAgent Blackboard pattern (subagent-runner.ts).
Provides:
  - Thread-safe finding publication (publish_finding)
  - Goal satisfaction check (is_goal_satisfied)
  - Token/budget guard (check_worker_budget)
  - Domain-locked tool allowlist per agent type
  - Observable state for the GUI/CLI to subscribe to

Architecture:
    ┌────────────┐   publish_finding()   ┌──────────────┐
    │ SubAgent A │ ──────────────────── ▶│  Blackboard  │
    └────────────┘                       │   (shared)   │
    ┌────────────┐   get_findings()      │              │
    │ SubAgent B │ ◀─────────────────── │  findings[]  │
    └────────────┘   is_goal_satisfied() │  token_used  │
    ┌────────────┐                       └──────────────┘
    │ Main Loop  │ ◀─── subscribe() (callback on new finding)
    └────────────┘
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Any, Callable, Dict, List, Optional


# ---------------------------------------------------------------------------
# Finding dataclass
# ---------------------------------------------------------------------------

@dataclass
class Finding:
    """A piece of information published by a subagent."""
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    agent_id: str = ""               # which agent published this
    agent_type: str = ""             # e.g. "research", "perception", "system"
    topic: str = ""                  # semantic tag, e.g. "file_list", "element_located"
    content: Any = None              # the actual result data
    confidence: float = 1.0          # 0.0–1.0
    timestamp: float = field(default_factory=time.time)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "agent_id": self.agent_id,
            "agent_type": self.agent_type,
            "topic": self.topic,
            "content": self.content,
            "confidence": self.confidence,
            "timestamp": self.timestamp,
            "metadata": self.metadata,
        }


# ---------------------------------------------------------------------------
# Token Budget
# ---------------------------------------------------------------------------

@dataclass
class TokenBudget:
    """Tracks token usage across all subagents."""
    max_tokens: int = 200_000
    used_tokens: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def consume(self, tokens: int) -> bool:
        """Consume tokens. Returns False (budget exceeded) if over limit."""
        with self._lock:
            if self.used_tokens + tokens > self.max_tokens:
                return False
            self.used_tokens += tokens
            return True

    @property
    def remaining(self) -> int:
        return max(0, self.max_tokens - self.used_tokens)

    @property
    def is_exhausted(self) -> bool:
        return self.used_tokens >= self.max_tokens

    def reset(self) -> None:
        with self._lock:
            self.used_tokens = 0


# ---------------------------------------------------------------------------
# Blackboard
# ---------------------------------------------------------------------------

class Blackboard:
    """
    Shared memory space for all subagents in a NIM task execution.

    Usage::

        bb = Blackboard(goal="Find all Python files in project")
        bb.subscribe(lambda f: print(f"New finding: {f.topic}"))

        # In subagent:
        bb.publish_finding(Finding(
            agent_id="agent-1",
            agent_type="system",
            topic="file_list",
            content=["main.py", "utils.py"],
        ))

        # Check completion:
        if bb.is_goal_satisfied():
            results = bb.get_findings()
    """

    def __init__(
        self,
        goal: str = "",
        max_tokens: int = 200_000,
        goal_satisfied_fn: Optional[Callable[[List[Finding]], bool]] = None,
    ):
        self.goal = goal
        self._findings: List[Finding] = []
        self._lock = threading.RLock()
        self._subscribers: List[Callable[[Finding], None]] = []
        self._budget = TokenBudget(max_tokens=max_tokens)
        self._goal_satisfied_fn = goal_satisfied_fn
        self._is_complete = False
        self._created_at = time.time()

    # ---- Publish ----

    def publish_finding(self, finding: Finding) -> None:
        """Add a finding and notify all subscribers."""
        with self._lock:
            self._findings.append(finding)
        # Notify subscribers outside lock (avoid deadlock)
        for sub in self._subscribers:
            try:
                sub(finding)
            except Exception:
                pass

    def publish(
        self,
        topic: str,
        content: Any,
        agent_id: str = "",
        agent_type: str = "",
        confidence: float = 1.0,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Finding:
        """Convenience method: create and publish a Finding."""
        f = Finding(
            agent_id=agent_id,
            agent_type=agent_type,
            topic=topic,
            content=content,
            confidence=confidence,
            metadata=metadata or {},
        )
        self.publish_finding(f)
        return f

    # ---- Query ----

    def get_findings(
        self,
        topic: Optional[str] = None,
        agent_id: Optional[str] = None,
        min_confidence: float = 0.0,
    ) -> List[Finding]:
        """Return findings, optionally filtered by topic, agent, or confidence."""
        with self._lock:
            findings = list(self._findings)
        if topic:
            findings = [f for f in findings if f.topic == topic]
        if agent_id:
            findings = [f for f in findings if f.agent_id == agent_id]
        if min_confidence > 0:
            findings = [f for f in findings if f.confidence >= min_confidence]
        return findings

    def get_latest(self, topic: str) -> Optional[Finding]:
        """Get the most recent finding for a given topic."""
        findings = self.get_findings(topic=topic)
        return findings[-1] if findings else None

    @property
    def finding_count(self) -> int:
        with self._lock:
            return len(self._findings)

    # ---- Goal Satisfaction ----

    def is_goal_satisfied(self) -> bool:
        """
        Check if the goal has been achieved.
        Uses a custom function if provided, otherwise checks if any findings exist.
        """
        if self._is_complete:
            return True
        with self._lock:
            findings = list(self._findings)
        if self._goal_satisfied_fn:
            result = self._goal_satisfied_fn(findings)
        else:
            result = len(findings) > 0
        if result:
            self._is_complete = True
        return result

    def mark_complete(self) -> None:
        """Manually mark goal as satisfied."""
        self._is_complete = True

    # ---- Budget ----

    def check_worker_budget(self, tokens_needed: int) -> bool:
        """
        Check if there's enough token budget for a worker to proceed.
        Consumes the tokens if budget is available.
        Returns True if worker may proceed, False if budget is exhausted.
        """
        return self._budget.consume(tokens_needed)

    @property
    def budget_remaining(self) -> int:
        return self._budget.remaining

    @property
    def budget_exhausted(self) -> bool:
        return self._budget.is_exhausted

    # ---- Subscriptions ----

    def subscribe(self, callback: Callable[[Finding], None]) -> None:
        """Register a callback that fires on every new finding."""
        self._subscribers.append(callback)

    def unsubscribe(self, callback: Callable[[Finding], None]) -> None:
        self._subscribers = [s for s in self._subscribers if s != callback]

    # ---- Reset ----

    def clear(self) -> None:
        """Clear all findings and reset completion state."""
        with self._lock:
            self._findings.clear()
        self._is_complete = False
        self._budget.reset()

    # ---- Serialization ----

    def to_dict(self) -> dict:
        with self._lock:
            findings = [f.to_dict() for f in self._findings]
        return {
            "goal": self.goal,
            "finding_count": len(findings),
            "is_complete": self._is_complete,
            "budget_remaining": self.budget_remaining,
            "created_at": self._created_at,
            "findings": findings,
        }

    def summary(self) -> str:
        """Human-readable summary of blackboard state."""
        with self._lock:
            n = len(self._findings)
        return (
            f"Blackboard[goal={self.goal!r}, findings={n}, "
            f"complete={self._is_complete}, budget_left={self.budget_remaining}]"
        )


# ---------------------------------------------------------------------------
# Global blackboard singleton (per-task lifecycle)
# ---------------------------------------------------------------------------

_current_blackboard: Optional[Blackboard] = None
_bb_lock = threading.Lock()


def get_blackboard() -> Blackboard:
    """Return the current task blackboard, creating one if needed."""
    global _current_blackboard
    with _bb_lock:
        if _current_blackboard is None:
            _current_blackboard = Blackboard()
        return _current_blackboard


def new_blackboard(
    goal: str = "",
    max_tokens: int = 200_000,
    goal_satisfied_fn: Optional[Callable[[List[Finding]], bool]] = None,
) -> Blackboard:
    """Create and install a new blackboard for a task."""
    global _current_blackboard
    with _bb_lock:
        _current_blackboard = Blackboard(
            goal=goal,
            max_tokens=max_tokens,
            goal_satisfied_fn=goal_satisfied_fn,
        )
        return _current_blackboard
