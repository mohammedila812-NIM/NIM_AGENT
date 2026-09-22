---
name: excel_automation
description: Build, format, and verify professional Excel spreadsheets and CSVs — sales sheets, budgets, trackers, financial models, data cleanups — with correct header styling, number formats, live formulas, and totals. Use this whenever the user asks for a spreadsheet, workbook, sales sheet, budget, tracker, or wants existing Excel/CSV data cleaned, formatted, charted, or have formulas added or fixed.
triggers: ["excel", "spreadsheet", "sheet", "xlsx", "csv", "workbook", "sales sheet"]
---
# Excel Automation & Formatting Guidelines

## Before Writing Anything
- Inspect the actual data first (types, ranges, blanks, outliers). If a column's meaning or the currency/locale is ambiguous, ask rather than guessing — a wrong assumption here propagates through every formula.

## Header & Layout
- Header row: dark navy background (`#1B365D`), bold white text (`#FFFFFF`), frozen (`freeze_panes`) so it stays visible on scroll, with autofilter enabled.
- Column widths: compute from the longest value in each column plus padding (don't hardcode one width for every column) so nothing truncates.
- Avoid merged cells anywhere data will be sorted or filtered — they break both. Reserve merges for a purely cosmetic title banner, if any.

## Data Formatting
- Currency: `$#,##0.00` by default; use the currency symbol the user actually specified if it isn't USD.
- Percentages: `0.0%`. Dates: `YYYY-MM-DD` unless the user's context implies another convention.

## Calculations & Totals
- Write real, live Excel formulas (`=SUM(...)`, `=AVERAGE(...)`) rather than pre-computed hardcoded numbers, so the sheet stays correct if the user edits inputs later.
- Add a `Total`/`Average` summary row: top thin border, bottom double border, bold text.

## Verification (must be concrete, not just "checked visually")
- Independently compute the expected totals in Python *before* writing formulas into the sheet.
- After writing the file, actually recompute the formulas — via a headless recalculation (e.g. `libreoffice --headless --convert-to xlsx --calc`) or a formula-evaluation library — and diff the recomputed values against your independently-computed expectations.
- Scan for `#REF!`, `#DIV/0!`, `#VALUE!` and any other error cells; fix and re-verify before calling the task done. Do not report a sheet as "verified" without having actually done this comparison.

## Presentation
- Only call `open_application(app_name="excel")` if that tool is actually available *and* the session has an interactive desktop — never assume a GUI exists (headless/remote agents won't have one). If it's unavailable, just hand over the file and summarize the key figures in text.
- For datasets over ~10k rows, warn about performance and offer a summary/pivot view instead of styling every raw row.