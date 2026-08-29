import logging
import os
from typing import Dict, List, Optional
import keyring
from src.config import KEYRING_SERVICE_NAME

logger = logging.getLogger(__name__)

KNOWN_PROVIDERS = [
    "nim-cloud",
    "nim-local",
    "gemini",
    "openai",
    "groq",
    "ollama",
    "kira",
    "custom",
    "search_api",
    "elevenlabs",
    "bridge_auth_token"
]

class SecretStore:
    """
    Manages API keys and sensitive tokens using the OS-native Credential Store
    (Windows Credential Manager / macOS Keychain / Linux Secret Service).
    Never writes secrets to plaintext files.
    """

    def __init__(self, service_name: str = KEYRING_SERVICE_NAME):
        self.service_name = service_name
        self._cache: Dict[str, str] = {}

    def set_key(self, provider_id: str, key_value: str) -> bool:
        """Store an API key securely."""
        try:
            keyring.set_password(self.service_name, provider_id, key_value.strip())
            self._cache[provider_id] = key_value.strip()
            logger.info("Stored API key for provider: %s", provider_id)
            return True
        except Exception as e:
            logger.error("Failed to store API key in OS keyring: %s", e)
            # Fallback to in-memory session cache
            self._cache[provider_id] = key_value.strip()
            return False

    def get_key(self, provider_id: str) -> Optional[str]:
        """Retrieve an API key securely."""
        # 1. Check in-memory cache first
        if provider_id in self._cache:
            return self._cache[provider_id]

        # 2. Check environment variable override (e.g. NIM_API_KEY, OPENAI_API_KEY)
        env_var_names = [
            f"{provider_id.upper().replace('-', '_')}_API_KEY",
            f"{provider_id.upper().replace('-', '_')}_KEY",
            f"NIM_{provider_id.upper().replace('-', '_')}_KEY",
        ]
        for var in env_var_names:
            if var in os.environ:
                val = os.environ[var].strip()
                self._cache[provider_id] = val
                return val

        # 3. Retrieve from OS keyring
        try:
            val = keyring.get_password(self.service_name, provider_id)
            if val:
                self._cache[provider_id] = val
                return val
        except Exception as e:
            logger.warning("Could not read key from keyring for %s: %s", provider_id, e)

        return None

    def delete_key(self, provider_id: str) -> bool:
        """Remove an API key from secure storage."""
        self._cache.pop(provider_id, None)
        try:
            keyring.delete_password(self.service_name, provider_id)
            logger.info("Deleted API key for provider: %s", provider_id)
            return True
        except Exception as e:
            logger.warning("Could not delete key from keyring: %s", e)
            return False

    def list_configured_providers(self) -> List[str]:
        """Returns list of providers that have an API key configured."""
        configured = []
        for pid in KNOWN_PROVIDERS:
            if self.get_key(pid):
                configured.append(pid)
        return configured

_global_secret_store: Optional[SecretStore] = None

def get_secret_store() -> SecretStore:
    global _global_secret_store
    if _global_secret_store is None:
        _global_secret_store = SecretStore()
    return _global_secret_store
