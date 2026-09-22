---
name: invoice_and_docs
description: Generate invoices, receipts, business reports, and CSV/data templates with correct sequential numbering, accurate math, and clean layout. Use this whenever the user asks for an invoice, bill, receipt, quarterly or business report, or a summary document/template meant to go to a client or vendor.
---
# Invoice & Document Generation Rules

## Numbering & Filenames
- Before creating a new invoice, check the target folder for existing files matching the naming pattern and increment the sequence — never hardcode a starting number like `INV-2026-001` every time. If the last number can't be determined, ask once.
- Filename pattern: `Invoice_<Number>_<ClientName>_<YYYY-MM-DD>.<ext>` (or the equivalent for reports), no spaces.
- Save to the user's Desktop (`~/Desktop`) by default, or wherever they specify.

## Structure
- Header block: Invoice Number, Issue Date, Due Date (default net-30 unless told otherwise), Vendor Name, Client Name, and billing address if provided.
- Line items table: Description, Quantity, Unit Price, Line Total — Line Total is always computed by the agent as Quantity × Unit Price, never typed by hand.
- Totals section: Subtotal, Tax/VAT, Grand Total, with the currency symbol the user actually specified (default USD only if nothing else is implied).

## Correctness Rules
- Never invent a tax/VAT rate or jurisdiction — ask if it isn't given, or omit the tax line entirely and say so.
- Round only at the final display step, not in intermediate calculations, to avoid cent-level drift between the line items and the grand total.
- Before saving, cross-check that the sum of line totals plus tax equals the displayed grand total exactly. If it doesn't, find and fix the discrepancy before writing the file.
- Validation gate: don't save a document missing vendor name, client name, or any line item's price — ask for the missing piece rather than filling in placeholders like "TBD" or "$0.00".

## Presentation
- Tell the user the file is ready and where it is. Only auto-launch a viewer/`open_application` if that tool is actually available in an interactive session — don't force it in headless/remote contexts.
- For anything going to an external client, offer a PDF export in addition to CSV/XLSX — a raw CSV/XLSX invoice looks unfinished to send externally.