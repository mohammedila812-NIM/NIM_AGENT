import os
from pathlib import Path
from typing import Any, Dict, List, Optional
from .base import BaseTool, ToolContext, ToolResult
from src.security.guard import ActionRiskLevel
from src.security.snapshot import get_snapshot_manager

def resolve_target_path(raw_path: str) -> Path:
    p = os.path.expanduser(str(raw_path).strip())
    p_lower = p.lower()
    if p_lower.startswith("desktop/") or p_lower.startswith("desktop\\"):
        return (Path.home() / "Desktop" / p[8:]).resolve()
    elif p_lower.startswith("documents/") or p_lower.startswith("documents\\"):
        return (Path.home() / "Documents" / p[10:]).resolve()
    elif p_lower.startswith("downloads/") or p_lower.startswith("downloads\\"):
        return (Path.home() / "Downloads" / p[10:]).resolve()
    return Path(p).resolve()

class GenerateDocumentTool(BaseTool):
    name = "generate_document"
    description = (
        "Create rich, professionally formatted documents on the local filesystem. "
        "Supports 'docx' (Word), 'xlsx' (Excel spreadsheet), 'pdf' (PDF document), "
        "'pptx' (PowerPoint presentation), and 'md' (Markdown)."
    )
    parameters = {
        "type": "object",
        "properties": {
            "file_path": {"type": "string", "description": "Destination file path (e.g. 'C:/Users/.../report.docx' or 'Desktop/report.docx')."},
            "doc_type": {
                "type": "string",
                "enum": ["docx", "xlsx", "pdf", "pptx", "md"],
                "description": "Document format to generate."
            },
            "title": {"type": "string", "description": "Document title."},
            "sections": {
                "type": "array",
                "description": "Structured sections of the document. Each section has 'heading', 'content', and optional 'table_data' (list of rows) or 'bullet_points' (list of strings).",
                "items": {
                    "type": "object",
                    "properties": {
                        "heading": {"type": "string"},
                        "content": {"type": "string"},
                        "bullet_points": {"type": "array", "items": {"type": "string"}},
                        "table_data": {"type": "array", "items": {"type": "array", "items": {"type": "string"}}}
                    },
                    "required": ["heading"]
                }
            }
        },
        "required": ["file_path", "doc_type", "title", "sections"]
    }
    risk_level = ActionRiskLevel.MODERATE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        file_path = resolve_target_path(str(args.get("file_path")))
        doc_type = str(args.get("doc_type", "docx")).lower()
        title = str(args.get("title", "Document"))
        sections = args.get("sections", [])

        # Snapshot destination if already exists
        snapshot_mgr = get_snapshot_manager()
        snap_id = snapshot_mgr.snapshot_before_action(
            target_path=file_path,
            action_type="modify" if file_path.exists() else "create",
            task_id=context.task_id,
            description=f"Generating {doc_type.upper()} document: {file_path.name}"
        )

        try:
            file_path.parent.mkdir(parents=True, exist_ok=True)

            if doc_type == "docx":
                self._generate_docx(file_path, title, sections)
            elif doc_type == "xlsx":
                self._generate_xlsx(file_path, title, sections)
            elif doc_type == "pdf":
                self._generate_pdf(file_path, title, sections)
            elif doc_type == "pptx":
                self._generate_pptx(file_path, title, sections)
            elif doc_type == "md":
                self._generate_md(file_path, title, sections)
            else:
                return ToolResult(success=False, data=None, error=f"Unsupported document format: {doc_type}")

            return ToolResult(
                success=True,
                data={
                    "file_path": str(file_path),
                    "doc_type": doc_type,
                    "title": title,
                    "sections_count": len(sections),
                    "snapshot_id": snap_id,
                    "status": "Document created successfully"
                },
                snapshot_id=snap_id
            )
        except Exception as e:
            return ToolResult(success=False, data=None, error=f"Failed to generate document: {str(e)}")

    def _generate_docx(self, path: Path, title: str, sections: List[Dict[str, Any]]):
        import docx
        from docx.shared import Inches, Pt, RGBColor
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        from docx.enum.table import WD_TABLE_ALIGNMENT
        from docx.oxml import OxmlElement
        from docx.oxml.ns import qn

        def set_cell_background(cell, hex_color: str):
            tcPr = cell._tc.get_or_add_tcPr()
            shd = OxmlElement('w:shd')
            shd.set(qn('w:val'), 'clear')
            shd.set(qn('w:color'), 'auto')
            shd.set(qn('w:fill'), hex_color)
            tcPr.append(shd)

        def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
            tcPr = cell._tc.get_or_add_tcPr()
            tcMar = OxmlElement('w:tcMar')
            for m, val in [('w:top', top), ('w:bottom', bottom), ('w:left', left), ('w:right', right)]:
                node = OxmlElement(m)
                node.set(qn('w:w'), str(val))
                node.set(qn('w:type'), 'dxa')
                tcMar.append(node)
            tcPr.append(tcMar)

        doc = docx.Document()
        for s in doc.sections:
            s.top_margin = Inches(0.8)
            s.bottom_margin = Inches(0.8)
            s.left_margin = Inches(0.8)
            s.right_margin = Inches(0.8)

        # Title
        p_title = doc.add_paragraph()
        run_title = p_title.add_run(title)
        run_title.font.name = "Calibri"
        run_title.font.size = Pt(22)
        run_title.font.bold = True
        run_title.font.color.rgb = RGBColor(0x1B, 0x36, 0x5D) # Navy
        p_title.paragraph_format.space_after = Pt(14)

        for sec in sections:
            heading = sec.get("heading")
            if heading:
                p_head = doc.add_paragraph()
                run_head = p_head.add_run(heading)
                run_head.font.name = "Calibri"
                run_head.font.size = Pt(13)
                run_head.font.bold = True
                run_head.font.color.rgb = RGBColor(0x1B, 0x36, 0x5D)
                p_head.paragraph_format.space_before = Pt(12)
                p_head.paragraph_format.space_after = Pt(4)

            content = sec.get("content")
            if content:
                p_content = doc.add_paragraph()
                run_content = p_content.add_run(content)
                run_content.font.name = "Calibri"
                run_content.font.size = Pt(10.5)
                run_content.font.color.rgb = RGBColor(0x33, 0x41, 0x55) # Slate
                p_content.paragraph_format.space_after = Pt(6)
                p_content.paragraph_format.line_spacing = 1.15

            bullets = sec.get("bullet_points", [])
            for bp in bullets:
                p_bp = doc.add_paragraph(style="List Bullet")
                run_bp = p_bp.add_run(bp)
                run_bp.font.name = "Calibri"
                run_bp.font.size = Pt(10)
                run_bp.font.color.rgb = RGBColor(0x33, 0x41, 0x55)
                p_bp.paragraph_format.space_after = Pt(3)

            table_data = sec.get("table_data", [])
            if table_data and len(table_data) > 0:
                rows_count = len(table_data)
                cols_count = max(len(r) for r in table_data)
                table = doc.add_table(rows=rows_count, cols=cols_count)
                table.alignment = WD_TABLE_ALIGNMENT.CENTER
                table.style = "Table Grid"

                for r_idx, row in enumerate(table_data):
                    is_header = (r_idx == 0)
                    is_summary = any(str(c).strip().lower() in ["total", "totals", "grand total", "average", "avg"] for c in row[:2])

                    for c_idx, val in enumerate(row):
                        cell = table.cell(r_idx, c_idx)
                        cell.text = str(val)
                        set_cell_margins(cell, top=120, bottom=120, left=150, right=150)
                        p = cell.paragraphs[0]
                        p.paragraph_format.space_after = Pt(0)
                        p.paragraph_format.line_spacing = 1.0

                        if is_header:
                            set_cell_background(cell, "1B365D") # Navy
                            if p.runs:
                                p.runs[0].font.bold = True
                                p.runs[0].font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
                                p.runs[0].font.size = Pt(10)
                        elif is_summary:
                            set_cell_background(cell, "F1F5F9")
                            if p.runs:
                                p.runs[0].font.bold = True
                                p.runs[0].font.color.rgb = RGBColor(0x0F, 0x17, 0x2A)
                                p.runs[0].font.size = Pt(9.5)
                        else:
                            bg_color = "FFFFFF" if r_idx % 2 != 0 else "F8FAFC"
                            set_cell_background(cell, bg_color)
                            if p.runs:
                                p.runs[0].font.size = Pt(9.5)
                                p.runs[0].font.color.rgb = RGBColor(0x33, 0x41, 0x55)

                doc.add_paragraph().paragraph_format.space_after = Pt(6)

        doc.save(str(path))

    def _generate_xlsx(self, path: Path, title: str, sections: List[Dict[str, Any]]):
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.utils import get_column_letter
        import re

        wb = openpyxl.Workbook()
        ws = wb.active
        clean_title = re.sub(r'[\\/*?:\[\]]', '_', title)[:31] if title else "Sheet1"
        ws.title = clean_title or "Sheet1"
        ws.views.sheetView[0].showGridLines = True

        navy_fill = PatternFill(start_color="1B365D", end_color="1B365D", fill_type="solid")
        header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        title_font = Font(name="Calibri", size=16, bold=True, color="1B365D")
        sub_font = Font(name="Calibri", size=11, italic=True, color="64748B")
        regular_font = Font(name="Calibri", size=10, color="0F172A")
        bold_font = Font(name="Calibri", size=10, bold=True, color="0F172A")

        thin_side = Side(style="thin", color="E2E8F0")
        regular_border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)
        summary_border = Border(
            top=Side(style="thin", color="1B365D"),
            bottom=Side(style="double", color="1B365D"),
            left=thin_side, right=thin_side
        )

        current_row = 1
        # Title Banner
        title_cell = ws.cell(row=current_row, column=1, value=title)
        title_cell.font = title_font
        ws.row_dimensions[current_row].height = 28
        current_row += 2

        for sec in sections:
            heading = sec.get("heading")
            if heading:
                h_cell = ws.cell(row=current_row, column=1, value=heading)
                h_cell.font = Font(name="Calibri", size=12, bold=True, color="FFFFFF")
                h_cell.fill = navy_fill
                h_cell.alignment = Alignment(vertical="center", indent=1)
                ws.row_dimensions[current_row].height = 24
                current_row += 1

            content = sec.get("content")
            if content:
                c_cell = ws.cell(row=current_row, column=1, value=content)
                c_cell.font = sub_font
                ws.row_dimensions[current_row].height = 18
                current_row += 1

            table_data = sec.get("table_data", [])
            if table_data and len(table_data) > 0:
                header_row_num = current_row
                num_cols = len(table_data[0])
                col_headers = [str(c).strip().lower() for c in table_data[0]]

                # Identify column types
                col_formats = []
                for h_text in col_headers:
                    if any(k in h_text for k in ["price", "cost", "total", "revenue", "amount", "budget", "subtotal", "fee", "salary", "spend", "sales", "discount", "profit"]):
                        col_formats.append("currency")
                    elif any(k in h_text for k in ["margin", "rate", "percent", "%", "growth", "yield", "ratio"]):
                        col_formats.append("percentage")
                    elif any(k in h_text for k in ["qty", "quantity", "count", "units", "items", "id", "rank", "year"]):
                        col_formats.append("integer")
                    elif any(k in h_text for k in ["date", "period", "month", "day"]):
                        col_formats.append("date")
                    else:
                        col_formats.append("general")

                for r_idx, row in enumerate(table_data):
                    ws.row_dimensions[current_row].height = 24 if r_idx == 0 else 20
                    is_header = (r_idx == 0)
                    is_summary = any(str(c).strip().lower() in ["total", "totals", "grand total", "average", "avg", "subtotal"] for c in row[:2])

                    for c_idx, raw_val in enumerate(row):
                        cell = ws.cell(row=current_row, column=c_idx + 1)
                        c_type = col_formats[c_idx] if c_idx < len(col_formats) else "general"

                        # Formula preservation or numeric parsing
                        val_str = str(raw_val).strip() if raw_val is not None else ""
                        if val_str.startswith("="):
                            cell.value = val_str
                        else:
                            # Try numeric parse
                            clean_num = val_str.replace("$", "").replace(",", "").rstrip("%").strip()
                            try:
                                if "." in clean_num:
                                    parsed_val = float(clean_num)
                                    if val_str.endswith("%") or c_type == "percentage":
                                        parsed_val = parsed_val / 100.0 if not val_str.endswith("%") and parsed_val > 1.0 else parsed_val
                                    cell.value = parsed_val
                                else:
                                    parsed_val = int(clean_num)
                                    cell.value = parsed_val
                            except ValueError:
                                cell.value = val_str

                        # Styling
                        if is_header:
                            cell.fill = navy_fill
                            cell.font = header_font
                            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
                            cell.border = regular_border
                        elif is_summary:
                            cell.fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
                            cell.font = bold_font
                            cell.border = summary_border
                        else:
                            bg = "FFFFFF" if r_idx % 2 != 0 else "F8FAFC"
                            cell.fill = PatternFill(start_color=bg, end_color=bg, fill_type="solid")
                            cell.font = regular_font
                            cell.border = regular_border

                        # Number formatting & Alignment (for data and summary rows)
                        if not is_header:
                            if c_type == "currency" or (isinstance(cell.value, (int, float)) and any(k in col_headers[c_idx] for k in ["price", "cost", "total", "revenue", "amount", "budget"])):
                                cell.number_format = "$#,##0.00"
                                cell.alignment = Alignment(horizontal="right", vertical="center")
                            elif c_type == "percentage" or (isinstance(cell.value, (int, float)) and any(k in col_headers[c_idx] for k in ["margin", "rate", "%"])):
                                cell.number_format = "0.0%"
                                cell.alignment = Alignment(horizontal="right", vertical="center")
                            elif c_type == "integer" and isinstance(cell.value, (int, float)):
                                cell.number_format = "#,##0"
                                cell.alignment = Alignment(horizontal="right", vertical="center")
                            elif isinstance(cell.value, (int, float)):
                                cell.alignment = Alignment(horizontal="right", vertical="center")
                            else:
                                cell.alignment = Alignment(horizontal="left", vertical="center")

                    current_row += 1

                # Freeze panes below header
                ws.freeze_panes = f"A{header_row_num + 1}"
                # Autofilter
                ws.auto_filter.ref = f"A{header_row_num}:{get_column_letter(num_cols)}{current_row - 1}"

            current_row += 1

        # Auto-compute column widths so text never clips or shows ###
        for col in ws.columns:
            max_len = 0
            col_letter = get_column_letter(col[0].column)
            for cell in col:
                val = cell.value
                if val is not None:
                    s = str(val)
                    if cell.number_format and "$" in cell.number_format:
                        s += "    "
                    max_len = max(max_len, len(s))
            ws.column_dimensions[col_letter].width = max(max_len + 4, 12)

        wb.save(str(path))

    def _generate_pdf(self, path: Path, title: str, sections: List[Dict[str, Any]]):
        from reportlab.lib.pagesizes import letter
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib import colors
        from reportlab.lib.units import inch
        import xml.sax.saxutils

        def safe_xml(s: Any) -> str:
            return xml.sax.saxutils.escape(str(s))

        doc = SimpleDocTemplate(
            str(path),
            pagesize=letter,
            leftMargin=0.6 * inch,
            rightMargin=0.6 * inch,
            topMargin=0.6 * inch,
            bottomMargin=0.6 * inch
        )
        styles = getSampleStyleSheet()
        story = []

        title_style = ParagraphStyle(
            'ExecutiveTitle',
            parent=styles['Title'],
            fontName='Helvetica-Bold',
            fontSize=22,
            leading=26,
            textColor=colors.HexColor('#1B365D'),
            alignment=0
        )
        head_style = ParagraphStyle(
            'ExecutiveHeading',
            parent=styles['Heading2'],
            fontName='Helvetica-Bold',
            fontSize=13,
            leading=16,
            textColor=colors.HexColor('#1B365D'),
            spaceBefore=12,
            spaceAfter=6
        )
        body_style = ParagraphStyle(
            'ExecutiveBody',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=10,
            leading=14,
            textColor=colors.HexColor('#334155')
        )

        story.append(Paragraph(safe_xml(title), title_style))
        story.append(Spacer(1, 12))

        for sec in sections:
            heading = sec.get("heading")
            if heading:
                story.append(Paragraph(safe_xml(heading), head_style))
                story.append(Spacer(1, 4))

            content = sec.get("content")
            if content:
                story.append(Paragraph(safe_xml(content), body_style))
                story.append(Spacer(1, 6))

            bullets = sec.get("bullet_points", [])
            for bp in bullets:
                story.append(Paragraph(f"• {safe_xml(bp)}", body_style))
                story.append(Spacer(1, 3))

            table_data = sec.get("table_data", [])
            if table_data and len(table_data) > 0:
                cleaned_table = [[Paragraph(safe_xml(c), body_style) for c in row] for row in table_data]
                t = Table(cleaned_table)
                t_style = [
                    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1B365D')),
                    ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
                    ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
                    ('TOPPADDING', (0, 0), (-1, -1), 6),
                    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CBD5E1')),
                ]
                # Alternating row fills
                for i in range(1, len(table_data)):
                    bg = colors.HexColor('#F8FAFC') if i % 2 == 0 else colors.white
                    t_style.append(('BACKGROUND', (0, i), (-1, i), bg))
                t.setStyle(TableStyle(t_style))
                story.append(t)
                story.append(Spacer(1, 10))

        doc.build(story)

    def _generate_pptx(self, path: Path, title: str, sections: List[Dict[str, Any]]):
        from pptx import Presentation
        from pptx.util import Inches, Pt
        from pptx.dml.color import RGBColor

        prs = Presentation()
        # Set 16:9 widescreen layout
        prs.slide_width = Inches(13.333)
        prs.slide_height = Inches(7.5)

        # Title slide
        title_slide_layout = prs.slide_layouts[0]
        slide = prs.slides.add_slide(title_slide_layout)
        background = slide.background
        fill = background.fill
        fill.solid()
        fill.fore_color.rgb = RGBColor(0x0F, 0x17, 0x2A) # Deep Navy

        t_shape = slide.shapes.title
        t_shape.text = title
        t_para = t_shape.text_frame.paragraphs[0]
        t_para.font.name = "Calibri"
        t_para.font.size = Pt(40)
        t_para.font.bold = True
        t_para.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

        if len(slide.placeholders) > 1:
            sub = slide.placeholders[1]
            sub.text = "Executive Briefing & Strategy Document"
            sub_para = sub.text_frame.paragraphs[0]
            sub_para.font.name = "Calibri"
            sub_para.font.size = Pt(18)
            sub_para.font.color.rgb = RGBColor(0x06, 0xB6, 0xD4) # Cyan

        # Section slides
        bullet_slide_layout = prs.slide_layouts[1]
        for sec in sections:
            slide = prs.slides.add_slide(bullet_slide_layout)
            slide.shapes.title.text = sec.get("heading", "Executive Overview")
            title_p = slide.shapes.title.text_frame.paragraphs[0]
            title_p.font.name = "Calibri"
            title_p.font.size = Pt(26)
            title_p.font.bold = True
            title_p.font.color.rgb = RGBColor(0x1B, 0x36, 0x5D)

            tf = slide.placeholders[1].text_frame
            content = sec.get("content")
            if content:
                tf.text = content
                tf.paragraphs[0].font.name = "Calibri"
                tf.paragraphs[0].font.size = Pt(15)
                tf.paragraphs[0].font.color.rgb = RGBColor(0x33, 0x41, 0x55)

            bullets = sec.get("bullet_points", [])
            for bp in bullets:
                p = tf.add_paragraph()
                p.text = bp
                p.level = 0
                p.font.name = "Calibri"
                p.font.size = Pt(14)
                p.font.color.rgb = RGBColor(0x33, 0x41, 0x55)

        prs.save(str(path))

    def _generate_md(self, path: Path, title: str, sections: List[Dict[str, Any]]):
        lines = [f"# {title}\n\n"]
        for sec in sections:
            heading = sec.get("heading")
            if heading:
                lines.append(f"## {heading}\n\n")
            content = sec.get("content")
            if content:
                lines.append(f"{content}\n\n")
            bullets = sec.get("bullet_points", [])
            for bp in bullets:
                lines.append(f"- {bp}\n")
            if bullets:
                lines.append("\n")
            table_data = sec.get("table_data", [])
            if table_data and len(table_data) > 0:
                header = table_data[0]
                lines.append("| " + " | ".join(str(c) for c in header) + " |\n")
                lines.append("| " + " | ".join(["---"] * len(header)) + " |\n")
                for row in table_data[1:]:
                    lines.append("| " + " | ".join(str(c) for c in row) + " |\n")
                lines.append("\n")

        with open(path, "w", encoding="utf-8") as f:
            f.writelines(lines)
