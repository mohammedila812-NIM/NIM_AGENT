import pytest
from pathlib import Path
from src.agent.session_memory import SessionMemoryManager, SessionTurn, HighlightedMemory
from src.tools.memory_tools import (
    RecallSessionMemoryTool,
    SaveUserPreferenceTool,
    GetPersonalizationProfileTool,
    get_memory_tools,
)
from src.tools.base import ToolContext


@pytest.fixture
def session_mgr(tmp_path):
    db_file = tmp_path / "test_session_mem.db"
    return SessionMemoryManager(db_path=db_file)


def test_session_turn_recording_and_entities(session_mgr):
    turn = session_mgr.record_turn(
        turn_id="turn_001",
        goal="Analyze sales spreadsheet at C:\\reports\\sales_q3.xlsx",
        final_answer="✓ Analysis complete. Total revenue calculated: $450,000. Saved to summary.txt",
        tools_used=["analyze_spreadsheet", "write_file"],
        files_touched=["C:\\reports\\sales_q3.xlsx", "summary.txt"]
    )

    assert turn.turn_id == "turn_001"
    assert len(session_mgr._turns) == 1
    assert "path:sales_q3.xlsx" in turn.key_entities or "path:summary.txt" in turn.key_entities

    # Verify auto-highlighting extracted the file path and decision
    highlights = session_mgr._highlights
    assert len(highlights) >= 2
    assert any(h.category == "filepath" for h in highlights)


def test_autonomous_context_need_detection(session_mgr):
    # 1. No turns in memory -> Should not trigger context requirement
    assert session_mgr.detect_context_need("What is the capital of France?") is None

    # Record a prior turn
    session_mgr.record_turn(
        turn_id="turn_002",
        goal="Create invoice for client Acme Corp",
        final_answer="✓ Invoice created and saved as C:\\invoices\\acme_inv_101.pdf",
        tools_used=["generate_document"],
        files_touched=["C:\\invoices\\acme_inv_101.pdf"]
    )

    # 2. Self-contained prompt -> Should return None
    assert session_mgr.detect_context_need("List files in C:\\projects") is None

    # 3. Anaphoric prompt using pronoun 'it'
    ctx1 = session_mgr.detect_context_need("Now email it to finance@acme.com")
    assert ctx1 is not None
    assert "Acme Corp" in ctx1 or "acme_inv_101.pdf" in ctx1

    # 4. Incomplete / continuation prompt
    ctx2 = session_mgr.detect_context_need("Continue with the next step")
    assert ctx2 is not None
    assert "Relevant Prior Session Context" in ctx2

    # 5. Short question prompt
    ctx3 = session_mgr.detect_context_need("Why was that done?")
    assert ctx3 is not None


def test_memory_search_and_summary(session_mgr):
    session_mgr.record_turn(
        turn_id="turn_003",
        goal="Convert report.docx to PDF format",
        final_answer="✓ Converted report.docx to report.pdf",
        tools_used=["convert_file"],
        files_touched=["report.docx", "report.pdf"]
    )

    # Search
    results = session_mgr.search_memory("report.docx")
    assert len(results) > 0
    assert "report.docx" in results[0].get("goal", "") or results[0].get("key") == "report.docx"

    # Summary
    summary = session_mgr.get_session_summary(highlight_important=True)
    assert "Convert report.docx" in summary
    assert "Auto-Highlighted Key Memories" in summary


@pytest.mark.asyncio
async def test_memory_tools_execution(session_mgr, tmp_path):
    tools = get_memory_tools()
    assert len(tools) == 3

    context = ToolContext(task_id="test_mem_task")

    # 1. Recall Session Memory Tool
    recall_tool = RecallSessionMemoryTool()
    res1 = await recall_tool.execute({"get_summary": True}, context)
    assert res1.success is True
    assert "summary" in res1.data

    # 2. Save User Preference Tool
    save_pref_tool = SaveUserPreferenceTool()
    res2 = await save_pref_tool.execute({
        "key": "preferred_editor",
        "value": "VS Code",
        "category": "tools"
    }, context)
    assert res2.success is True
    assert res2.data["value"] == "VS Code"

    # 3. Get Personalization Profile Tool
    profile_tool = GetPersonalizationProfileTool()
    res3 = await profile_tool.execute({}, context)
    assert res3.success is True
    assert "preferences" in res3.data
