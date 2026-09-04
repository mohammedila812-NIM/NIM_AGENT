import asyncio
import tempfile
from pathlib import Path
import pytest
from src.tools.base import ToolContext
from src.tools.file_tools import (
    ReadFileTool,
    WriteFileTool,
    MoveFileTool,
    DeleteFileTool,
    ListDirectoryTool,
    SearchFilesTool
)
from src.tools.doc_tools import GenerateDocumentTool
from src.tools.shell_tools import RunCommandTool
from src.tools.undo_tools import UndoLastActionTool

@pytest.mark.asyncio
async def test_file_tools_and_undo():
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        context = ToolContext(task_id="test_task_1")

        # 1. Write file
        write_tool = WriteFileTool()
        target = tmp_path / "hello.txt"
        res = await write_tool.execute({"path": str(target), "content": "Hello Desktop JARVIS!"}, context)
        assert res.success is True
        assert target.exists()

        # 2. Read file
        read_tool = ReadFileTool()
        read_res = await read_tool.execute({"path": str(target)}, context)
        assert read_res.success is True
        assert "Hello Desktop JARVIS!" in read_res.data["content"]

        # 3. List dir
        list_tool = ListDirectoryTool()
        list_res = await list_tool.execute({"path": str(tmp_path)}, context)
        assert list_res.success is True
        assert any(item["name"] == "hello.txt" for item in list_res.data["items"])

        # 4. Delete file
        del_tool = DeleteFileTool()
        del_res = await del_tool.execute({"path": str(target)}, context)
        assert del_res.success is True
        assert not target.exists()

        # 5. Undo delete
        undo_tool = UndoLastActionTool()
        undo_res = await undo_tool.execute({}, context)
        assert undo_res.success is True
        assert target.exists()
        assert target.read_text(encoding="utf-8") == "Hello Desktop JARVIS!"

@pytest.mark.asyncio
async def test_generate_documents():
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        context = ToolContext(task_id="test_doc_task")
        doc_tool = GenerateDocumentTool()

        # 1. Generate DOCX
        docx_path = tmp_path / "report.docx"
        docx_res = await doc_tool.execute({
            "file_path": str(docx_path),
            "doc_type": "docx",
            "title": "Quarterly Analysis",
            "sections": [
                {
                    "heading": "Executive Summary",
                    "content": "Revenue grew by 24% year-over-year.",
                    "bullet_points": ["Strong cloud sales", "Customer retention at 98%"],
                    "table_data": [["Metric", "Q1", "Q2"], ["Revenue", "$1.2M", "$1.5M"]]
                }
            ]
        }, context)
        assert docx_res.success is True
        assert docx_path.exists()
        assert docx_path.stat().st_size > 0

        # 2. Generate XLSX
        xlsx_path = tmp_path / "data.xlsx"
        xlsx_res = await doc_tool.execute({
            "file_path": str(xlsx_path),
            "doc_type": "xlsx",
            "title": "Financials",
            "sections": [
                {
                    "heading": "Sales Summary",
                    "content": "Detailed breakdown by region",
                    "table_data": [["Region", "Target", "Actual"], ["North", "100", "120"]]
                }
            ]
        }, context)
        assert xlsx_res.success is True
        assert xlsx_path.exists()

        # 3. Generate Markdown
        md_path = tmp_path / "notes.md"
        md_res = await doc_tool.execute({
            "file_path": str(md_path),
            "doc_type": "md",
            "title": "Architecture Overview",
            "sections": [
                {
                    "heading": "Components",
                    "content": "Detailed overview of ReAct engine and Browser Bridge.",
                    "bullet_points": ["Orchestrator Core", "Perception Engine"]
                }
            ]
        }, context)
        assert md_res.success is True
        assert md_path.exists()
        assert "# Architecture Overview" in md_path.read_text(encoding="utf-8")

@pytest.mark.asyncio
async def test_run_command_tool():
    cmd_tool = RunCommandTool()
    context = ToolContext(task_id="test_cmd")
    res = await cmd_tool.execute({"command": "echo 'JARVIS Active'"}, context)
    assert res.success is True
    assert "JARVIS Active" in res.data["stdout"]

@pytest.mark.asyncio
async def test_notify_user_injection_safety():
    from src.tools.system_tools import NotifyUserTool
    notify_tool = NotifyUserTool()
    context = ToolContext(task_id="test_notify")
    # Test title and message with quotes, backticks, dollar signs, and semicolons
    res = await notify_tool.execute({
        "title": "Alert's `test` $PATH",
        "message": "Special 'quote' & ; Start-Process calc.exe; \n newline"
    }, context)
    assert res.success is True
    assert res.data["notified"] is True

@pytest.mark.asyncio
async def test_generate_documents_edge_cases():
    from src.tools.doc_tools import GenerateDocumentTool
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        context = ToolContext(task_id="test_doc_edge")
        doc_tool = GenerateDocumentTool()

        # 1. PDF with XML special characters
        pdf_path = tmp_path / "edge.pdf"
        pdf_res = await doc_tool.execute({
            "file_path": str(pdf_path),
            "doc_type": "pdf",
            "title": "Q&A <Review> & Insights",
            "sections": [
                {
                    "heading": "Terms & Conditions",
                    "content": "Value > 100 & Value < 500",
                    "bullet_points": ["Item A & B", "Price < $50"],
                    "table_data": [["Col & 1", "Col < 2"], [100, 200]]
                }
            ]
        }, context)
        assert pdf_res.success is True
        assert pdf_path.exists()

        # 2. Markdown with non-string cells
        md_path = tmp_path / "edge.md"
        md_res = await doc_tool.execute({
            "file_path": str(md_path),
            "doc_type": "md",
            "title": "Numeric Markdown",
            "sections": [
                {
                    "heading": "Stats",
                    "content": "Numeric table below",
                    "table_data": [["Metric", "Value", "Active"], ["Count", 42, True], ["Rate", 3.14, False]]
                }
            ]
        }, context)
        assert md_res.success is True
        assert md_path.exists()
        md_content = md_path.read_text(encoding="utf-8")
        assert "| 42 | True |" in md_content

        # 3. Excel with invalid sheet characters
        xlsx_path = tmp_path / "edge.xlsx"
        xlsx_res = await doc_tool.execute({
            "file_path": str(xlsx_path),
            "doc_type": "xlsx",
            "title": "Sales: 2026/Q1 [Final]*?",
            "sections": [
                {
                    "heading": "Summary: Region/East",
                    "content": "Data summary",
                    "table_data": [["A", "B"], [1, 2]]
                }
            ]
        }, context)
        assert xlsx_res.success is True
        assert xlsx_path.exists()
