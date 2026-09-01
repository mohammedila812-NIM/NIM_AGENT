"""
stt.py — Voice v2: Local Speech-to-Text Engine
===============================================
Primary backend: faster-whisper (tiny.en) — local, offline, ~200ms, 95%+ accuracy.
Fallback chain: Vosk → Google Speech API.

Model auto-downloads to ~/.nim_jarvis/whisper_models/ on first use (~75MB tiny.en).
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import struct
import threading
import wave
from dataclasses import dataclass, field
from typing import Callable, List, Optional

logger = logging.getLogger(__name__)

# ── availability checks ───────────────────────────────────────────────────────
try:
    from faster_whisper import WhisperModel as _WhisperModel
    _HAS_WHISPER = True
except ImportError:
    _HAS_WHISPER = False

try:
    import vosk as _vosk
    _HAS_VOSK = True
except ImportError:
    _HAS_VOSK = False

try:
    import speech_recognition as _sr
    _HAS_SR = True
except ImportError:
    _HAS_SR = False

try:
    import numpy as np
    _HAS_NUMPY = True
except ImportError:
    _HAS_NUMPY = False


# ── result dataclass ──────────────────────────────────────────────────────────
@dataclass
class TranscriptResult:
    text: str
    confidence: float = 1.0
    language: str = "en"
    backend: str = "whisper"
    segments: List[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return bool(self.text.strip())


# ── Whisper engine ────────────────────────────────────────────────────────────
class WhisperSTTEngine:
    """
    Local Speech-to-Text using faster-whisper.
    Models downloaded to ~/.nim_jarvis/whisper_models/ on first use.
    """

    DEFAULT_MODEL = "tiny.en"
    MODEL_DIR = os.path.join(os.path.expanduser("~"), ".nim_jarvis", "whisper_models")

    def __init__(
        self,
        model_name: str = DEFAULT_MODEL,
        device: str = "cpu",
        compute_type: str = "int8",
        language: str = "en",
        on_partial: Optional[Callable[[str], None]] = None,
    ):
        self.model_name = model_name
        self.device = device
        self.compute_type = compute_type
        self.language = language
        self.on_partial = on_partial
        self._model = None
        self._model_loaded = False
        self._load_error: Optional[str] = None
        self._avg_latency_ms: float = 0.0
        self._transcription_count: int = 0
        self._lock = threading.Lock()

    def _ensure_model_loaded(self) -> bool:
        if self._model_loaded:
            return True
        if not _HAS_WHISPER:
            return False
        with self._lock:
            if self._model_loaded:
                return True
            try:
                os.makedirs(self.MODEL_DIR, exist_ok=True)
                logger.info("🔊 Loading Whisper '%s' (first use may download ~75MB)...", self.model_name)
                self._model = _WhisperModel(
                    self.model_name,
                    device=self.device,
                    compute_type=self.compute_type,
                    download_root=self.MODEL_DIR,
                )
                self._model_loaded = True
                logger.info("✅ Whisper '%s' ready.", self.model_name)
                return True
            except Exception as e:
                self._load_error = str(e)
                logger.warning("⚠️ Whisper load failed: %s", e)
                return False

    def switch_model(self, model_name: str) -> bool:
        """Hot-swap whisper model (tiny.en / base.en / small.en)."""
        with self._lock:
            self._model = None
            self._model_loaded = False
            self.model_name = model_name
        return self._ensure_model_loaded()

    @staticmethod
    def pcm_to_wav(pcm_bytes: bytes, sample_rate: int = 16000) -> bytes:
        bio = io.BytesIO()
        with wave.open(bio, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(pcm_bytes)
        return bio.getvalue()

    def transcribe_pcm(
        self,
        pcm_bytes: bytes,
        sample_rate: int = 16000,
    ) -> Optional[TranscriptResult]:
        """Transcribes raw 16-bit mono PCM → TranscriptResult or None."""
        min_bytes = int(sample_rate * 0.30) * 2  # ignore < 300ms
        if not pcm_bytes or len(pcm_bytes) < min_bytes:
            return None

        import time
        t0 = time.perf_counter()

        # ── Whisper ───────────────────────────────────────────────────────
        if self._ensure_model_loaded() and self._model and _HAS_NUMPY:
            try:
                audio = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
                segments, info = self._model.transcribe(
                    audio,
                    language=self.language if self.language != "auto" else None,
                    beam_size=1,
                    best_of=1,
                    temperature=0.0,
                    vad_filter=True,
                    vad_parameters={"min_silence_duration_ms": 300},
                    condition_on_previous_text=False,
                    word_timestamps=False,
                )
                collected: List[str] = []
                for seg in segments:
                    text = seg.text.strip()
                    if text:
                        collected.append(text)
                        if self.on_partial:
                            self.on_partial(" ".join(collected))

                full_text = " ".join(collected).strip()
                latency_ms = (time.perf_counter() - t0) * 1000
                self._transcription_count += 1
                self._avg_latency_ms = (
                    (self._avg_latency_ms * (self._transcription_count - 1) + latency_ms)
                    / self._transcription_count
                )
                if not full_text:
                    return None
                logger.info("🗣️ Whisper [%s] %.0fms: '%s'", self.model_name, latency_ms, full_text)
                return TranscriptResult(
                    text=full_text,
                    confidence=0.95,
                    language=getattr(info, "language", "en"),
                    backend=f"whisper:{self.model_name}",
                    segments=collected,
                )
            except Exception as e:
                logger.warning("Whisper transcription error: %s", e)

        # ── Vosk fallback ─────────────────────────────────────────────────
        if _HAS_VOSK:
            try:
                result = _vosk_transcribe(pcm_bytes, sample_rate)
                if result:
                    return result
            except Exception as e:
                logger.warning("Vosk fallback error: %s", e)

        # ── Google fallback ───────────────────────────────────────────────
        if _HAS_SR:
            try:
                return _google_transcribe(pcm_bytes, sample_rate)
            except Exception as e:
                logger.debug("Google STT fallback error: %s", e)

        return None

    async def transcribe_pcm_async(
        self,
        pcm_bytes: bytes,
        sample_rate: int = 16000,
    ) -> Optional[TranscriptResult]:
        """Non-blocking async wrapper — runs in thread executor."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.transcribe_pcm, pcm_bytes, sample_rate)

    def get_status(self) -> dict:
        return {
            "backend": f"faster-whisper:{self.model_name}" if self._model_loaded else _detect_backend(),
            "model": self.model_name,
            "model_loaded": self._model_loaded,
            "load_error": self._load_error,
            "avg_latency_ms": round(self._avg_latency_ms, 1),
            "transcriptions": self._transcription_count,
            "language": self.language,
        }


