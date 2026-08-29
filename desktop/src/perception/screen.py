import ctypes
import hashlib
import io
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from PIL import Image
import mss
from src.config import SNAPSHOTS_DIR

class ScreenCaptureEngine:
    """
    High-speed Screen Capture & Region Cropper.
    Supports multi-monitor setups, DPI coordinate translation, and screen-diffing.
    """

    def __init__(self):
        self._set_dpi_awareness()

    def _set_dpi_awareness(self):
        """Sets Windows process DPI awareness to ensure 1:1 pixel accuracy."""
        if os.name == "nt":
            try:
                # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
                ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
            except Exception:
                try:
                    ctypes.windll.shcore.SetProcessDpiAwareness(2)
                except Exception:
                    pass

    def get_dpi_scale_for_window(self, hwnd: int) -> float:
        """Returns the DPI scale factor (e.g. 1.0, 1.25, 1.5, 2.0) for a given window handle."""
        if os.name == "nt":
            try:
                dpi = ctypes.windll.user32.GetDpiForWindow(hwnd)
                if dpi > 0:
                    return float(dpi) / 96.0
            except Exception:
                pass
        return 1.0

    def capture_full_screen(self, monitor_index: int = 1) -> Image.Image:
        """Captures the full display monitor (default: primary monitor 1)."""
        with mss.mss() as sct:
            monitors = sct.monitors
            idx = min(monitor_index, len(monitors) - 1)
            target_mon = monitors[idx]
            sct_img = sct.grab(target_mon)
            img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
            return img

    def capture_region(self, left: int, top: int, width: int, height: int) -> Image.Image:
        """Captures a specific rectangle region on the desktop."""
        with mss.mss() as sct:
            bbox = {"left": int(left), "top": int(top), "width": int(width), "height": int(height)}
            sct_img = sct.grab(bbox)
            img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
            return img

    def save_capture(self, img: Image.Image, filename: Optional[str] = None) -> str:
        """Saves a captured image to disk and returns the absolute path."""
        import time
        import uuid
        name = filename or f"screen_{int(time.time())}_{uuid.uuid4().hex[:6]}.png"
        out_dir = Path(SNAPSHOTS_DIR) / "captures"
        out_dir.mkdir(parents=True, exist_ok=True)
        file_path = out_dir / name
        img.save(str(file_path), format="PNG", optimize=True)
        return str(file_path)

    @staticmethod
    def _get_dhash_bitstring(img: Image.Image) -> str:
        """Extracts 72-bit perceptual dHash + luminance string."""
        thumb = img.convert("L").resize((9, 8), Image.Resampling.BILINEAR)
        try:
            pixels = list(thumb.get_flattened_data())  # Pillow 14+
        except AttributeError:
            pixels = list(thumb.getdata())

        diff_bits = []
        for row in range(8):
            for col in range(8):
                idx = row * 9 + col
                diff_bits.append("1" if pixels[idx] > pixels[idx + 1] else "0")

        # Encode average luminance
        avg_lum = sum(pixels) // max(1, len(pixels))
        diff_bits.append(f"{avg_lum:08b}")
        return "".join(diff_bits)

    @staticmethod
    def compute_image_hash(img: Image.Image) -> str:
        """Computes a difference hash (dHash) hex digest."""
        bitstring = ScreenCaptureEngine._get_dhash_bitstring(img)
        return hashlib.md5(bitstring.encode("ascii")).hexdigest()

    @staticmethod
    def compute_image_difference(img1: Image.Image, img2: Image.Image) -> float:
        """
        Returns a normalized difference score between 0.0 (identical) and 1.0 (completely distinct)
        using perceptual dHash Hamming distance.
        """
        bits1 = ScreenCaptureEngine._get_dhash_bitstring(img1)
        bits2 = ScreenCaptureEngine._get_dhash_bitstring(img2)
        if len(bits1) != len(bits2):
            return 1.0

        differing_bits = sum(b1 != b2 for b1, b2 in zip(bits1, bits2))
        return round(differing_bits / len(bits1), 4)
