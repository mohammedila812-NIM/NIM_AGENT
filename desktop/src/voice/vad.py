"""
vad.py — Voice v2: Real-Time Neural Voice Activity Detection (VAD)
==================================================================
Primary backend: Silero-VAD (ONNX) — neural phone-grade voice detection.
Fallback: webrtcvad + adaptive energy threshold.

Features:
- Pre-speech ring buffer (160ms) to capture initial onset consonants
- Post-speech tail buffer (250ms) to preserve word endings
- Multi-frame onset debouncing to reject keyboard clicks / ambient noise
- Auto noise-floor calibration on first 600ms
"""

from __future__ import annotations

import collections
import logging
import math
import struct
import threading
import time
from typing import Callable, Deque, List, Optional
import numpy as np

logger = logging.getLogger(__name__)

# ── availability checks ───────────────────────────────────────────────────────
try:
    import torch
    import silero_vad
    _HAS_SILERO = True
except Exception:
    _HAS_SILERO = False

try:
    import webrtcvad
    _HAS_WEBRTCVAD = True
except ImportError:
    _HAS_WEBRTCVAD = False


class VADEngine:
    """
    Real-Time Noise-Adaptive Voice Activity Detection (VAD).
    Monitors 16kHz mono microphone stream with Silero Neural VAD
    and provides instant speech onset and end-of-speech segment signals.
    """

    SAMPLE_RATE = 16000     # 16kHz
    FRAME_SIZE = 512        # 512 samples = 32ms (optimal for Silero-VAD)
    MIN_ONSET_FRAMES = 3    # Require 3 consecutive speech frames (~96ms) — rejects keyboard clicks
    PRE_SPEECH_FRAMES = 6   # Keep 6 frames (~192ms) prior to onset — catch leading consonants
    TAIL_SILENCE_FRAMES = 8 # Keep 8 frames (~256ms) after silence detected

    def __init__(
        self,
        vad_mode: int = 2,
        energy_threshold: float = 0.03,
        speech_prob_threshold: float = 0.45,   # Slightly lower threshold: catch quieter/faster speech
        silence_timeout_sec: float = 1.0,       # 1.0s: allow pauses within a sentence (was 0.7s)
        on_speech_start: Optional[Callable[[], None]] = None,
        on_speech_end: Optional[Callable[[bytes], None]] = None,
        on_level: Optional[Callable[[float], None]] = None,
        on_partial_audio: Optional[Callable[[bytes], None]] = None,
    ):
        self.vad_mode = vad_mode
        self.energy_threshold = energy_threshold
        self.speech_prob_threshold = speech_prob_threshold
        self.silence_timeout_sec = silence_timeout_sec
        self.on_speech_start = on_speech_start
        self.on_speech_end = on_speech_end
        self.on_level = on_level
        self.on_partial_audio = on_partial_audio

        # Model initialization
        self._silero_model = None
        self._silero_loaded = False
        self._init_silero()

        self._webrtc_vad = webrtcvad.Vad(self.vad_mode) if _HAS_WEBRTCVAD else None

        self._is_running = False
        self._thread: Optional[threading.Thread] = None
        self._is_speaking = False
        self._consecutive_speech = 0
        self._pre_buffer: Deque[bytes] = collections.deque(maxlen=self.PRE_SPEECH_FRAMES)
        self._speech_frames: List[bytes] = []
        self._silence_start: Optional[float] = None
        self._calibration_frames: List[float] = []
        self._calibrated = False

    def _init_silero(self):
        if not _HAS_SILERO:
            return
        try:
            self._silero_model = silero_vad.load_silero_vad(onnx=True)
            self._silero_loaded = True
            logger.info("✅ Silero-VAD neural model initialized (ONNX).")
        except Exception as e:
            logger.warning("Silero-VAD initialization failed, using webrtcvad fallback: %s", e)
            self._silero_loaded = False

    @property
    def is_running(self) -> bool:
        return self._is_running

    def calibrate_noise_floor(self, samples: List[float]):
        """Calibrates baseline ambient noise floor from initial audio samples."""
        if samples:
            avg_energy = float(np.mean(samples))
            self.energy_threshold = max(0.025, avg_energy * 4.0)  # 4x noise floor (was 3x)
            self._calibrated = True
            logger.debug(
                "VAD auto-calibrated: baseline energy=%.4f, threshold=%.4f",
                avg_energy,
                self.energy_threshold,
            )

    def compute_frame_energy(self, pcm_bytes: bytes) -> float:
        """Calculates normalized RMS energy for a 16-bit PCM audio frame."""
        if not pcm_bytes:
            return 0.0
        count = len(pcm_bytes) // 2
        format_str = f"<{count}h"
        try:
            shorts = struct.unpack(format_str, pcm_bytes)
            sum_squares = sum(s * s for s in shorts)
            rms = math.sqrt(sum_squares / count) / 32768.0
            return float(min(1.0, rms))
        except Exception:
            return 0.0

    def _check_is_speech(self, pcm_bytes: bytes, energy: float) -> bool:
        """Evaluates speech probability using Silero neural VAD or webrtcvad fallback."""
        if self._silero_loaded and self._silero_model is not None:
            try:
                # Convert 16-bit PCM to float32 tensor
                count = len(pcm_bytes) // 2
                if count >= 256:
                    audio_np = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
                    # Pad to nearest 512 if necessary
                    if len(audio_np) % 512 != 0:
                        pad_len = 512 - (len(audio_np) % 512)
                        audio_np = np.pad(audio_np, (0, pad_len))
                    # Take first 512 samples for inference
                    chunk_tensor = torch.from_numpy(audio_np[:512])
                    prob = self._silero_model(chunk_tensor, self.SAMPLE_RATE).item()
                    return prob >= self.speech_prob_threshold
            except Exception as e:
                logger.debug("Silero VAD frame eval error: %s", e)

        # Fallback to webrtcvad + energy gate
        if energy > self.energy_threshold:
            if self._webrtc_vad is not None:
                try:
                    # webrtcvad accepts 10, 20, or 30ms (160, 320, 480 samples = 960 bytes)
                    slice_len = min(len(pcm_bytes), 960)
                    if slice_len in (320, 640, 960):
                        return self._webrtc_vad.is_speech(pcm_bytes[:slice_len], self.SAMPLE_RATE)
                    elif len(pcm_bytes) >= 960:
                        return self._webrtc_vad.is_speech(pcm_bytes[:960], self.SAMPLE_RATE)
                    return True
                except Exception:
                    return True
            return True

        return False

    def process_frame(self, pcm_bytes: bytes) -> bool:
        """
        Processes a single PCM frame with onset debounce, ring buffer & tail preservation.
        """
        if not pcm_bytes:
            return False

        energy = self.compute_frame_energy(pcm_bytes)

        # Initial calibration period (first 20 frames = ~600ms)
        if not self._calibrated:
            self._calibration_frames.append(energy)
            if len(self._calibration_frames) >= 20:
                self.calibrate_noise_floor(self._calibration_frames)
            return False

        if self.on_level:
            self.on_level(min(1.0, energy * 4.0))

        is_speech_frame = self._check_is_speech(pcm_bytes, energy)
        now = time.time()

        if is_speech_frame:
            self._consecutive_speech += 1
            self._silence_start = None

            if not self._is_speaking and self._consecutive_speech >= self.MIN_ONSET_FRAMES:
                self._is_speaking = True
                # Include pre-speech buffer so leading consonants aren't lost
                self._speech_frames = list(self._pre_buffer) + [pcm_bytes]
                logger.info("🎙️ Voice activity onset detected (Neural VAD).")
                if self.on_speech_start:
                    self.on_speech_start()
            elif self._is_speaking:
                self._speech_frames.append(pcm_bytes)

        else:
            self._consecutive_speech = max(0, self._consecutive_speech - 1)
            if not self._is_speaking:
                self._pre_buffer.append(pcm_bytes)
            else:
                self._speech_frames.append(pcm_bytes)
                if self._silence_start is None:
                    self._silence_start = now
                elif (now - self._silence_start) >= self.silence_timeout_sec:
                    # Speech segment complete
                    self._is_speaking = False
                    self._consecutive_speech = 0
                    total_audio = b"".join(self._speech_frames)
                    self._speech_frames = []
                    self._pre_buffer.clear()
                    self._silence_start = None
                    logger.info("🎙️ Voice activity ended (%d bytes).", len(total_audio))
                    if self.on_speech_end:
                        self.on_speech_end(total_audio)

        return is_speech_frame

    def start(self):
        """Starts real-time microphone listening loop."""
        if self._is_running:
            return
        self._is_running = True
        self._calibration_frames = []
        self._calibrated = False
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()
        logger.info("VAD Engine started listening on microphone.")

    def stop(self):
        """Stops microphone capture."""
        self._is_running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.0)
        self._is_speaking = False
        self._speech_frames = []
        self._pre_buffer.clear()
        logger.info("VAD Engine stopped.")

    def get_status(self) -> dict:
        return {
            "backend": "Silero-VAD (ONNX)" if self._silero_loaded else ("webrtcvad" if _HAS_WEBRTCVAD else "energy"),
            "running": self._is_running,
            "calibrated": self._calibrated,
            "energy_threshold": round(self.energy_threshold, 4),
            "speech_prob_threshold": self.speech_prob_threshold,
        }

    def _capture_loop(self):
        """Continuous microphone stream capture via sounddevice."""
        try:
            import sounddevice as sd

            def audio_callback(indata, frames, time_info, status):
                if not self._is_running:
                    raise sd.CallbackStop()
                pcm_data = (indata[:, 0] * 32767).astype(np.int16).tobytes()
                self.process_frame(pcm_data)

            with sd.InputStream(
                samplerate=self.SAMPLE_RATE,
                channels=1,
                blocksize=self.FRAME_SIZE,
                dtype="float32",
                callback=audio_callback,
            ):
                while self._is_running:
                    time.sleep(0.05)

        except Exception as e:
            logger.warning("Microphone stream error in VADEngine: %s", e)
            self._is_running = False

