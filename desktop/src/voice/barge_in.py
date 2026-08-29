import time
from typing import Callable, Optional
from .tts import VoiceEngine

class BargeInManager:
    """
    Manages live voice interruption (Barge-In).
    Detects when the user begins speaking while JARVIS is talking and halts audio immediately.
    """

    def __init__(self, voice_engine: VoiceEngine):
        self.voice_engine = voice_engine
        self.on_barge_in_callback: Optional[Callable[[], None]] = None
        self._last_speech_time = 0.0

    def user_speech_detected(self):
        """Called when microphone detects voice input."""
        if self.voice_engine.is_speaking:
            self.voice_engine.stop_speaking()
            if self.on_barge_in_callback:
                self.on_barge_in_callback()
        self._last_speech_time = time.time()
