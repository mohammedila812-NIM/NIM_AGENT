"""
Specialized Domain Sub-Agents for NIM JARVIS Desktop
"""

from dataclasses import dataclass
from typing import List, Optional

@dataclass
class SpecialistProfile:
    id: str
    name: str
    description: str
    specialized_tools: List[str]
    system_prompt_addon: str

SPECIALIST_PROFILES = [
    SpecialistProfile(
        id="spreadsheet",
        name="Spreadsheet Specialist",
        description="Deep analysis of Excel (.xlsx) and CSV files, formula auditing, statistics, and financial modeling.",
        specialized_tools=["analyze_spreadsheet", "read_file", "write_file", "generate_document"],
        system_prompt_addon="You are a senior financial analyst and Excel specialist. When analyzing spreadsheets, prioritize formula integrity, identify error cells (#DIV/0!, #REF!), compute statistical trends, and summarize data with precision."
    ),
    SpecialistProfile(
        id="document",
        name="Document Generation Specialist",
        description="Professional authoring of Word (.docx), Excel (.xlsx), PDF, PowerPoint (.pptx), and Markdown docs.",
        specialized_tools=["generate_document", "write_file", "read_file"],
        system_prompt_addon="You are a professional technical writer and document designer. Structure all generated documents with clean headings, executive summaries, bullet points, and formatted data tables."
    ),
    SpecialistProfile(
        id="research",
        name="Research & Web Specialist",
        description="Real-time web research, news extraction, browser extension delegation, and multi-source synthesis.",
        specialized_tools=["web_search", "read_url", "browser_research"],
        system_prompt_addon="You are a research specialist. Cross-reference multiple live sources, extract key factual points with source URLs, and deliver structured briefings."
    ),
    SpecialistProfile(
        id="system",
        name="System & Automation Specialist",
        description="OS automation, process management, file organization, clipboard operations, and shell diagnostics.",
        specialized_tools=["run_command", "get_system_info", "list_directory", "search_files", "set_clipboard", "get_clipboard", "undo_last_action"],
        system_prompt_addon="You are an expert system administrator. Execute safe shell commands, inspect processes accurately, and ensure all file modifications are snapshotted."
    ),
    SpecialistProfile(
        id="perception",
        name="Visual & Screen Perception Specialist",
        description="Active window inspection, screen capture, UI Automation accessibility reading, and OCR analysis.",
        specialized_tools=["get_active_window_info", "capture_screen_region", "ocr_screen_text", "verify_action_result"],
        system_prompt_addon="You are an expert in computer vision and UI automation. Inspect foreground windows, analyze active UI elements, and verify state changes after interactions."
    ),
]

class SpecialistRouter:
    """Routes incoming goals to the most suitable domain specialist."""

    @classmethod
    def match_specialist(cls, goal: str) -> SpecialistProfile:
        g = goal.lower()
        if any(w in g for w in ["excel", "sheet", "spreadsheet", ".xlsx", ".csv", "formula", "financial"]):
            return next(p for p in SPECIALIST_PROFILES if p.id == "spreadsheet")
        elif any(w in g for w in ["doc", "docx", "pdf", "pptx", "powerpoint", "word", "proposal", "report"]):
            return next(p for p in SPECIALIST_PROFILES if p.id == "document")
        elif any(w in g for w in ["search", "news", "browse", "website", "url", "article", "web"]):
            return next(p for p in SPECIALIST_PROFILES if p.id == "research")
        elif any(w in g for w in ["screen", "window", "ocr", "look at", "see", "active window", "inspect"]):
            return next(p for p in SPECIALIST_PROFILES if p.id == "perception")
        else:
            return next(p for p in SPECIALIST_PROFILES if p.id == "system")
