import pytest
from src.skills.manager import SkillManager, get_skill_manager
from src.agent.loop import SessionScratchpad

def test_skills_manager_loading_and_matching():
    sm = get_skill_manager()
    skills = sm.list_skills()
    assert len(skills) >= 1
    
    excel_skill = sm.get_skill("excel_automation")
    assert excel_skill is not None
    assert "excel" in excel_skill.triggers

    # Match skills by query
    matched = sm.match_skills("Can you build an excel sales report?")
    assert len(matched) >= 1
    assert any(s.name == "excel_automation" for s in matched)

def test_session_scratchpad_memory():
    sp = SessionScratchpad()
    sp.record_file(r"C:\Reports\Q3_Sales.xlsx", purpose="Generated quarterly financial table")
    sp.record_window("EXCEL.EXE", pid=9999, title="Q3_Sales.xlsx - Excel")
    sp.record_task_turn("create q3 excel", "Created Q3_Sales.xlsx successfully")

    prompt_text = sp.format_scratchpad_prompt()
    assert "Q3_Sales.xlsx" in prompt_text
    assert "EXCEL.EXE" in prompt_text
    assert "create q3 excel" in prompt_text

    sp.clear()
    assert sp.format_scratchpad_prompt() == ""

def test_all_builtin_skills_loaded():
    sm = get_skill_manager()
    names = [s["name"] for s in sm.list_skills()]
    for expected in ["excel_automation", "file_management", "invoice_and_docs", "presentation_creator", "system_diagnostic"]:
        assert expected in names, f"Skill {expected} should be loaded"

def test_security_guard_zero_elevation():
    from src.security.guard import SecurityGuard, ActionRiskLevel
    # Admin elevation patterns must be flagged CRITICAL
    admin_cmds = [
        "Start-Process powershell -Verb RunAs",
        "runas /user:administrator cmd.exe",
        "takeown /f C:\\Windows\\System32",
        "icacls C:\\Windows /grant Everyone:F",
        "net user hacker Password123 /add",
        "type C:\\Users\\Administrator\\Desktop\\secret.txt",
    ]
    for cmd in admin_cmds:
        risk, reason = SecurityGuard.evaluate_shell_command(cmd)
        assert risk == ActionRiskLevel.CRITICAL, f"Command '{cmd}' should be blocked as CRITICAL"

def test_security_guard_file_mutations_destructive():
    from src.security.guard import SecurityGuard, ActionRiskLevel
    # File tools must be DESTRUCTIVE
    for tool_name in ["write_file", "move_file", "delete_file"]:
        risk = SecurityGuard.evaluate_tool_call(tool_name, {"path": "test.txt"})
        assert risk == ActionRiskLevel.DESTRUCTIVE

    # Shell commands mutating files must be DESTRUCTIVE
    file_cmds = [
        "Remove-Item -Path test.txt",
        "New-Item -ItemType File file.txt",
        "del old_file.csv",
        "echo hello > out.txt",
    ]
    for cmd in file_cmds:
        risk, reason = SecurityGuard.evaluate_shell_command(cmd)
        assert risk == ActionRiskLevel.DESTRUCTIVE, f"Command '{cmd}' should be classified DESTRUCTIVE"
