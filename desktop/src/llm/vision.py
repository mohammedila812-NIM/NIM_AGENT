"""
Dual-Provider Vision Client
============================
Sends image analysis requests to a dedicated Vision LLM provider (e.g. NVIDIA NIM
with a vision-capable model like `nvidia/llama-3.2-90b-vision-instruct`) independently
of the main brain model (e.g. Gemini).

This enables the pattern:
  Gemini (Brain) — plans the task, decides to look at screen
        → calls vision_describe_image tool
             → VisionClient sends image to NVIDIA NIM vision model
                  → returns rich visual description
        → Gemini reads description, continues task
"""
import base64
import io
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from PIL import Image

from src.security.secrets import get_secret_store
from src.llm.providers import get_provider_preset

logger = logging.getLogger(__name__)

# Default vision provider & model (overrideable via /vision_provider command or config)
DEFAULT_VISION_PROVIDER = "nim-cloud"
DEFAULT_VISION_MODEL = "nvidia/llama-3.2-90b-vision-instruct"

# Fallback vision providers in priority order if primary is unavailable
VISION_PROVIDER_PRIORITY = [
    ("nim-cloud",  "nvidia/llama-3.2-90b-vision-instruct"),
    ("openai",     "gpt-4o"),
    ("ollama",     "llava:13b"),
]

def _encode_image_b64(img: Image.Image, max_side: int = 1920, quality: int = 85) -> Tuple[str, str]:
    """
    Encodes a PIL Image to a base64 JPEG/PNG string for multimodal API.
    Downscales large images to max_side to save tokens.
    Returns (base64_string, media_type).
    """
    w, h = img.size
    if max(w, h) > max_side:
        scale = max_side / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)

    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=quality, optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return b64, "image/jpeg"


class VisionClient:
    """
    Async client for multimodal vision inference.
    Operates independently of the main brain LLM client so any combination
    of providers can be mixed: e.g. Gemini brain + NVIDIA vision.
    """

    def __init__(
        self,
        vision_provider_id: Optional[str] = None,
        vision_model: Optional[str] = None,
        timeout: float = 30.0
    ):
        self.secret_store = get_secret_store()
        self.timeout = timeout
        self._provider_id, self._model = self._resolve_provider(
            vision_provider_id or os.environ.get("JARVIS_VISION_PROVIDER", DEFAULT_VISION_PROVIDER),
            vision_model or os.environ.get("JARVIS_VISION_MODEL", DEFAULT_VISION_MODEL),
        )

    def _resolve_provider(self, requested_id: str, requested_model: str) -> Tuple[str, str]:
        """Validates requested provider has a key configured, falls back down priority list."""
        # Try requested provider first
        key = self.secret_store.get_key(requested_id)
        preset = get_provider_preset(requested_id)
        if preset and key:
            return requested_id, requested_model

        # Walk fallback priority list
        for p_id, p_model in VISION_PROVIDER_PRIORITY:
            k = self.secret_store.get_key(p_id)
            pr = get_provider_preset(p_id)
            if pr and k:
                logger.info(
                    "VisionClient: '%s' not configured, falling back to '%s' with model '%s'",
                    requested_id, p_id, p_model
                )
                return p_id, p_model

        # Last resort: keep requested (will fail at runtime with a clear error)
        return requested_id, requested_model

    @property
    def _base_url(self) -> str:
        preset = get_provider_preset(self._provider_id)
        if preset:
            return preset.base_url.rstrip("/")
        return "https://integrate.api.nvidia.com/v1"

    @property
    def _api_key(self) -> Optional[str]:
        return self.secret_store.get_key(self._provider_id)

    def get_status(self) -> Dict[str, Any]:
        """Returns current vision provider configuration for /vision_status command."""
        return {
            "provider": self._provider_id,
            "model": self._model,
            "base_url": self._base_url,
            "api_key_configured": bool(self._api_key),
        }

    async def describe_image(
        self,
        img: Image.Image,
        prompt: str = "Describe all visible text, UI elements, and content in this screenshot in detail.",
        detail: str = "high"
    ) -> Dict[str, Any]:
        """
        Sends an image to the vision model and returns a detailed text description.
        This is the core call used by the vision_describe_image tool.
        """
        api_key = self._api_key
        if not api_key:
            return {
                "success": False,
                "error": (
                    f"Vision provider '{self._provider_id}' has no API key configured. "
                    f"Run: /key {self._provider_id} <your_api_key>"
                ),
                "provider": self._provider_id,
                "model": self._model,
            }

        b64, media_type = _encode_image_b64(img)
        image_url_obj = {
            "type": "image_url",
            "image_url": {
                "url": f"data:{media_type};base64,{b64}",
                "detail": detail
            }
        }

        payload = {
            "model": self._model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        image_url_obj
                    ]
                }
            ],
            "max_tokens": 1024,
            "temperature": 0.2,
        }

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    f"{self._base_url}/chat/completions",
                    headers=headers,
                    json=payload
                )
                resp.raise_for_status()
                data = resp.json()

            choices = data.get("choices", [])
            if choices:
                description = choices[0].get("message", {}).get("content", "")
                usage = data.get("usage", {})
                return {
                    "success": True,
                    "description": description,
                    "provider": self._provider_id,
                    "model": self._model,
                    "tokens_used": usage.get("total_tokens", 0),
                }
            else:
                return {
                    "success": False,
                    "error": f"Vision model returned empty response: {data}",
                    "provider": self._provider_id,
                    "model": self._model,
                }

        except httpx.HTTPStatusError as e:
            return {
                "success": False,
                "error": f"Vision API HTTP {e.response.status_code}: {e.response.text[:300]}",
                "provider": self._provider_id,
                "model": self._model,
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"Vision request failed: {str(e)}",
                "provider": self._provider_id,
                "model": self._model,
            }

    async def describe_image_file(
        self,
        image_path: str,
        prompt: str = "Describe all visible text, UI elements, and content in detail."
    ) -> Dict[str, Any]:
        """Convenience wrapper: load image from disk path and describe it."""
        try:
            img = Image.open(image_path)
        except Exception as e:
            return {"success": False, "error": f"Cannot open image '{image_path}': {e}"}
        return await self.describe_image(img, prompt=prompt)


# Module-level singleton (initialized lazily)
_vision_client: Optional[VisionClient] = None

def get_vision_client(
    provider_id: Optional[str] = None,
    model: Optional[str] = None,
    force_reinit: bool = False
) -> VisionClient:
    """Returns the module-level VisionClient singleton, creating it if needed."""
    global _vision_client
    if _vision_client is None or force_reinit:
        _vision_client = VisionClient(
            vision_provider_id=provider_id,
            vision_model=model
        )
    return _vision_client
