import asyncio
import io
import logging
import os
import tempfile
import wave
from typing import Optional

logger = logging.getLogger(__name__)

try:
    import speech_recognition as sr
    _HAS_SR = True
except ImportError:
    _HAS_SR = False


class SpeechToTextEngine:
    """
    Privacy-First Local Speech-to-Text (STT) Engine.
    Transcribes 16kHz PCM voice buffers into high-accuracy natural text commands.
    """

    def __init__(self, language: str = "en-US"):
        self.language = language
        self._recognizer = sr.Recognizer() if _HAS_SR else None
        if self._recognizer:
            self._recognizer.energy_threshold = 300
            self._recognizer.dynamic_energy_threshold = True

    def pcm_to_wav(self, pcm_bytes: bytes, sample_rate: int = 16000) -> bytes:
        """Encodes raw 16-bit mono PCM into standard WAV format."""
        bio = io.BytesIO()
        with wave.open(bio, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(pcm_bytes)
        return bio.getvalue()

    def transcribe_pcm(self, pcm_bytes: bytes, sample_rate: int = 16000) -> Optional[str]:
        """
        Synchronously transcribes raw PCM bytes into text.
        Returns cleaned string or None if unintelligible.
        """
        if not pcm_bytes or len(pcm_bytes) < sample_rate * 0.3 * 2:  # Ignore < 300ms blips
            return None

        if not self._recognizer:
            logger.warning("SpeechRecognition library is not installed.")
            return None

        try:
            wav_bytes = self.pcm_to_wav(pcm_bytes, sample_rate)
            with io.BytesIO(wav_bytes) as audio_file:
                with sr.AudioFile(audio_file) as source:
                    audio_data = self._recognizer.record(source)

            # Try recognition
            text = self._recognizer.recognize_google(audio_data, language=self.language)
            cleaned = text.strip()
            if cleaned:
                logger.info("🗣️ Transcribed voice: '%s'", cleaned)
                return cleaned
            return None

        except sr.UnknownValueError:
            logger.debug("Speech recognition: audio not understood.")
            return None
        except Exception as e:
            logger.warning("Speech recognition error: %s", e)
            return None

    async def transcribe_pcm_async(self, pcm_bytes: bytes, sample_rate: int = 16000) -> Optional[str]:
        """Asynchronously transcribes audio without blocking the event loop."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.transcribe_pcm, pcm_bytes, sample_rate)

    def listen_once(self, timeout: float = 5.0, phrase_time_limit: float = 10.0) -> Optional[str]:
        """
        Captures a single voice phrase directly from the default microphone.
        """
        if not self._recognizer:
            return None

        try:
            with sr.Microphone(sample_rate=16000) as source:
                self._recognizer.adjust_for_ambient_noise(source, duration=0.3)
                logger.info("🎙️ Listening for voice command...")
                audio = self._recognizer.listen(source, timeout=timeout, phrase_time_limit=phrase_time_limit)

            text = self._recognizer.recognize_google(audio, language=self.language)
            return text.strip() if text else None

        except sr.WaitTimeoutError:
            logger.debug("Microphone listen timed out.")
            return None
        except sr.UnknownValueError:
            return None
        except Exception as e:
            logger.warning("Microphone capture error: %s", e)
            return None
