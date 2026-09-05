import os
import time
import zipfile
from pathlib import Path
import pytest

from src.triggers.downloads_watcher import (
    DownloadsWatcher,
    DownloadedFileEvent,
    FileCategory,
    categorize_downloaded_file,
    INCOMPLETE_EXTENSIONS
)
from src.triggers.clipboard_listener import (
    ClipboardListener,
    ClipboardAnalysisResult,
    ClipboardEntityType,
    classify_clipboard_content
)
from src.triggers.coordinator import TriggerCoordinator

def test_categorize_downloaded_files(tmp_path):
    # 1. Spreadsheet
    xlsx_file = tmp_path / "financial_report.xlsx"
    xlsx_file.write_text("dummy excel")
    ev_xlsx = categorize_downloaded_file(xlsx_file)
    assert ev_xlsx.category == FileCategory.SPREADSHEET
    assert "financial_report.xlsx" in ev_xlsx.filename
    assert any("Audit" in act["label"] for act in ev_xlsx.suggested_actions)

    # 2. Document
    pdf_file = tmp_path / "architecture_spec.pdf"
    pdf_file.write_text("dummy pdf")
    ev_pdf = categorize_downloaded_file(pdf_file)
    assert ev_pdf.category == FileCategory.DOCUMENT
    assert any("Summarize" in act["label"] for act in ev_pdf.suggested_actions)

    # 3. Archive
    zip_file = tmp_path / "project_bundle.zip"
    with zipfile.ZipFile(zip_file, "w") as zf:
        zf.writestr("file1.txt", "content1")
        zf.writestr("file2.txt", "content2")
    ev_zip = categorize_downloaded_file(zip_file)
    assert ev_zip.category == FileCategory.ARCHIVE
    assert ev_zip.metadata.get("total_files") == 2
    assert any("Extract" in act["label"] for act in ev_zip.suggested_actions)

    # 4. Code file
    py_file = tmp_path / "script.py"
    py_file.write_text("print('hello')")
    ev_py = categorize_downloaded_file(py_file)
    assert ev_py.category == FileCategory.CODE

def test_classify_clipboard_content(tmp_path):
    # 1. URL
    url_text = "https://github.com/microsoft/UFO"
    res_url = classify_clipboard_content(url_text)
    assert res_url.entity_type == ClipboardEntityType.WEB_URL
    assert "github.com" in res_url.metadata.get("domain", "")

    # 2. Stacktrace
    trace_text = """Traceback (most recent call last):
  File "main.py", line 42, in <module>
    raise ValueError("Invalid database token")
ValueError: Invalid database token"""
    res_trace = classify_clipboard_content(trace_text)
    assert res_trace.entity_type == ClipboardEntityType.STACKTRACE
    assert any("Debug" in act["label"] for act in res_trace.suggested_actions)

    # 3. JSON Data
    json_text = '{"name": "JARVIS", "version": "2.0", "status": "active"}'
    res_json = classify_clipboard_content(json_text)
    assert res_json.entity_type == ClipboardEntityType.CODE_SNIPPET
    assert any("Excel" in act["label"] for act in res_json.suggested_actions)

    # 4. Tabular TSV Data
    tsv_text = "Product\tSales\tProfit\nNIM Pro\t120\t5999\nJARVIS\t350\t34650"
    res_tsv = classify_clipboard_content(tsv_text)
    assert res_tsv.entity_type == ClipboardEntityType.TABULAR_DATA
    assert res_tsv.metadata.get("rows") == 3
    assert res_tsv.metadata.get("cols") == 3

    # 5. Existing File Path
    sample_file = tmp_path / "sample_data.csv"
    sample_file.write_text("a,b,c\n1,2,3")
    res_file = classify_clipboard_content(str(sample_file))
    assert res_file.entity_type == ClipboardEntityType.FILE_PATH

def test_downloads_watcher_flow(tmp_path):
    received_events = []

    def on_dl(ev):
        received_events.append(ev)

    watcher = DownloadsWatcher(watch_dir=tmp_path, on_download_callback=on_dl, poll_interval=0.1)
    watcher.start()

    # Create temporary incomplete download file (should be ignored)
    part_file = tmp_path / "large_dataset.csv.crdownload"
    part_file.write_text("in progress data")
    time.sleep(0.3)
    assert len(received_events) == 0

    # Rename to complete download
    final_file = tmp_path / "large_dataset.csv"
    part_file.rename(final_file)
    time.sleep(0.8)

    watcher.stop()
    assert len(received_events) >= 1
    assert received_events[0].filename == "large_dataset.csv"
    assert received_events[0].category == FileCategory.SPREADSHEET

@pytest.mark.asyncio
async def test_trigger_coordinator():
    triggered = []

    def on_suggestion(src, title, actions):
        triggered.append({"source": src, "title": title, "actions": actions})

    coord = TriggerCoordinator(on_suggestion_callback=on_suggestion)
    await coord.start_all()
    assert coord._is_active is True

    # Simulate trigger
    coord._handle_clipboard_event(classify_clipboard_content("https://anthropic.com"))
    assert any(t["source"] == "clipboard" and "anthropic.com" in t["title"] for t in triggered)
    assert any(t["source"] == "startup" for t in triggered)

    await coord.stop_all()
    assert coord._is_active is False
