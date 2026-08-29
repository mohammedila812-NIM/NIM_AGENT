import os
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from PIL import Image

from src.perception.file_converter import FileConverter, ConversionResult
from src.tools.converter_tools import (
    ConvertFileTool,
    CompressArchiveTool,
    ExtractArchiveTool,
    RenderDocumentPreviewTool
)
from src.tools.base import ToolContext

@pytest.fixture
def file_converter():
    return FileConverter()

@pytest.mark.asyncio
async def test_csv_to_xlsx_conversion(file_converter, tmp_path):
    csv_file = tmp_path / "data.csv"
    csv_file.write_text("name,score,role\nAlice,95,Engineer\nBob,88,Designer", encoding="utf-8")
    
    xlsx_file = tmp_path / "data.xlsx"
    res = await file_converter.convert_file(str(csv_file), target_format="xlsx", output_path=str(xlsx_file))
    
    assert res.success is True
    assert xlsx_file.exists()
    assert xlsx_file.stat().st_size > 0

@pytest.mark.asyncio
async def test_image_format_conversion(file_converter, tmp_path):
    png_file = tmp_path / "sample.png"
    img = Image.new("RGBA", (100, 100), color=(255, 0, 0, 128))
    img.save(png_file)

    jpg_file = tmp_path / "sample.jpg"
    res = await file_converter.convert_file(str(png_file), target_format="jpg", output_path=str(jpg_file))
    assert res.success is True
    assert jpg_file.exists()

    webp_file = tmp_path / "sample.webp"
    res_webp = await file_converter.convert_file(str(png_file), target_format="webp", output_path=str(webp_file))
    assert res_webp.success is True
    assert webp_file.exists()

@pytest.mark.asyncio
async def test_markdown_conversion(file_converter, tmp_path):
    md_file = tmp_path / "notes.md"
    md_file.write_text("# Project Status\n\n- Task 1 completed\n- Task 2 in progress", encoding="utf-8")

    # To HTML
    html_file = tmp_path / "notes.html"
    res_html = await file_converter.convert_file(str(md_file), target_format="html", output_path=str(html_file))
    assert res_html.success is True
    assert "Project Status" in html_file.read_text(encoding="utf-8")

    # To DOCX
    docx_file = tmp_path / "notes.docx"
    res_docx = await file_converter.convert_file(str(md_file), target_format="docx", output_path=str(docx_file))
    assert res_docx.success is True
    assert docx_file.exists()

def test_archive_compress_and_extract(file_converter, tmp_path):
    f1 = tmp_path / "file1.txt"
    f1.write_text("Hello file 1", encoding="utf-8")
    f2 = tmp_path / "file2.txt"
    f2.write_text("Hello file 2", encoding="utf-8")

    zip_path = tmp_path / "archive.zip"
    res_comp = file_converter.compress_archive([str(f1), str(f2)], output_archive_path=str(zip_path))
    assert res_comp["success"] is True
    assert zip_path.exists()

    extract_dir = tmp_path / "unpacked"
    res_ext = file_converter.extract_archive(str(zip_path), destination_dir=str(extract_dir))
    assert res_ext["success"] is True
    assert (extract_dir / "file1.txt").exists()
    assert (extract_dir / "file2.txt").exists()

@pytest.mark.asyncio
async def test_converter_tools(tmp_path):
    ctx = ToolContext(task_id="test_conv_ctx")
    test_csv = tmp_path / "test.csv"
    test_csv.write_text("id,val\n1,A\n2,B", encoding="utf-8")
    test_xlsx = tmp_path / "test.xlsx"

    # 1. ConvertFileTool
    conv_tool = ConvertFileTool()
    res_conv = await conv_tool.execute({
        "input_path": str(test_csv),
        "target_format": "xlsx",
        "output_path": str(test_xlsx)
    }, ctx)
    assert res_conv.success is True
    assert res_conv.data["output_format"] == "xlsx"

    # 2. CompressArchiveTool
    comp_tool = CompressArchiveTool()
    test_zip = tmp_path / "out.zip"
    res_comp = await comp_tool.execute({
        "source_paths": [str(test_csv)],
        "output_archive_path": str(test_zip)
    }, ctx)
    assert res_comp.success is True

    # 3. ExtractArchiveTool
    ext_tool = ExtractArchiveTool()
    dest_dir = tmp_path / "extracted_folder"
    res_ext = await ext_tool.execute({
        "archive_path": str(test_zip),
        "destination_dir": str(dest_dir)
    }, ctx)
    assert res_ext.success is True

    # 4. RenderDocumentPreviewTool
    prev_tool = RenderDocumentPreviewTool()
    res_prev = await prev_tool.execute({"file_path": str(test_csv)}, ctx)
    assert res_prev.success is True
    assert "preview_image_path" in res_prev.data
