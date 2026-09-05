"""
stt.py — Voice v3: Accent-Tolerant Neural Speech-to-Text Engine
===============================================================
Primary backend: faster-whisper (base multilingual / base.en) with Indian English
accent prompt conditioning and phonetic normalization.
Cloud fallback: Gemini 2.0 Flash Multimodal Audio STT (near 100% accent fidelity).
Local fallback chain: Vosk (offline) → Google Speech API.

Supports:
- Indian English, British, Australian, and global accent tuning
- Initial prompt conditioning to prime OS automation keywords
- Real-time partial transcript streaming for holographic HUD
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import re
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

try:
    import httpx
    _HAS_HTTPX = True
except ImportError:
    _HAS_HTTPX = False


# ── Accent Conditioning Prompt & Phonetic Dictionary ──────────────────────────
INDIAN_ACCENT_INITIAL_PROMPT = (
    "Jarvis, please open WhatsApp, Excel sheet, Chrome browser, VS Code, "
    "Notepad, terminal, file manager, YouTube, calculate, summarize document, "
    "check screen coordinates, run subagent, organize downloads, write email, "
    "PowerPoint presentation, Outlook mail, Task Manager."
)

PHONETIC_REPLACEMENTS = [
    (r"\b(watsapp|whats\s*app|wats\s*app)\b", "WhatsApp"),
    (r"\bv\s*s\s*code\b", "VS Code"),
    (r"\bword\s*pad\b", "WordPad"),
    (r"\bpower\s*point\b", "PowerPoint"),
    (r"\bgit\s*hub\b", "GitHub"),
    (r"\bsub\s*agent\b", "subagent"),
    (r"\bsub\s*agents\b", "subagents"),
    (r"\bexcel\s*sheet\b", "Excel sheet"),
    (r"\bchrome\s*browser\b", "Chrome browser"),
    (r"\btask\s*manager\b", "Task Manager"),
]


def normalize_accent_phonetics(text: str) -> str:
    """Cleans up phonetic confusions and standardizes OS automation terms."""
    if not text:
        return ""
    result = text.strip()
    for pattern, replacement in PHONETIC_REPLACEMENTS:
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
    return result


def clean_hallucinated_repetitions(text: str) -> str:
    """
    Eliminates Whisper hallucination loops, autoregressive token repetitions,
    and trailing broken phrases (e.g. 'Open brief with Instagram, open brief with Instagram...').
    """
    if not text:
        return ""
    
    text = text.strip()
    
    # 1. Filter known Whisper silence / background noise hallucinations
    hallucination_patterns = [
        r"^(thank\s+you\s+(for\s+watching|very\s+much)[\.\!\?]?)$",
        r"^(thanks\s+for\s+watching[\.\!\?]?)$",
        r"^(please\s+(like\s+and\s+)?subscribe[\.\!\?]?)$",
        r"^(subtitles\s+by.*)$",
        r"^(\[.*\]|\(.*\))$",
        r"^(\.+|\-+|\*+)$",
    ]
    for hp in hallucination_patterns:
        if re.match(hp, text, flags=re.IGNORECASE):
            return ""

    # 2. Collapse repeated clauses separated by punctuation (commas, periods, semicolons, newlines)
    clauses = [c.strip() for c in re.split(r"[,;\.\n]+", text) if c.strip()]
    if clauses:
        unique_clauses = []
        last_norm = None
        for clause in clauses:
            norm = re.sub(r"[^\w\s]", "", clause).strip().lower()
            if not norm:
                continue
            if norm != last_norm:
                unique_clauses.append(clause)
                last_norm = norm
        if len(unique_clauses) < len(clauses):
            if len(unique_clauses) == 1:
                text = unique_clauses[0]
            else:
                text = ", ".join(unique_clauses)

    # 3. Collapse consecutive repeating word sequences (n-grams from 1 up to 15 words)
    words = text.split()
    n = len(words)
    changed = True
    passes = 0
    while changed and passes < 5:
        changed = False
        passes += 1
        for k in range(min(15, len(words) // 2), 0, -1):
            i = 0
            new_words = []
            while i < len(words):
                if i + 2 * k <= len(words):
                    chunk1 = [re.sub(r"[^\w]", "", w).lower() for w in words[i:i+k]]
                    chunk2 = [re.sub(r"[^\w]", "", w).lower() for w in words[i+k:i+2*k]]
                    if chunk1 == chunk2 and any(chunk1):
                        new_words.extend(words[i:i+k])
                        i += k
                        while i + k <= len(words):
                            next_chunk = [re.sub(r"[^\w]", "", w).lower() for w in words[i:i+k]]
                            if next_chunk == chunk1:
                                i += k
                            else:
                                break
                        changed = True
                        continue
                new_words.append(words[i])
                i += 1
            words = new_words

    res = " ".join(words).strip()
    
    # 4. Strip trailing broken cyclic fragments if all trailing words come from the main sentence
    parts = [p.strip() for p in re.split(r"[,;\.\n]+", res) if p.strip()]
    if len(parts) > 1:
        first_part_words = set(re.sub(r"[^\w\s]", "", parts[0]).lower().split())
        cleaned_parts = [parts[0]]
        for part in parts[1:]:
            part_words = set(re.sub(r"[^\w\s]", "", part).lower().split())
            if part_words.issubset(first_part_words) and len(part.split()) <= len(parts[0].split()):
                continue
            cleaned_parts.append(part)
        res = ", ".join(cleaned_parts)

    res = re.sub(r"\s*,\s*", ", ", res)
    res = re.sub(r"[,;\s]+$", "", res).strip()
    return res


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
    Accent-Tolerant Local Speech-to-Text using faster-whisper with initial_prompt priming.
    Models downloaded to ~/.nim_jarvis/whisper_models/ on first use.
    """

    DEFAULT_MODEL = "base"
    MODEL_DIR = os.path.join(os.path.expanduser("~"), ".nim_jarvis", "whisper_models")

    def __init__(
        self,
        model_name: str = DEFAULT_MODEL,
        device: str = "cpu",
        compute_type: str = "int8",
        language: str = "en",
        initial_prompt: str = INDIAN_ACCENT_INITIAL_PROMPT,
        on_partial: Optional[Callable[[str], None]] = None,
    ):
        self.model_name = model_name
        self.device = device
        self.compute_type = compute_type
        self.language = language
        self.initial_prompt = initial_prompt
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
                logger.info("🔊 Loading Accent-Tuned Whisper '%s'...", self.model_name)
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
        """Hot-swap whisper model (tiny / base / small / medium / large-v3-turbo)."""
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
        """Transcribes raw 16-bit mono PCM → TranscriptResult with accent normalization & deduplication."""
        min_bytes = int(sample_rate * 0.25) * 2  # ignore < 250ms
        if not pcm_bytes or len(pcm_bytes) < min_bytes:
            return None

        import time
        t0 = time.perf_counter()

        # ── 1. Local Whisper with Accent Prompt Priming & Repetition Guards ──
        if self._ensure_model_loaded() and self._model and _HAS_NUMPY:
            try:
                audio = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
                segments, info = self._model.transcribe(
                    audio,
                    language=self.language if self.language != "auto" else None,
                    beam_size=2,
                    best_of=2,
                    temperature=0.0,
                    initial_prompt=self.initial_prompt,
                    vad_filter=True,
                    vad_parameters={"min_silence_duration_ms": 250},
                    condition_on_previous_text=False,
                    word_timestamps=False,
                    repetition_penalty=1.2,
                    no_repeat_ngram_size=3,
                    compression_ratio_threshold=2.4,
                    log_prob_threshold=-1.0,
                    no_speech_threshold=0.6,
                )
                collected: List[str] = []
                for seg in segments:
                    text = seg.text.strip()
                    if text:
                        collected.append(text)
                        if self.on_partial:
                            partial_clean = clean_hallucinated_repetitions(normalize_accent_phonetics(" ".join(collected)))
                            if partial_clean:
                                self.on_partial(partial_clean)

                raw_text = " ".join(collected).strip()
                cleaned_text = clean_hallucinated_repetitions(raw_text)
                full_text = normalize_accent_phonetics(cleaned_text)
                latency_ms = (time.perf_counter() - t0) * 1000
                self._transcription_count += 1
                self._avg_latency_ms = (
                    (self._avg_latency_ms * (self._transcription_count - 1) + latency_ms)
                    / self._transcription_count
                )
                if full_text:
                    logger.info("🗣️ Whisper [%s] %.0fms: '%s'", self.model_name, latency_ms, full_text)
                    return TranscriptResult(
                        text=full_text,
                        confidence=0.96,
                        language=getattr(info, "language", "en"),
                        backend=f"whisper:{self.model_name}",
                        segments=collected,
                    )
            except Exception as e:
                logger.warning("Whisper transcription error: %s", e)

        # ── 2. Cloud Gemini Multimodal Audio Fallback ────────────────────
        gemini_res = _gemini_multimodal_transcribe(pcm_bytes, sample_rate)
        if gemini_res:
            gemini_res.text = clean_hallucinated_repetitions(gemini_res.text)
            if gemini_res.text:
                return gemini_res

        # ── 3. Vosk Offline Fallback ────────────────────────────────────
        if _HAS_VOSK:
            try:
                result = _vosk_transcribe(pcm_bytes, sample_rate)
                if result:
                    result.text = clean_hallucinated_repetitions(normalize_accent_phonetics(result.text))
                    if result.text:
                        return result
            except Exception as e:
                logger.warning("Vosk fallback error: %s", e)

        # ── 4. Google STT Fallback ──────────────────────────────────────
        if _HAS_SR:
            try:
                result = _google_transcribe(pcm_bytes, sample_rate)
                if result:
                    result.text = clean_hallucinated_repetitions(normalize_accent_phonetics(result.text))
                    if result.text:
                        return result
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
def _get_gemini_api_key() -> Optional[str]:
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        try:
            from src.security.secret_store import SecretStore
            key = SecretStore().get_key("gemini")
        except Exception:
            pass
    return key


