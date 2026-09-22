from typing import List, Optional
from .types import ProviderConfig

PROVIDER_PRESETS: List[ProviderConfig] = [
    ProviderConfig(
        id="nim-cloud",
        label="NVIDIA NIM (cloud)",
        base_url="https://integrate.api.nvidia.com/v1",
        default_model="meta/llama-3.2-11b-vision-instruct"
    ),
    ProviderConfig(
        id="nim-local",
        label="NVIDIA NIM (self-hosted — private)",
        base_url="http://localhost:8000/v1",
        default_model="meta/llama-3.3-70b-instruct"
    ),
    ProviderConfig(
        id="gemini",
        label="Google AI Studio (Gemini API)",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai",
        default_model="models/gemini-flash-lite-latest"
    ),
    ProviderConfig(
        id="openai",
        label="OpenAI",
        base_url="https://api.openai.com/v1",
        default_model="gpt-4o"
    ),
    ProviderConfig(
        id="groq",
        label="Groq (fast inference)",
        base_url="https://api.groq.com/openai/v1",
        default_model="llama-3.3-70b-versatile"
    ),
    ProviderConfig(
        id="ollama",
        label="Ollama (local — private)",
        base_url="http://localhost:11434/v1",
        default_model="llama3.2"
    ),
    ProviderConfig(
        id="kira",
        label="Kira AI",
        base_url="https://kiraai.vn/api/v1",
        default_model="glm-5.3-flash"
    ),
    ProviderConfig(
        id="custom",
        label="Custom endpoint",
        base_url="http://localhost:8080/v1",
        default_model="default"
    ),
    ProviderConfig(
        id="explabs",
        label="Experiential Labs",
        base_url="https://api.experientiallabs.ai/v1",
        default_model="claude-fable-5",
        default_temperature=1.0
    )
]

PROVIDER_ALIASES = {
    "exp_ai": "explabs",
    "exp-ai": "explabs",
    "experientiallabs": "explabs",
    "experiential-labs": "explabs",
}

def get_provider_preset(provider_id: str) -> Optional[ProviderConfig]:
    provider_id = provider_id.strip().lower()
    provider_id = PROVIDER_ALIASES.get(provider_id, provider_id)
    for preset in PROVIDER_PRESETS:
        if preset.id == provider_id:
            return preset
    return None
