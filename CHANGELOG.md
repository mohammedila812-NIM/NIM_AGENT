# Changelog

All notable changes to NIM Agent are documented here.

## v0.4.0 — 2026-08-28

### Added

- Deterministic saved-macro replay, including step-by-step status in the Tasks panel.
- Semantic target resolution and a budget-checked model fallback to self-heal replay steps when page elements change.
- Optional saved-macro execution when a Watch Mode condition matches.
- Markdown rendering for assistant replies: headings, ordered and unordered lists, code blocks, and tables.
- Tests for macro replay, Markdown parsing, and retry-delay extraction.

### Improved

- LLM request and streaming retries now interpret provider quota delays and `Retry-After`, retry transient failures up to five times, and surface retry status.
- Navigation tracks the newly opened tab, waits for document completion, and allows time for SPA hydration before the next tool action.
- Macro traces retain target labels and reasoning, and macro/watch outcomes are captured in the security audit log.


