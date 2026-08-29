from src.agents.specialists import SpecialistRouter

def test_specialist_router():
    spec_excel = SpecialistRouter.match_specialist("Analyze the Q3 profit formulas in revenue.xlsx")
    assert spec_excel.id == "spreadsheet"

    spec_doc = SpecialistRouter.match_specialist("Generate a professional proposal document in proposal.docx")
    assert spec_doc.id == "document"

    spec_research = SpecialistRouter.match_specialist("Search the web for latest AI news and summarize")
    assert spec_research.id == "research"

    spec_screen = SpecialistRouter.match_specialist("Inspect the active screen window")
    assert spec_screen.id == "perception"

    spec_system = SpecialistRouter.match_specialist("List files in Downloads directory and clean up")
    assert spec_system.id == "system"
