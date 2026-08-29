from typing import Any, Dict, Optional
from PIL import Image
from .screen import ScreenCaptureEngine

class ActionVerifier:
    """
    Post-Action Verification Engine.
    Verifies that a click, keystroke, or script produced an observable state change.
    """

    @classmethod
    def verify_screen_change(
        cls,
        before_img: Image.Image,
        after_img: Image.Image,
        threshold: float = 0.01
    ) -> Dict[str, Any]:
        """Compares before and after screenshots to confirm state change."""
        diff = ScreenCaptureEngine.compute_image_difference(before_img, after_img)
        changed = (diff > threshold)

        return {
            "verified": changed,
            "difference_score": diff,
            "status": "state_changed" if changed else "no_observable_change",
            "message": "UI state successfully modified." if changed else "Warning: No visual change detected on screen after action."
        }
