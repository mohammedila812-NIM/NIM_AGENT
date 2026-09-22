import os
import tempfile
import pytest
from pathlib import Path
from src.tools.doc_tools import GenerateDocumentTool
from src.tools.file_tools import format_size, categorize_file, ListDirectoryTool, SearchFilesTool
from src.tools.system_tools import GetSystemInfoTool
from src.perception.excel import SpreadsheetAnalyzer
from src.skills import get_skill_manager
from src.tools.base import ToolContext


@pytest.mark.asyncio
async def test_high_fidelity_excel_generation():
    tool = GenerateDocumentTool()
    with tempfile.TemporaryDirectory() as tmpdir:
        xlsx_path = os.path.join(tmpdir, "executive_sales.xlsx")
        args = {
            "file_path": xlsx_path,
            "doc_type": "xlsx",
            "title": "Q3 Executive Performance",
            "sections": [
                {
                    "heading": "Sales & Margins",
                    "content": "Quarterly summary by business unit.",
                    "table_data": [
                        ["Region", "Units", "Revenue", "Cost", "Margin", "Status"],
                        ["North America", 1500, 450000, 280000, "=C4-D4", "Active"],
                        ["Europe", 980, 294000, 190000, "=C5-D5", "Active"],
                        ["Asia Pacific", 1200, 360000, 210000, "=C6-D6", "Active"],
                        ["Total", 3680, "=SUM(C4:C6)", "=SUM(D4:D6)", "=C7-D7", "Summary"]
                    ]
                }
            ]
        }
        ctx = ToolContext(task_id="test_fid_1")
        res = await tool.execute(args, ctx)
        assert res.success is True
        assert os.path.exists(xlsx_path)

        # Inspect generated openpyxl workbook
        import openpyxl
        wb = openpyxl.load_workbook(xlsx_path, data_only=False)
        ws = wb.active
        assert ws.views.sheetView[0].showGridLines is True

        # Check formulas preserved
        assert ws["E6"].value == "=C4-D4"
        assert ws["C9"].value == "=SUM(C4:C6)"

        # Check column width calculation (auto-fitted)
        for col in ws.columns:
            col_letter = openpyxl.utils.get_column_letter(col[0].column)
            assert ws.column_dimensions[col_letter].width >= 12

        # Check SpreadsheetAnalyzer
        audit = SpreadsheetAnalyzer.analyze_file(xlsx_path)
        assert audit["success"] is True
        assert audit["formulas_detected"] >= 4
        assert audit["errors_detected"] == 0


@pytest.mark.asyncio
async def test_executive_word_and_pdf_generation():
    tool = GenerateDocumentTool()
    with tempfile.TemporaryDirectory() as tmpdir:
        docx_path = os.path.join(tmpdir, "report.docx")
        pdf_path = os.path.join(tmpdir, "report.pdf")
        sections = [
            {
                "heading": "Executive Summary",
                "content": "This is a production-grade automated report.",
                "bullet_points": ["Point Alpha", "Point Beta"],
                "table_data": [
                    ["Metric", "Value"],
                    ["Uptime", "99.99%"],
                    ["Throughput", "12,400 req/s"]
                ]
            }
        ]

        # Docx
        res_docx = await tool.execute({
            "file_path": docx_path,
            "doc_type": "docx",
            "title": "Corporate Status Brief",
            "sections": sections
        }, ToolContext(task_id="test_fid_2"))
        assert res_docx.success is True
        assert os.path.exists(docx_path)
        assert os.path.getsize(docx_path) > 1000

        # PDF
        res_pdf = await tool.execute({
            "file_path": pdf_path,
            "doc_type": "pdf",
            "title": "Corporate Status Brief",
            "sections": sections
        }, ToolContext(task_id="test_fid_3"))
        assert res_pdf.success is True
        assert os.path.exists(pdf_path)
        assert os.path.getsize(pdf_path) > 1000


def test_file_tools_helpers():
    assert format_size(500) == "500 B"
    assert format_size(2048) == "2.0 KB"
    assert format_size(1024 * 1024 * 5) == "5.0 MB"

    assert categorize_file(Path("test.xlsx")) == "spreadsheet"
    assert categorize_file(Path("test.docx")) == "document"
    assert categorize_file(Path("test.py")) == "code"
    assert categorize_file(Path("test.png")) == "image"
    assert categorize_file(Path("test.zip")) == "archive"


@pytest.mark.asyncio
async def test_enhanced_system_info():
    tool = GetSystemInfoTool()
    res = await tool.execute({}, ToolContext(task_id="test_sys_1"))
    assert res.success is True
    data = res.data
    assert "cpu_percent" in data
    assert "ram_total_gb" in data
    assert "partitions" in data
    assert isinstance(data["partitions"], list)
    assert "gpu" in data


def test_production_skills_loaded():
    mgr = get_skill_manager()
    skills = mgr.list_skills()
    skill_names = [s["name"] for s in skills]
    assert "data_analysis" in skill_names
    assert "research_and_summary" in skill_names
    assert "excel_automation" in skill_names
    assert "system_diagnostic" in skill_names
    assert len(skill_names) >= 7
