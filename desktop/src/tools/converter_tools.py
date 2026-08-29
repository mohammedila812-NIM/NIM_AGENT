from typing import Any, Dict, List, Optional, Union
from .base import BaseTool, ToolContext, ToolResult
from src.perception.file_converter import FileConverter
from src.security.guard import ActionRiskLevel
from src.security.redaction import SensitiveDataRedactor

# Shared singleton instance
_file_converter: Optional[FileConverter] = None

def get_file_converter() -> FileConverter:
    global _file_converter
    if _file_converter is None:
        _file_converter = FileConverter()
    return _file_converter

class ConvertFileTool(BaseTool):
    """
    Multi-format file conversion tool with optional closed-loop vision quality verification.
    """
    name = "convert_file"
    description = (
        "Convert files across multiple document, spreadsheet, and image formats. "
        "Supported conversions: CSV <-> XLSX <-> JSON, Markdown -> DOCX / PDF / HTML, "
        "DOCX -> PDF / TXT, Images (PNG <-> JPG <-> WEBP <-> BMP <-> ICO). "
        "Supports optional Vision LLM spot-checking to verify layout quality."
    )
    parameters = {
        "type": "object",
        "properties": {
            "input_path": {
                "type": "string",
                "description": "Path to the source file to convert."
            },
            "target_format": {
                "type": "string",
                "description": "Target file extension/format (e.g. 'xlsx', 'csv', 'pdf', 'docx', 'html', 'png', 'jpg', 'webp')."
            },
            "output_path": {
                "type": "string",
                "description": "Optional destination path for the converted file."
            },
            "verify_with_vision": {
                "type": "boolean",
                "default": False,
                "description": "Whether to render a preview and run Vision LLM spot-check on layout quality."
            }
        },
        "required": ["input_path", "target_format"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        converter = get_file_converter()
        in_path = str(args.get("input_path", "")).strip()
        tgt_fmt = str(args.get("target_format", "")).strip()
        out_path = args.get("output_path")
        verify_vis = bool(args.get("verify_with_vision", False))

        if not in_path or not tgt_fmt:
            return ToolResult(success=False, data=None, error="Fields 'input_path' and 'target_format' are required.")

        res = await converter.convert_file(
            input_path=in_path,
            target_format=tgt_fmt,
            output_path=out_path,
            verify_with_vision=verify_vis
        )

        if not res.success:
            return ToolResult(success=False, data=res.__dict__, error=res.error or "Conversion failed")

        return ToolResult(success=True, data=res.__dict__)

class CompressArchiveTool(BaseTool):
    """
    Compresses files or directories into ZIP or TAR.GZ archives.
    """
    name = "compress_archive"
    description = "Compress multiple files or entire folders into a ZIP (.zip) or TAR.GZ (.tar.gz) archive."
    parameters = {
        "type": "object",
        "properties": {
            "source_paths": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of file paths or folder paths to include in the archive."
            },
            "output_archive_path": {
                "type": "string",
                "description": "Destination path for the created archive file (e.g. 'C:/backup.zip')."
            },
            "format": {
                "type": "string",
                "enum": ["zip", "tar.gz"],
                "default": "zip",
                "description": "Archive format ('zip' or 'tar.gz')."
            }
        },
        "required": ["source_paths", "output_archive_path"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        converter = get_file_converter()
        sources = args.get("source_paths", [])
        out_arch = str(args.get("output_archive_path", "")).strip()
        fmt = str(args.get("format", "zip"))

        if not sources or not out_arch:
            return ToolResult(success=False, data=None, error="Fields 'source_paths' and 'output_archive_path' are required.")

        res = converter.compress_archive(source_paths=sources, output_archive_path=out_arch, format=fmt)
        if not res.get("success"):
            return ToolResult(success=False, data=res, error=res.get("error", "Archive creation failed"))

        return ToolResult(success=True, data=res)

class ExtractArchiveTool(BaseTool):
    """
    Extracts ZIP or TAR.GZ archives with security directory-traversal guards.
    """
    name = "extract_archive"
    description = "Extract files from a ZIP or TAR.GZ archive into a destination directory."
    parameters = {
        "type": "object",
        "properties": {
            "archive_path": {
                "type": "string",
                "description": "Path to the archive file to unpack."
            },
            "destination_dir": {
                "type": "string",
                "description": "Optional destination folder to unpack files into."
            }
        },
        "required": ["archive_path"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        converter = get_file_converter()
        arch_p = str(args.get("archive_path", "")).strip()
        dest_p = args.get("destination_dir")

        if not arch_p:
            return ToolResult(success=False, data=None, error="Field 'archive_path' is required.")

        res = converter.extract_archive(archive_path=arch_p, destination_dir=dest_p)
        if not res.get("success"):
            return ToolResult(success=False, data=res, error=res.get("error", "Extraction failed"))

        return ToolResult(success=True, data=res)

class RenderDocumentPreviewTool(BaseTool):
    """
    Renders a page of a document, spreadsheet, or image to a PNG preview image.
    """
    name = "render_document_preview"
    description = "Render a visual preview image (PNG) for a document, spreadsheet, or image file."
    parameters = {
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "Path to the file to render a preview for."
            },
            "page_num": {
                "type": "integer",
                "default": 1,
                "description": "Page number to render (default: 1)."
            },
            "output_image_path": {
                "type": "string",
                "description": "Optional destination image path."
            }
        },
        "required": ["file_path"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        converter = get_file_converter()
        fpath = str(args.get("file_path", "")).strip()
        pg = int(args.get("page_num", 1))
        out_img = args.get("output_image_path")

        if not fpath:
            return ToolResult(success=False, data=None, error="Field 'file_path' is required.")

        img_path = converter.render_preview(file_path=fpath, page_num=pg, output_image_path=out_img)
        if not img_path:
            return ToolResult(success=False, data=None, error=f"Failed to render preview for '{fpath}'")

        return ToolResult(success=True, data={"preview_image_path": img_path, "file_path": fpath})
