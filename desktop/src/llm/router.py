import logging
from dataclasses import dataclass
from typing import Optional
from .types import ProviderConfig
from .providers import PROVIDER_PRESETS, get_provider_preset
from src.security.secrets import get_secret_store

logger = logging.getLogger(__name__)

@dataclass
class RouteSelection:
    provider: ProviderConfig
    model: str
    is_local: bool

class ModelRouter:
    """
    Intelligent Model Router.
    Routes low-complexity tasks (intent classification, quick summaries, OCR cleanup)
    to fast/local models, and high-complexity tasks (planning, code generation, critique)
    to powerful flagship models.
    """

    def __init__(
        self,
        primary_provider_id: str = "gemini",
        primary_model: str = "models/gemini-flash-lite-latest",
        fast_provider_id: str = "gemini",
        fast_model: str = "models/gemini-flash-lite-latest",
        local_provider_id: str = "ollama",
        local_model: str = "llama3.2"
    ):
        self.primary_provider_id = primary_provider_id
        self.primary_model = primary_model
        self.fast_provider_id = fast_provider_id
        self.fast_model = fast_model
        self.local_provider_id = local_provider_id
        self.local_model = local_model
        self.secret_store = get_secret_store()

    def get_route(self, task_type: str = "planning") -> RouteSelection:
        """
        Determines the optimal provider and model based on task category.
        Task types: "intent", "planning", "critique", "doc_gen", "vision"
        """
        # 1. Fast / Cheap routing for simple classification or summaries if configured
        if task_type in ["intent", "classification", "cleanup"]:
            fast_preset = get_provider_preset(self.fast_provider_id)
            fast_key = self.secret_store.get_key(self.fast_provider_id)
            if fast_preset and fast_key:
                fast_preset.api_key = fast_key
                return RouteSelection(provider=fast_preset, model=self.fast_model, is_local=False)

        # 2. Check primary configured provider
        primary_preset = get_provider_preset(self.primary_provider_id)
        primary_key = self.secret_store.get_key(self.primary_provider_id)

        if primary_preset and (primary_key or "local" in primary_preset.id or "localhost" in primary_preset.base_url):
            primary_preset.api_key = primary_key
            is_local = "local" in primary_preset.id or "localhost" in primary_preset.base_url
            return RouteSelection(provider=primary_preset, model=self.primary_model, is_local=is_local)

        # 3. If primary has no key, look for ANY other provider that has a key configured
        configured_ids = self.secret_store.list_configured_providers()
        for cid in configured_ids:
            preset = get_provider_preset(cid)
            key = self.secret_store.get_key(cid)
            if preset and key:
                preset.api_key = key
                return RouteSelection(provider=preset, model=preset.default_model, is_local=False)

        # 4. Fallback to local Ollama if available
        local_preset = get_provider_preset(self.local_provider_id)
        return RouteSelection(
            provider=local_preset or (primary_preset or PROVIDER_PRESETS[0]),
            model=self.local_model,
            is_local=True
        )
