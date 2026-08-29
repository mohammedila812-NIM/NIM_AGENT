from typing import Any, Dict
from .base import BaseTool, ToolContext, ToolResult
from src.security.guard import ActionRiskLevel
from src.voice.tts import VoiceEngine

_global_voice_engine = VoiceEngine()

class SpeakTextTool(BaseTool):
    name = "speak_text"
    description = "Speak out text loudly to the user in a natural neural voice (JARVIS). Useful for spoken summaries, alerts, or interactive speech."
    parameters = {
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "The text to speak aloud."},
            "voice": {"type": "string", "enum": ["jarvis", "friday", "christopher", "jenny", "sonia"], "default": "jarvis", "description": "Voice persona."}
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

        # Non-blocking async speech in background
        import asyncio
        asyncio.create_task(_global_voice_engine.speak(text, voice_override=voice))

        return ToolResult(
            success=True,
            data={
                "status": "spoken",
                "voice": voice,
                "text_length": len(text)
            }
        )
