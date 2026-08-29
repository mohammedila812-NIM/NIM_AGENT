import asyncio
import logging
from typing import Any, Dict, List
from .base import BaseTool, ToolContext, ToolResult
from src.security.guard import ActionRiskLevel
from src.voice.tts import VoiceEngine
from src.voice.stt import SpeechToTextEngine
from src.voice.barge_in import BargeInController

logger = logging.getLogger(__name__)

_global_voice_engine = VoiceEngine()
_global_stt_engine = SpeechToTextEngine()
_global_barge_in_controller = BargeInController(voice_engine=_global_voice_engine, stt_engine=_global_stt_engine)


class SpeakTextTool(BaseTool):
    name = "speak_text"
    description = "Speak out text loudly to the user in a natural neural voice (JARVIS). Useful for spoken summaries, alerts, or conversational voice feedback."
    parameters = {
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "The text to speak aloud."},
            "voice": {"type": "string", "enum": ["jarvis", "friday", "christopher", "jenny", "sonia", "ryan"], "default": "jarvis", "description": "Voice persona."}
        },
        "required": ["text"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        text = str(args.get("text", "")).strip()
        voice = str(args.get("voice", "jarvis")).strip()

        if not text:
            return ToolResult(success=False, data=None, error="No text provided to speak.")

        asyncio.create_task(_global_voice_engine.speak(text, voice_override=voice))

        return ToolResult(
            success=True,
            data={
                "status": "speaking",
                "voice": voice,
                "text_length": len(text)
            }
        )


class ListenVoiceTool(BaseTool):
    name = "listen_voice"
    description = "Capture and transcribe spoken speech directly from the user's microphone in real time."
    parameters = {
        "type": "object",
        "properties": {
            "timeout": {"type": "number", "default": 5.0, "description": "Seconds to wait for speech to start."},
            "phrase_time_limit": {"type": "number", "default": 10.0, "description": "Maximum seconds for speech phrase."}
        }
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        timeout = float(args.get("timeout", 5.0))
        phrase_limit = float(args.get("phrase_time_limit", 10.0))

        loop = asyncio.get_running_loop()
        transcript = await loop.run_in_executor(None, _global_stt_engine.listen_once, timeout, phrase_limit)

        if transcript:
            return ToolResult(
                success=True,
                data={
                    "status": "captured",
                    "transcript": transcript
                }
            )
        else:
            return ToolResult(
                success=False,
                data=None,
                error="No intelligible speech detected within timeout."
            )


class ToggleVoiceInputTool(BaseTool):
    name = "toggle_voice_input"
    description = "Enable or disable continuous ambient microphone listening with noise-adaptive VAD and True Barge-In."
    parameters = {
        "type": "object",
        "properties": {
            "enabled": {"type": "boolean", "description": "True to activate ambient listening (/mic on), False to deactivate (/mic off)."}
        },
        "required": ["enabled"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        enabled = bool(args.get("enabled", True))
        if enabled:
            _global_barge_in_controller.enable_voice_listener()
            msg = "Voice listener & True Barge-In enabled."
        else:
            _global_barge_in_controller.disable_voice_listener()
            msg = "Voice listener disabled."

        return ToolResult(
            success=True,
            data={
                "enabled": enabled,
                "message": msg
            }
        )


class SetVoicePersonaTool(BaseTool):
    name = "set_voice_persona"
    description = "Switch the active neural TTS voice persona (JARVIS, FRIDAY, Christopher, Jenny, Sonia, Ryan)."
    parameters = {
        "type": "object",
        "properties": {
            "persona": {"type": "string", "enum": ["jarvis", "friday", "christopher", "jenny", "sonia", "ryan"], "description": "Desired voice persona."}
        },
        "required": ["persona"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        persona = str(args.get("persona", "jarvis")).lower().strip()
        _global_voice_engine.set_persona(persona)
        return ToolResult(
            success=True,
            data={
                "persona": persona,
                "voice_id": _global_voice_engine.voice
            }
        )


def get_voice_tools() -> List[BaseTool]:
    """Returns all voice actuation and perception tools."""
    return [
        SpeakTextTool(),
        ListenVoiceTool(),
        ToggleVoiceInputTool(),
        SetVoicePersonaTool(),
    ]
