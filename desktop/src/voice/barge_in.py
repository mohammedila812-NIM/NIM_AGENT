import asyncio
import logging
import threading
import time
from typing import Callable, Optional

from .tts import VoiceEngine
from .vad import VADEngine
from .stt import SpeechToTextEngine

logger = logging.getLogger(__name__)


class BargeInController:
    """
    Coordinated True Barge-In Controller.
    Synchronizes VAD, STT, TTS, and Agent task cancellation:
    1. Detects speech onset in < 30ms via VAD
    2. Instantly terminates TTS playback via pygame.mixer (< 10ms)
    3. Aborts in-flight LLM token streams & active tool executions ONLY if busy
    4. Transcribes the user's speech and routes it as the next incoming goal.
    """

    def __init__(
        self,
        voice_engine: Optional[VoiceEngine] = None,
        stt_engine: Optional[SpeechToTextEngine] = None,
        is_task_busy: Optional[Callable[[], bool]] = None,
        on_cancel_task: Optional[Callable[[], None]] = None,
        on_voice_command: Optional[Callable[[str], None]] = None,
        on_amplitude: Optional[Callable[[float], None]] = None,
    ):
        self.voice_engine = voice_engine or VoiceEngine()
        self.stt_engine = stt_engine or SpeechToTextEngine()
        self.is_task_busy = is_task_busy
        self.on_cancel_task = on_cancel_task
        self.on_voice_command = on_voice_command
        self.on_amplitude = on_amplitude

        self.vad_engine = VADEngine(
            on_speech_start=self._on_speech_start,
            on_speech_end=self._on_speech_end,
            on_level=self._on_level,
        )

        self._enabled = False
        self._last_speech_time = 0.0

    @property
    def is_listening(self) -> bool:
        return self.vad_engine.is_running

    def enable_voice_listener(self):
        """Enables ambient microphone listening and barge-in."""
        self._enabled = True
        self.vad_engine.start()
        logger.info("🎙️ Voice listener & True Barge-In activated.")

    def disable_voice_listener(self):
        """Disables ambient microphone listening."""
        self._enabled = False
        self.vad_engine.stop()
        logger.info("🔇 Voice listener disabled.")

    def _on_speech_start(self):
        """Triggered immediately upon voice activity onset."""
        self._last_speech_time = time.time()
        was_busy = False

        # 1. Instant Audio Cutoff (< 10ms)
        if self.voice_engine.is_speaking:
            logger.info("⚡ Barge-In: Halting ongoing TTS speech.")
            self.voice_engine.stop_speaking()
            was_busy = True

        # 2. Cancel in-flight agent task ONLY if agent is actually running a task
        is_running = self.is_task_busy() if self.is_task_busy else False
        if is_running and self.on_cancel_task:
            logger.info("⚡ Barge-In: Cancelling in-flight agent reasoning task.")
            try:
                self.on_cancel_task()
            except Exception as e:
                logger.warning("Error cancelling task on barge-in: %s", e)

    def _on_speech_end(self, audio_bytes: bytes):
        """Triggered when speech segment completes; transcribes audio."""
        if not audio_bytes:
            return

        def async_transcribe():
            transcript = self.stt_engine.transcribe_pcm(audio_bytes)
            if transcript and transcript.strip():
                logger.info("🗣️ Voice Command Recognized: '%s'", transcript)
                if self.on_voice_command:
                    self.on_voice_command(transcript)

        threading.Thread(target=async_transcribe, daemon=True).start()

    def _on_level(self, level: float):
        """Feeds live normalized microphone energy to HUD waveform."""
        if self.on_amplitude:
            self.on_amplitude(level)


# Backward compatibility alias
BargeInManager = BargeInController
