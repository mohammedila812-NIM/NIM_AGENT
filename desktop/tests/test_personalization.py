import pytest
from pathlib import Path
from src.personalization.engine import PersonalizationEngine


@pytest.fixture
def pers_engine(tmp_path):
    db_file = tmp_path / "test_pers.db"
    return PersonalizationEngine(db_path=db_file)


def test_startup_suggestions(pers_engine):
    suggestions = pers_engine.get_startup_suggestions()
    assert len(suggestions) >= 1
    assert "label" in suggestions[0]
    assert "goal" in suggestions[0]


def test_app_context_suggestions_and_debounce(pers_engine):
    # 1. VS Code Suggestions
    actions_vscode = pers_engine.get_app_context_suggestions("Code.exe", "my_project - Visual Studio Code")
    assert len(actions_vscode) > 0
    assert any("Git" in a["label"] or "Test" in a["label"] for a in actions_vscode)

    # 2. Debounce: immediate second call for the same app should be empty
    actions_debounced = pers_engine.get_app_context_suggestions("Code.exe", "my_project - Visual Studio Code")
    assert len(actions_debounced) == 0

    # 3. Excel Suggestions
    actions_excel = pers_engine.get_app_context_suggestions("excel.exe", "Financials_2026.xlsx - Excel")
    assert len(actions_excel) > 0
    assert any("Spreadsheet" in a["label"] or "CSV" in a["label"] for a in actions_excel)


def test_profile_summary(pers_engine):
    summary = pers_engine.get_profile_summary()
    assert "total_tasks_recorded" in summary
    assert "preferences" in summary
