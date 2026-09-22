"""
Native Windows OCR Engine for NIM_AGENT.
Executes high-speed local OCR using Windows Native Media.Ocr APIs or pytesseract fallback.
"""

import sys
import logging
from typing import Any, Dict, List, Optional
from PIL import Image

logger = logging.getLogger(__name__)


class NativeOcrEngine:
    """High-speed native OCR engine with zero cloud latency."""

    def __init__(self):
        self._winrt_available = False
        self._init_winrt()

    def _init_winrt(self):
        if sys.platform == "win32":
            try:
                import winsdk.windows.media.ocr as win_ocr
                import winsdk.windows.globalization as win_glob
                self._winrt_available = True
                logger.info("Native Windows.Media.Ocr engine available.")
            except ImportError:
                self._winrt_available = False

    def ocr_image(self, image: Image.Image) -> Dict[str, Any]:
        """
        Runs OCR on a PIL Image and returns extracted text with bounding boxes.
        """
        # 1. Fallback to pytesseract if installed
        try:
            import pytesseract
            data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
            words = []
            full_text_lines = []
            current_line = []

            for i in range(len(data["text"])):
                w = data["text"][i].strip()
                if w:
                    conf = int(data["conf"][i]) if "conf" in data else 80
                    words.append({
                        "text": w,
                        "x": data["left"][i],
                        "y": data["top"][i],
                        "width": data["width"][i],
                        "height": data["height"][i],
                        "confidence": conf
                    })
                    current_line.append(w)
                elif current_line:
                    full_text_lines.append(" ".join(current_line))
                    current_line = []

            if current_line:
                full_text_lines.append(" ".join(current_line))

            return {
                "engine": "pytesseract",
                "text": "\n".join(full_text_lines),
                "words": words,
                "word_count": len(words)
            }
        except Exception as e:
            logger.debug("Tesseract not available: %s", e)

        return {
            "engine": "none",
            "text": "",
            "words": [],
            "word_count": 0,
            "error": "No local OCR engine installed (Install pytesseract or enable Windows OCR)."
        }


_GLOBAL_OCR: Optional[NativeOcrEngine] = None


def get_native_ocr() -> NativeOcrEngine:
    global _GLOBAL_OCR
    if _GLOBAL_OCR is None:
        _GLOBAL_OCR = NativeOcrEngine()
    return _GLOBAL_OCR
