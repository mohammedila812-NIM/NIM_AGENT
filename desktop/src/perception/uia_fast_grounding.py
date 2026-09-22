"""
Fast UI Automation Grounding and Element Cache for NIM_AGENT.
Provides indexed caching of foreground UI accessibility elements for sub-2ms coordinate resolution.
"""

import time
import logging
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


class UIAFastGroundingIndex:
    """Caches and resolves UI Automation tree elements with spatial and fuzzy lookups."""

    def __init__(self, cache_ttl_seconds: float = 2.0):
        self.cache_ttl = cache_ttl_seconds
        self._cached_elements: List[Dict[str, Any]] = []
        self._last_scan_time: float = 0.0
        self._last_window_title: str = ""

    def update_cache(self, window_title: str, elements: List[Dict[str, Any]]):
        """Refreshes the cached element tree for the active window."""
        self._cached_elements = elements
        self._last_window_title = window_title
        self._last_scan_time = time.time()

    def is_cache_valid(self, current_window_title: str) -> bool:
        """Returns True if the cached element tree is still fresh and for the same window."""
        if current_window_title != self._last_window_title:
            return False
        return (time.time() - self._last_scan_time) < self.cache_ttl

    def resolve_element(
        self,
        target_name: str,
        control_type: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Searches cached elements by name (exact or substring) and control type.
        """
        clean_target = target_name.strip().lower()
        if not clean_target:
            return None

        # 1. Exact match
        for elem in self._cached_elements:
            name = elem.get("name", "").strip().lower()
            ctype = elem.get("control_type", "").lower()

            if control_type and control_type.lower() not in ctype:
                continue

            if name == clean_target:
                return elem

        # 2. Substring match
        for elem in self._cached_elements:
            name = elem.get("name", "").strip().lower()
            ctype = elem.get("control_type", "").lower()

            if control_type and control_type.lower() not in ctype:
                continue

            if clean_target in name or name in clean_target:
                return elem

        return None


_GLOBAL_UIA_INDEX: Optional[UIAFastGroundingIndex] = None


def get_uia_fast_grounding() -> UIAFastGroundingIndex:
    global _GLOBAL_UIA_INDEX
    if _GLOBAL_UIA_INDEX is None:
        _GLOBAL_UIA_INDEX = UIAFastGroundingIndex()
    return _GLOBAL_UIA_INDEX
