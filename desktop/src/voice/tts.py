import asyncio
import logging
import os
import tempfile
import threading
from pathlib import Path
from typing import Optional
import edge_tts

logger = logging.getLogger(__name__)

# Initialize pygame mixer once per process for zero-latency audio playback
_pygame_initialized = False
_mixer_lock = threading.Lock()


def _ensure_mixer_init():
    global _pygame_initialized
    with _mixer_lock:
        if not _pygame_initialized:
            try:
                import pygame
                pygame.mixer.init(frequency=44100, size=-16, channels=2, buffer=512)
                _pygame_initialized = True
                logger.info("Pygame audio mixer initialized successfully.")
            except Exception as e:
                logger.warning("Failed to initialize pygame mixer: %s. Will fallback to alternative audio players.", e)
                _pygame_initialized = False


class VoiceEngine:
    """
    High-Performance Neural Text-to-Speech (TTS) Engine with True Barge-In.
    Uses edge-tts neural voices synthesized to MP3 and played in-process
    via pygame.mixer with sub-10ms atomic cutoff.
    """

    DEFAULT_VOICE = "en-US-GuyNeural"
    VOICES = {
        "jarvis": "en-US-GuyNeural",
        "friday": "en-US-AriaNeural",
        "christopher": "en-US-ChristopherNeural",
        "jenny": "en-US-JennyNeural",
        "sonia": "en-GB-SoniaNeural",
        "ryan": "en-GB-RyanNeural",
    }

    def __init__(self, voice_name: str = "jarvis"):
        self.voice_name = voice_name.lower()
        self.voice = self.VOICES.get(self.voice_name, self.DEFAULT_VOICE)
        self._is_speaking = False
        self._current_temp_file: Optional[str] = None
        self._stop_event = threading.Event()
        _ensure_mixer_init()

    @property
    def is_speaking(self) -> bool:
        return self._is_speaking

    def set_persona(self, voice_name: str):
        """Switches the active neural voice persona (e.g. 'jarvis', 'friday')."""
        self.voice_name = voice_name.lower()
        self.voice = self.VOICES.get(self.voice_name, self.DEFAULT_VOICE)
        logger.info("Voice persona set to '%s' (%s)", self.voice_name, self.voice)

    def stop_speaking(self):
        """
        True Barge-In Audio Halt:
        Immediately cuts ongoing audio playback in < 10ms and frees buffers.
        """
        self._stop_event.set()
        try:
            import pygame
            if pygame.mixer.get_init() and pygame.mixer.music.get_busy():
                pygame.mixer.music.stop()
                pygame.mixer.music.unload()
        except Exception:
            pass

        self._is_speaking = False
        logger.debug("Speech playback halted via Barge-In.")

    async def speak(self, text: str, voice_override: Optional[str] = None) -> bool:
        """
        Synthesizes text using edge-tts and plays audio in-process asynchronously.
        Returns True if playback finished cleanly, False if interrupted or failed.
        """
        if not text or not text.strip():
            return False

        # Stop any ongoing speech before starting new speech
        self.stop_speaking()
        self._stop_event.clear()

        clean_text = text.strip()
        selected_voice = self.VOICES.get(voice_override.lower(), self.voice) if voice_override else self.voice

        temp_audio = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tf:
                temp_audio = tf.name
            self._current_temp_file = temp_audio

            # Synthesize TTS MP3
            communicate = edge_tts.Communicate(clean_text, selected_voice)
            await communicate.save(temp_audio)

            if self._stop_event.is_set():
                return False

            self._is_speaking = True
            played = await self._play_audio_file(temp_audio)
            return played

        except Exception as e:
            logger.warning("TTS speech synthesis/playback failed: %s", e)
            return False

        finally:
            self._is_speaking = False
            if temp_audio and os.path.exists(temp_audio):
                try:
                    import pygame
                    if pygame.mixer.get_init():
                        pygame.mixer.music.unload()
                except Exception:
                    pass
                try:
                    os.unlink(temp_audio)
                except Exception:
                    pass

    async def _play_audio_file(self, file_path: str) -> bool:
        """Plays audio using pygame.mixer with fallback to system players."""
        try:
            import pygame
            if not pygame.mixer.get_init():
                pygame.mixer.init(frequency=44100, size=-16, channels=2, buffer=512)

            pygame.mixer.music.load(file_path)
            pygame.mixer.music.play()

            while pygame.mixer.music.get_busy():
                if self._stop_event.is_set():
                    pygame.mixer.music.stop()
                    pygame.mixer.music.unload()
                    return False
                await asyncio.sleep(0.05)

            pygame.mixer.music.unload()
            return True

        except Exception as e:
            logger.warning("Pygame playback failed: %s. Trying fallback audio player...", e)
            return await self._fallback_play(file_path)

    async def _fallback_play(self, file_path: str) -> bool:
        """Fallback playback using sounddevice / soundfile or winsound."""
        try:
            import soundfile as sf
            import sounddevice as sd
            data, fs = sf.read(file_path)
            sd.play(data, fs)
            while sd.get_stream() and sd.get_stream().active:
                if self._stop_event.is_set():
                    sd.stop()
                    return False
                await asyncio.sleep(0.05)
            return True
        except Exception as e:
            logger.warning("All audio playback fallbacks failed: %s", e)
            return False
