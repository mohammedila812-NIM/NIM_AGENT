import logging
import math
import struct
import threading
import time
from typing import Callable, List, Optional
import numpy as np

logger = logging.getLogger(__name__)

try:
    import webrtcvad
    _HAS_WEBRTCVAD = True
except ImportError:
    _HAS_WEBRTCVAD = False


class VADEngine:
    """
    Real-Time Voice Activity Detection (VAD) with Adaptive Noise Calibration.
    Monitors 16kHz mono microphone stream, calculates RMS energy levels,
    detects speech onset/offset, and signals instant Barge-In.
    """

    SAMPLE_RATE = 16000     # 16kHz
    FRAME_DURATION_MS = 30  # 30ms frames (480 samples = 960 bytes for int16)
    FRAME_SIZE = int(SAMPLE_RATE * FRAME_DURATION_MS / 1000)

    def __init__(
        self,
        vad_mode: int = 2,
        energy_threshold: float = 0.02,
        silence_timeout_sec: float = 0.8,
        on_speech_start: Optional[Callable[[], None]] = None,
        on_speech_end: Optional[Callable[[bytes], None]] = None,
        on_level: Optional[Callable[[float], None]] = None,
    ):
        self.vad_mode = vad_mode
        self.energy_threshold = energy_threshold
        self.silence_timeout_sec = silence_timeout_sec
        self.on_speech_start = on_speech_start
        self.on_speech_end = on_speech_end
        self.on_level = on_level

        self._vad = webrtcvad.Vad(self.vad_mode) if _HAS_WEBRTCVAD else None
        self._is_running = False
        self._thread: Optional[threading.Thread] = None
        self._is_speaking = False
        self._speech_frames: List[bytes] = []
        self._silence_start: Optional[float] = None
        self._noise_floor: float = 0.01

    @property
    def is_running(self) -> bool:
        return self._is_running

    def calibrate_noise_floor(self, samples: List[float]):
        """Calibrates baseline ambient noise floor from initial audio samples."""
        if samples:
            avg_energy = float(np.mean(samples))
            self._noise_floor = max(0.005, avg_energy)
            self.energy_threshold = max(0.02, self._noise_floor * 2.5)
            logger.debug("Calibrated ambient noise floor: %.4f, threshold: %.4f", self._noise_floor, self.energy_threshold)

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

    def process_frame(self, pcm_bytes: bytes) -> bool:
        """
        Processes a single 30ms PCM frame.
        Returns True if voice activity was detected in this frame.
        """
        if len(pcm_bytes) != self.FRAME_SIZE * 2:
            return False

        energy = self.compute_frame_energy(pcm_bytes)
        if self.on_level:
            self.on_level(min(1.0, energy * 4.0))

        is_speech = False
        if self._vad is not None:
            try:
                is_speech = self._vad.is_speech(pcm_bytes, self.SAMPLE_RATE)
            except Exception:
                is_speech = energy > self.energy_threshold
        else:
            is_speech = energy > self.energy_threshold

        now = time.time()

        if is_speech:
            self._silence_start = None
            if not self._is_speaking:
                self._is_speaking = True
                self._speech_frames = []
                logger.info("🎙️ Voice activity onset detected (Barge-In).")
                if self.on_speech_start:
                    self.on_speech_start()

            self._speech_frames.append(pcm_bytes)

        elif self._is_speaking:
            self._speech_frames.append(pcm_bytes)
            if self._silence_start is None:
                self._silence_start = now
            elif (now - self._silence_start) >= self.silence_timeout_sec:
                # Speech ended
                self._is_speaking = False
                total_audio = b"".join(self._speech_frames)
                self._speech_frames = []
                self._silence_start = None
                logger.info("🎙️ Voice activity ended (Captured %d bytes).", len(total_audio))
                if self.on_speech_end:
                    self.on_speech_end(total_audio)

        return is_speech

    def start(self):
        """Starts real-time microphone listening loop in background thread."""
        if self._is_running:
            return
        self._is_running = True
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
        logger.info("VAD Engine stopped.")

    def _capture_loop(self):
        """Continuous sounddevice microphone stream capture."""
        try:
            import sounddevice as sd

            def audio_callback(indata, frames, time_info, status):
                if not self._is_running:
                    raise sd.CallbackStop()
                # Convert float32 [-1.0, 1.0] to int16 PCM
                pcm_data = (indata[:, 0] * 32767).astype(np.int16).tobytes()
                self.process_frame(pcm_data)

            with sd.InputStream(
                samplerate=self.SAMPLE_RATE,
                channels=1,
                blocksize=self.FRAME_SIZE,
                dtype="float32",
                callback=audio_callback
            ):
                while self._is_running:
                    time.sleep(0.05)

        except Exception as e:
            logger.warning("Microphone stream error in VADEngine: %s", e)
            self._is_running = False