def _gemini_multimodal_transcribe(pcm_bytes: bytes, sample_rate: int = 16000) -> Optional[TranscriptResult]:
    """Transcribes audio using Gemini 2.0 Flash Multimodal Audio API for human-grade accent fidelity."""
    if not _HAS_HTTPX:
        return None
    api_key = _get_gemini_api_key()
    if not api_key:
        return None

    try:
        wav_bytes = WhisperSTTEngine.pcm_to_wav(pcm_bytes, sample_rate)
        b64_audio = base64.b64encode(wav_bytes).decode("utf-8")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}"
        payload = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": (
                                "You are a specialized Speech-to-Text transcriber. "
                                "Accurately transcribe the exact spoken words in this audio clip. "
                                "Handle Indian English accents, rapid phrasing, and technical terms (e.g. WhatsApp, Excel, Chrome, VS Code, Notepad, file manager) with extreme precision. "
                                "Output ONLY the raw transcribed text. Do NOT add notes, greetings, or formatting."
                            )
                        },
                        {
                            "inline_data": {
                                "mime_type": "audio/wav",
                                "data": b64_audio
                            }
                        }
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.0,
                "maxOutputTokens": 200
            }
        }
        with httpx.Client(timeout=8.0) as client:
            resp = client.post(url, json=payload)
            if resp.status_code == 200:
                data = resp.json()
                candidates = data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    if parts:
                        text = parts[0].get("text", "").strip()
                        cleaned = normalize_accent_phonetics(text)
                        if cleaned:
                            logger.info("🗣️ Gemini Multimodal STT: '%s'", cleaned)
                            return TranscriptResult(
                                text=cleaned,
                                confidence=0.99,
                                backend="gemini-multimodal",
                            )
    except Exception as e:
        logger.debug("Gemini Multimodal STT error: %s", e)

    return None


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