# ── fallback helpers ──────────────────────────────────────────────────────────
_vosk_model_instance = None


def _vosk_transcribe(pcm_bytes: bytes, sample_rate: int = 16000) -> Optional[TranscriptResult]:
    import json
    global _vosk_model_instance
    if _vosk_model_instance is None:
        vosk_path = os.path.join(os.path.expanduser("~"), ".nim_jarvis", "vosk_model")
        if not os.path.isdir(vosk_path):
            return None
        _vosk_model_instance = _vosk.Model(vosk_path)
    rec = _vosk.KaldiRecognizer(_vosk_model_instance, sample_rate)
    rec.AcceptWaveform(pcm_bytes)
    res = json.loads(rec.FinalResult())
    text = res.get("text", "").strip()
    return TranscriptResult(text=text, confidence=res.get("confidence", 0.8), backend="vosk") if text else None


def _google_transcribe(pcm_bytes: bytes, sample_rate: int = 16000) -> Optional[TranscriptResult]:
    recognizer = _sr.Recognizer()
    wav_bytes = WhisperSTTEngine.pcm_to_wav(pcm_bytes, sample_rate)
    with io.BytesIO(wav_bytes) as f:
        with _sr.AudioFile(f) as src:
            audio = recognizer.record(src)
    try:
        text = recognizer.recognize_google(audio, language="en-US").strip()
        return TranscriptResult(text=text, confidence=0.85, backend="google") if text else None
    except _sr.UnknownValueError:
        return None


def _detect_backend() -> str:
    if _HAS_WHISPER:
        return "faster-whisper (not yet loaded)"
    if _HAS_VOSK:
        return "vosk"
    if _HAS_SR:
        return "google-cloud"
    return "none"


# ── singleton ─────────────────────────────────────────────────────────────────
_stt_engine: Optional[WhisperSTTEngine] = None
_stt_lock = threading.Lock()


def get_stt_engine(
    model_name: str = WhisperSTTEngine.DEFAULT_MODEL,
    on_partial: Optional[Callable[[str], None]] = None,
) -> WhisperSTTEngine:
    global _stt_engine
    with _stt_lock:
        if _stt_engine is None:
            _stt_engine = WhisperSTTEngine(model_name=model_name, on_partial=on_partial)
        elif on_partial and not _stt_engine.on_partial:
            _stt_engine.on_partial = on_partial
    return _stt_engine


# ── legacy shim (keeps old tests / imports working) ───────────────────────────
class SpeechToTextEngine(WhisperSTTEngine):
    """Backwards-compatible alias."""

    def __init__(self, language: str = "en-US"):
        super().__init__(model_name=WhisperSTTEngine.DEFAULT_MODEL)
        self.language = language.split("-")[0]
        self._recognizer = _sr.Recognizer() if _HAS_SR else None

    def transcribe_pcm(self, pcm_bytes: bytes, sample_rate: int = 16000):  # type: ignore[override]
        result = super().transcribe_pcm(pcm_bytes, sample_rate)
        return result.text if result else None

    async def transcribe_pcm_async(self, pcm_bytes: bytes, sample_rate: int = 16000):  # type: ignore[override]
        result = await super().transcribe_pcm_async(pcm_bytes, sample_rate)
        return result.text if result else None

    def listen_once(self, timeout: float = 5.0, phrase_time_limit: float = 10.0) -> Optional[str]:
        """
        Captures a single voice phrase directly from the default microphone.
        """
        if not self._recognizer or not _HAS_SR:
            return None

        try:
            with _sr.Microphone(sample_rate=16000) as source:
                self._recognizer.adjust_for_ambient_noise(source, duration=0.3)
                logger.info("🎙️ Listening for voice command...")
                audio = self._recognizer.listen(source, timeout=timeout, phrase_time_limit=phrase_time_limit)

            pcm_bytes = audio.get_raw_data(convert_rate=16000, convert_width=2)
            result = self.transcribe_pcm(pcm_bytes)
            if isinstance(result, str):
                return result
            return result.text if result else None

        except _sr.WaitTimeoutError:
            logger.debug("Microphone listen timed out.")
            return None
        except _sr.UnknownValueError:
            return None
        except Exception as e:
            logger.warning("Microphone capture error: %s", e)
            return None

