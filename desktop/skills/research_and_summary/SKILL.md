---
name: research_and_summary
description: Perform in-depth research, web lookup, competitive analysis, and synthesize findings into concise, structured executive briefing memos. Use this whenever the user asks to research a topic, investigate a company or technology, summarize web information, or prepare a briefing report.
triggers: ["research", "summarize", "briefing", "overview", "investigate", "memo", "dossier"]
---
# Research & Executive Summary Guidelines

## 1. Source Gathering & Fact Verification
- Use `web_search` and `read_url` to collect up-to-date, authoritative information.
- Cross-reference multiple sources before making factual assertions.
- Clearly attribute facts and statistics to their sources.

## 2. Structure of an Executive Briefing
- Avoid walls of unorganized text. Structure every research report with:
  1. **Executive Summary**: 1–2 paragraphs capturing the core answers or landscape.
  2. **Key Strategic Takeaways**: Bullet points highlighting high-impact data points, competitive shifts, or developments.
  3. **Comparative Analysis / Data Table**: Where applicable, present pricing, features, or timelines in a structured comparison table.
  4. **Risks, Opportunities & Next Steps**: Forward-looking conclusions.

## 3. Output Delivery
- State the final summary clearly in conversational output.
- If requested as a file, generate an executive Word document (`.docx`), PDF (`.pdf`), or Markdown document (`.md`) on `~/Desktop` using `generate_document`.
