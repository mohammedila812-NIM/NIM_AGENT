import base64
import io
import os
from typing import Any, Dict, Optional
from PIL import Image
from .base import BaseTool, ToolContext, ToolResult
from src.perception.excel import SpreadsheetAnalyzer
from src.perception.screen import ScreenCaptureEngine
from src.perception.window import WindowInspector
from src.perception.verify import ActionVerifier
from src.security.guard import ActionRiskLevel
from src.security.redaction import SensitiveDataRedactor

class AnalyzeSpreadsheetTool(BaseTool):
    name = "analyze_spreadsheet"
    description = (
        "Perform structured deep analysis on an Excel (.xlsx) or CSV spreadsheet. "
        "Audits formulas, detects error cells (#DIV/0!, #REF!), extracts column stats, and previews data."
    )
    parameters = {
        "type": "object",
        "properties": {
            "file_path": {"type": "string", "description": "Path to the .xlsx or .csv spreadsheet file (e.g. 'Desktop/sales.xlsx')."},
            "sheet_name": {"type": "string", "description": "Optional specific sheet name to analyze."},
            "max_preview_rows": {"type": "integer", "description": "Max rows to preview (default: 25).", "default": 25}
        },
        "required": ["file_path"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        file_path = str(args.get("file_path", "")).strip()
        sheet_name = args.get("sheet_name")
        max_rows = int(args.get("max_preview_rows", 25))

        if not file_path:
            return ToolResult(success=False, data=None, error="No file path provided.")

        res = SpreadsheetAnalyzer.analyze_file(file_path, sheet_name=sheet_name, max_preview_rows=max_rows)
        if not res.get("success"):
            return ToolResult(success=False, data=None, error=res.get("error", "Failed to analyze spreadsheet."))

        # Redact any sensitive information before returning
        clean_res = SensitiveDataRedactor.redact_dict(res)
        return ToolResult(success=True, data=clean_res)

class GetActiveWindowInfoTool(BaseTool):
    name = "get_active_window_info"
    description = "Inspect the active foreground window, its title, process executable, and UI accessibility elements."
    parameters = {
        "type": "object",
        "properties": {
            "include_ui_elements": {"type": "boolean", "description": "Whether to inspect child UI elements (default: True).", "default": True}
        }
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        info = WindowInspector.get_foreground_window_info()
        if bool(args.get("include_ui_elements", True)) and info.get("hwnd"):
            ui_tree = WindowInspector.inspect_ui_tree(info["hwnd"])
            info["accessibility"] = ui_tree

        return ToolResult(success=True, data=SensitiveDataRedactor.redact_dict(info))

class CaptureScreenRegionTool(BaseTool):
    name = "capture_screen_region"
    description = "Capture the current full screen or a focused application window. Returns the saved image path."
    parameters = {
        "type": "object",
        "properties": {
            "target": {"type": "string", "enum": ["full_screen", "active_window"], "default": "full_screen", "description": "Capture scope."},
            "monitor_index": {"type": "integer", "default": 1, "description": "Monitor index (1 = primary)."}
        }
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        engine = ScreenCaptureEngine()
        target = str(args.get("target", "full_screen"))
        mon_idx = int(args.get("monitor_index", 1))

        if target == "active_window":
            win_info = WindowInspector.get_foreground_window_info()
            bounds = win_info.get("bounds", {})
            w, h = bounds.get("width", 0), bounds.get("height", 0)
            if w > 10 and h > 10:
                img = engine.capture_region(bounds["left"], bounds["top"], w, h)
            else:
                img = engine.capture_full_screen(mon_idx)
        else:
            img = engine.capture_full_screen(mon_idx)

        saved_path = engine.save_capture(img)
        return ToolResult(
            success=True,
            data={
                "saved_path": saved_path,
                "width": img.width,
                "height": img.height,
                "target": target
            }
        )

class OcrScreenTextTool(BaseTool):
    name = "ocr_screen_text"
    description = "Perform fast Tesseract OCR text extraction from a captured image or the active screen region."
    parameters = {
        "type": "object",
        "properties": {
            "image_path": {"type": "string", "description": "Optional path to a previously captured image file."},
            "scope": {"type": "string", "enum": ["active_window", "full_screen"], "default": "active_window"}
        }
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    # Well-known Tesseract installation paths (checked in order)
    TESSERACT_PATHS = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        r"C:\Users\maham\AppData\Local\Programs\Tesseract-OCR\tesseract.exe",
    ]

    @classmethod
    def _configure_tesseract(cls):
        """Auto-detects and configures the Tesseract executable path."""
        try:
            import pytesseract
            current = pytesseract.pytesseract.tesseract_cmd or "tesseract"
            if os.path.exists(current):
                return True  # Already configured and valid
            for p in cls.TESSERACT_PATHS:
                if os.path.exists(p):
                    pytesseract.pytesseract.tesseract_cmd = p
                    return True
            return False
        except ImportError:
            return False

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        img_path = args.get("image_path")
        engine = ScreenCaptureEngine()

        # Capture image
        if img_path and os.path.exists(img_path):
            img = Image.open(img_path)
        else:
            scope = args.get("scope", "active_window")
            if scope == "active_window":
                win_info = WindowInspector.get_foreground_window_info()
                bounds = win_info.get("bounds", {})
                w, h = bounds.get("width", 0), bounds.get("height", 0)
                img = engine.capture_region(bounds["left"], bounds["top"], w, h) if w > 10 else engine.capture_full_screen()
            else:
                img = engine.capture_full_screen()

        extracted_text = ""
        tesseract_ok = self._configure_tesseract()

        if tesseract_ok:
            try:
                import pytesseract

                # Preprocess: greyscale + upscale for accuracy on small/low-DPI screens
                proc_img = img.convert("L")
                if proc_img.width < 1280:
                    scale = max(1, 1280 // proc_img.width)
                    proc_img = proc_img.resize(
                        (proc_img.width * scale, proc_img.height * scale),
                        Image.Resampling.LANCZOS
                    )

                # PSM 3: Fully automatic page segmentation, OEM 3: LSTM engine
                config = "--psm 3 --oem 3 -l eng"
                extracted_text = pytesseract.image_to_string(proc_img, config=config).strip()

                if not extracted_text:
                    extracted_text = "[OCR ran but found no readable text. The screen may contain images or non-English characters.]"

            except Exception as e:
                extracted_text = f"[OCR failed: {e}. Try vision_describe_image for AI-powered visual analysis.]"
        else:
            extracted_text = (
                f"[Tesseract OCR not found at expected paths. "
                f"Image captured: {img.width}x{img.height}px. "
                f"Install Tesseract from https://github.com/UB-Mannheim/tesseract/wiki "
                f"or use vision_describe_image for AI vision analysis.]"
            )

        clean_text = SensitiveDataRedactor.redact_text(extracted_text)
        return ToolResult(
            success=True,
            data={
                "text": clean_text[:4000],
                "char_count": len(clean_text),
                "tesseract_available": tesseract_ok
            }
        )

class VerifyActionResultTool(BaseTool):
    name = "verify_action_result"
    description = "Verify whether an action produced a visual change on the desktop by comparing before and after captures."
    parameters = {
        "type": "object",
        "properties": {
            "before_image_path": {"type": "string", "description": "Path to the before-action screenshot."},
            "after_image_path": {"type": "string", "description": "Path to the after-action screenshot."}
        },
        "required": ["before_image_path", "after_image_path"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        b_path = str(args.get("before_image_path"))
        a_path = str(args.get("after_image_path"))

        if not os.path.exists(b_path) or not os.path.exists(a_path):
            return ToolResult(success=False, data=None, error="One or both image paths do not exist.")

        img1 = Image.open(b_path)
        img2 = Image.open(a_path)
        res = ActionVerifier.verify_screen_change(img1, img2)
        return ToolResult(success=True, data=res)


class VisionDescribeImageTool(BaseTool):
    """
    Dual-Provider Vision Tool.
    ===========================
    Lets the Brain LLM (e.g. Gemini) delegate image analysis to a dedicated
    Vision LLM (e.g. NVIDIA llama-3.2-90b-vision-instruct) via a separate provider.

    Workflow:
        1. Gemini decides it needs to see the screen.
        2. Gemini calls vision_describe_image with an optional image_path or scope.
        3. VisionDescribeImageTool captures the screen (if no path given).
        4. Sends the image to the Vision LLM (NVIDIA NIM / OpenAI / Ollama llava).
        5. Returns the rich visual description back to Gemini.
        6. Gemini continues reasoning with full visual context.
    """
    name = "vision_describe_image"
    description = (
        "Send a screenshot or image file to a dedicated AI vision model (e.g. NVIDIA llama-3.2-90b-vision-instruct) "
        "and get a rich description of all visible content, text, UI elements, windows, and layout. "
        "Use this when you need to 'see' the screen or understand complex visual content that Tesseract OCR cannot capture."
    )
    parameters = {
        "type": "object",
        "properties": {
            "image_path": {
                "type": "string",
                "description": "Optional path to an already-captured image. If omitted, the current screen will be captured."
            },
            "scope": {
                "type": "string",
                "enum": ["active_window", "full_screen"],
                "default": "full_screen",
                "description": "Screen capture scope if image_path is not provided."
            },
            "prompt": {
                "type": "string",
                "description": "Custom instruction for the vision model. Default: describe all visible text and UI elements.",
                "default": "Describe all visible text, application windows, UI controls, and content in this screenshot in detail."
            },
            "detail": {
                "type": "string",
                "enum": ["low", "high"],
                "default": "high",
                "description": "Vision detail level: 'high' for full resolution analysis, 'low' for fast overview."
            }
        }
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        from src.llm.vision import get_vision_client

        img_path = args.get("image_path")
        prompt = str(args.get("prompt", "Describe all visible text, application windows, UI controls, and content in this screenshot in detail."))
        detail = str(args.get("detail", "high"))
        engine = ScreenCaptureEngine()

        # Capture screen if no image path provided
        if img_path and os.path.exists(img_path):
            try:
                img = Image.open(img_path)
            except Exception as e:
                return ToolResult(success=False, data=None, error=f"Cannot open image '{img_path}': {e}")
        else:
            scope = args.get("scope", "full_screen")
            if scope == "active_window":
                win_info = WindowInspector.get_foreground_window_info()
                bounds = win_info.get("bounds", {})
                w, h = bounds.get("width", 0), bounds.get("height", 0)
                img = engine.capture_region(bounds["left"], bounds["top"], w, h) if w > 10 else engine.capture_full_screen()
            else:
                img = engine.capture_full_screen()

            # Save a copy so the path can be referenced if needed
            img_path = engine.save_capture(img)

        # Call Vision LLM
        vision_client = get_vision_client()
        status = vision_client.get_status()
        result = await vision_client.describe_image(img, prompt=prompt, detail=detail)

        if result.get("success"):
            description = result.get("description", "")
            clean_description = SensitiveDataRedactor.redact_text(description)
            return ToolResult(
                success=True,
                data={
                    "description": clean_description[:6000],
                    "provider": result.get("provider"),
                    "model": result.get("model"),
                    "tokens_used": result.get("tokens_used", 0),
                    "image_path": img_path,
                    "image_size": f"{img.width}x{img.height}",
                }
            )
        else:
            error_msg = result.get("error", "Vision model returned empty response.")
            return ToolResult(
                success=False,
                data=None,
                error=(
                    f"vision_describe_image failed [{result.get('provider')}/{result.get('model')}]: "
                    f"{error_msg} | "
                    f"Fix: run `/vision_provider gemini models/gemini-flash-lite-latest` to use Gemini vision."
                )
            )

