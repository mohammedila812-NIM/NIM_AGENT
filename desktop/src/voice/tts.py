import asyncio
import logging
import os
import tempfile
from pathlib import Path
from typing import Optional
import edge_tts

logger = logging.getLogger(__name__)

class VoiceEngine:
    """
    Neural Text-to-Speech (TTS) Engine with real-time barge-in interruption.
    Uses edge-tts neural voices for zero-latency, studio-quality speech.
    """

    DEFAULT_VOICE = "en-US-GuyNeural"
    # Available high-quality voices
    VOICES = {
        "jarvis": "en-US-GuyNeural",
        "friday": "en-US-AriaNeural",
        "christopher": "en-US-ChristopherNeural",
        "jenny": "en-US-JennyNeural",
        "sonia": "en-GB-SoniaNeural",
        "ryan": "en-GB-RyanNeural"
    }

    def __init__(self, voice_name: str = "jarvis"):
        self.voice = self.VOICES.get(voice_name.lower(), self.DEFAULT_VOICE)
        self._current_process: Optional[asyncio.subprocess.Process] = None
        self._is_speaking = False

    @property
    def is_speaking(self) -> bool:
        return self._is_speaking

    def stop_speaking(self):
        """Instant Barge-In: Aborts any active speech playback."""
        if self._current_process:
            try:
                self._current_process.terminate()
            except Exception:
                pass
            self._current_process = None
        self._is_speaking = False
        logger.info("Speech playback interrupted via Barge-In.")

    async def speak(self, text: str, voice_override: Optional[str] = None) -> bool:
        """Synthesizes text and plays audio asynchronously."""
        if not text or not text.strip():
            return False

        # Stop any ongoing speech before starting new speech
        self.stop_speaking()

        clean_text = text.strip()
        selected_voice = self.VOICES.get(voice_override.lower(), self.voice) if voice_override else self.voice

        temp_audio = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tf:
                temp_audio = tf.name

            # Generate TTS MP3
            communicate = edge_tts.Communicate(clean_text, selected_voice)
            await communicate.save(temp_audio)

            self._is_speaking = True

            # Play audio on Windows via Headless PowerShell COM Player
            if os.name == "nt":
                clean_path = temp_audio.replace("'", "''")
                ps_cmd = (
                    f"$wmp = New-Object -ComObject wmplayer.ocx; "
                    f"$wmp.settings.volume = 100; "
                    f"$wmp.URL = '{clean_path}'; "
                    f"$wmp.controls.play(); "
                    f"Start-Sleep -Milliseconds 300; "
                    f"while ($wmp.playState -eq 3 -or $wmp.playState -eq 9 -or $wmp.playState -eq 6) {{ Start-Sleep -Milliseconds 100 }}; "
                    f"$wmp.close()"
                )
                self._current_process = await asyncio.create_subprocess_exec(
                    "powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps_cmd,
                    stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL
                )
                await self._current_process.wait()

            self._is_speaking = False
            return True

        except Exception as e:
            logger.warning("TTS speech failed: %s", e)
            self._is_speaking = False
            return False

        finally:
            self._is_speaking = False
            if temp_audio and os.path.exists(temp_audio):
                try:
                    os.remove(temp_audio)
                except Exception:
                    pass
