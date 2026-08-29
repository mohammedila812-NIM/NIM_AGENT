import os
from pathlib import Path
import openpyxl
import pytest
from PIL import Image

from src.perception.excel import SpreadsheetAnalyzer
from src.perception.screen import ScreenCaptureEngine
from src.perception.window import WindowInspector
from src.perception.verify import ActionVerifier
from src.security.redaction import SensitiveDataRedactor

@pytest.mark.asyncio
async def test_spreadsheet_analyzer(tmp_path):
    # 1. Create a test Excel workbook with formulas and data
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Financials"

    ws.append(["Category", "Q1", "Q2", "Total"])
    ws.append(["Revenue", 1000, 1500, "=B2+C2"])
    ws.append(["Expenses", 400, 500, "=B3+C3"])
    ws.append(["Profit", "=B2-B3", "=C2-C3", "=D2-D3"])

    file_path = tmp_path / "test_financials.xlsx"
    wb.save(str(file_path))

    # 2. Analyze the spreadsheet
    res = SpreadsheetAnalyzer.analyze_file(str(file_path))

    assert res["success"] is True
    assert res["total_sheets"] == 1
    assert "Financials" in res["sheets"]
    assert res["dimensions"]["rows"] == 4
    assert res["headers"] == ["Category", "Q1", "Q2", "Total"]
    assert len(res["formulas"]) >= 4
    assert len(res["column_statistics"]) >= 2

def test_sensitive_data_redactor():
    text = "User API key: sk-1234567890abcdef12345678 and SSN 123-45-6789 and Card 4111-2222-3333-4444"
    redacted = SensitiveDataRedactor.redact_text(text)

    assert "sk-" not in redacted
    assert "[REDACTED" in redacted
    assert "123-45-6789" not in redacted
    assert "4111-2222-3333-4444" not in redacted

def test_window_inspector():
    info = WindowInspector.get_foreground_window_info()
    assert isinstance(info, dict)
    assert "is_valid" in info

def test_screen_diff_and_hashing():
    img1 = Image.new("RGB", (100, 100), color=(255, 0, 0))
    img2 = Image.new("RGB", (100, 100), color=(255, 0, 0))
    img3 = Image.new("RGB", (100, 100), color=(0, 255, 0))

    hash1 = ScreenCaptureEngine.compute_image_hash(img1)
    hash2 = ScreenCaptureEngine.compute_image_hash(img2)
    assert hash1 == hash2

    diff_same = ScreenCaptureEngine.compute_image_difference(img1, img2)
    assert diff_same == 0.0

    diff_diff = ScreenCaptureEngine.compute_image_difference(img1, img3)
    assert diff_diff > 0.0

    ver_res = ActionVerifier.verify_screen_change(img1, img3)
    assert ver_res["verified"] is True
