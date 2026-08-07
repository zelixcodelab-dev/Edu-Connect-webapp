"""Server-side admission Application PDF — KM Foundation branded.

Layout matches the user's SVG template:
  - 0-40pt: Red→Black linear gradient header band
  - 40-110pt: AdmissionForm wordmark TOP-LEFT (Admission black + Form red)
              + KM logo TOP-RIGHT + Ref / Submitted right-aligned
  - Thin red rule separator
  - Body with consistent vertical spacing between sections
  - Pink (#FFE7F3) accent on 10th / 12th sub-headers in academic table
  - Footer: red→black gradient band + KM Foundation contact line
  - Montserrat font family throughout (TTF embedded)

Single A4 page output.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from io import BytesIO
from textwrap import wrap
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Table, TableStyle


log = logging.getLogger("finflow.application_pdf")

PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN = 36
CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN

# Header zones (in pt, measured from top of page)
HEADER_BAR_HEIGHT = 36     # Red→black gradient strip at the very top
HEADER_BLOCK_HEIGHT = 80   # Logo + AdmissionForm + Ref live in this band
FOOTER_BAR_HEIGHT = 30     # Decorative gradient strip + contact line at bottom

# Brand palette per design spec
BRAND_RED = colors.HexColor("#C70000")
BRAND_BLACK = colors.HexColor("#101010")
PINK_ACCENT = colors.HexColor("#FFE7F3")
INK = colors.HexColor("#000000")
MUTED = colors.HexColor("#5a5a5a")
RULE = colors.HexColor("#d4d4d4")


# ---------- Font registration (Montserrat from /app/backend/lib/fonts) ----------
_FONTS_DIR = os.path.join(os.path.dirname(__file__), "fonts")
_FONT_FAMILY_PRIMARY = "Helvetica"
_FONT_FAMILY_BOLD = "Helvetica-Bold"
_FONT_FAMILY_SEMI = "Helvetica-Bold"
_FONT_FAMILY_LIGHT = "Helvetica"


def _register_fonts() -> None:
    global _FONT_FAMILY_PRIMARY, _FONT_FAMILY_BOLD, _FONT_FAMILY_SEMI, _FONT_FAMILY_LIGHT
    mappings = [
        ("Montserrat", "Montserrat-Regular.ttf"),
        ("Montserrat-Bold", "Montserrat-Bold.ttf"),
        ("Montserrat-SemiBold", "Montserrat-SemiBold.ttf"),
        ("Montserrat-Light", "Montserrat-Light.ttf"),
    ]
    registered = []
    for name, filename in mappings:
        path = os.path.join(_FONTS_DIR, filename)
        if not os.path.isfile(path):
            continue
        try:
            if name not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(name, path))
            registered.append(name)
        except Exception as exc:  # pragma: no cover
            log.warning("[pdf] failed to register %s: %s", name, exc)
    if "Montserrat" in registered:
        _FONT_FAMILY_PRIMARY = "Montserrat"
    if "Montserrat-Bold" in registered:
        _FONT_FAMILY_BOLD = "Montserrat-Bold"
    if "Montserrat-SemiBold" in registered:
        _FONT_FAMILY_SEMI = "Montserrat-SemiBold"
    if "Montserrat-Light" in registered:
        _FONT_FAMILY_LIGHT = "Montserrat-Light"


_register_fonts()


# ---------- Helpers ----------
GENDER_MAP = {"male": "Male", "female": "Female", "other": "Other"}
ADMISSION_MAP = {
    "management": "MANAGEMENT",
    "government": "GOVERNMENT",
    "merit": "MERIT",
    "lateral_entry": "LATERAL ENTRY",
    "other": "OTHER",
}

DECLARATION_TEXT = (
    "I certify all the information furnished in this application form for "
    "getting admission in {college_name} are correct, complete and to the "
    "best of my knowledge. I agree to abide by all the rules and regulations "
    "on the institution. I understand that with holding or giving false "
    "information will make me in-eligble for admission. "
    "I understand the fee paid to {college_name} are neither refundable nor "
    "transferrable any circumstances."
)


def _v(value: Any) -> str:
    if value is None or value == "":
        return "—"
    return str(value)


def _label_of(mapping: dict, key: Any) -> str:
    if not key:
        return "—"
    return mapping.get(key, key)


def _fmt_date(s: str | None) -> str:
    if not s:
        return "—"
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00")) if "T" in s else datetime.strptime(s, "%Y-%m-%d")
        return d.strftime("%b %d, %Y")
    except (ValueError, TypeError):
        return s


def _render_declaration(college_name: str | None) -> str:
    name = (college_name or "").strip() or "_________________"
    return DECLARATION_TEXT.replace("{college_name}", name)


def _asset_path(name: str) -> str | None:
    """Resolve the absolute path to a packaged PDF asset (logo / wordmark).

    Looks first inside the backend's bundled `lib/assets/` directory, then
    falls back to the frontend's `public/` folder so a single source of
    truth is shared across email PDFs and downloadable PDFs.
    """
    here = os.path.dirname(__file__)
    candidates = [
        os.path.join(here, "assets", name),
        os.path.abspath(os.path.join(here, "..", "..", "frontend", "public", name)),
        f"/app/frontend/public/{name}",
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    return None


def _logo_path() -> str | None:
    """Pre-composed PDF header banner (top of the PDF)."""
    return _asset_path("pdf-header.png") or _asset_path("pdf-header.jpg")


# ---------- Header banner constants ----------
# Source artwork is 4000×770px (aspect 5.195) — drawn full A4 width (595pt).
HEADER_IMG_HEIGHT = 595 / 5.195  # ≈ 114.5pt
# Pixel-measured positions of the white "Ref:" / "Submitted:" labels inside
# the banner. Values are fractions of the banner image size.
REF_LABEL_Y_FRAC = 0.1403
SUBMITTED_LABEL_Y_FRAC = 0.2494
LABEL_COLON_X_FRAC = 0.8645


def _draw_gradient_strip(c: Canvas, top_y: float, height: float, reverse: bool = False) -> None:
    """Draw a horizontal red→black gradient strip occupying the full page
    width. ``top_y`` is the top edge of the strip (in PDF coords).
    Setting ``reverse=True`` flips the gradient (black→red), used for the
    footer to visually mirror the header.
    """
    steps = 240
    stripe_w = PAGE_WIDTH / steps
    for i in range(steps):
        t = i / (steps - 1)
        if reverse:
            t = 1 - t
        r = int(0xC7 + (0x10 - 0xC7) * t)
        g = int(0x00 + (0x10 - 0x00) * t)
        b = int(0x00 + (0x10 - 0x00) * t)
        c.setFillColorRGB(r / 255, g / 255, b / 255)
        c.rect(i * stripe_w, top_y - height, stripe_w + 0.6, height, stroke=0, fill=1)


def _draw_header(c: Canvas, ref_code: str, submitted_at: str) -> float:
    """Draw the pre-composed banner image at the top of the page and overlay
    the dynamic Ref code + Submitted date next to the labels printed inside
    the banner. Returns the y-cursor where body content can begin.
    """
    header_img = _logo_path()
    img_top = PAGE_HEIGHT  # banner hugs the top edge
    img_bottom = PAGE_HEIGHT - HEADER_IMG_HEIGHT

    if header_img:
        try:
            c.drawImage(
                header_img, 0, img_bottom,
                width=PAGE_WIDTH, height=HEADER_IMG_HEIGHT,
                preserveAspectRatio=False, mask=None,
            )
        except Exception as exc:
            log.warning("[pdf] header drawImage failed: %s", exc)

    # Overlay dynamic Ref + Submitted text next to the white labels in the
    # banner. Both labels are right-aligned at x = LABEL_COLON_X_FRAC * width
    # and we draw the value just to the right of the colon in white.
    value_x = PAGE_WIDTH * LABEL_COLON_X_FRAC + 6
    ref_y = img_top - HEADER_IMG_HEIGHT * REF_LABEL_Y_FRAC - 3
    sub_y = img_top - HEADER_IMG_HEIGHT * SUBMITTED_LABEL_Y_FRAC - 3

    c.setFillColor(colors.white)
    c.setFont(_FONT_FAMILY_SEMI, 7.5)
    c.drawString(value_x, ref_y, ref_code)
    c.setFont(_FONT_FAMILY_PRIMARY, 7)
    c.drawString(value_x, sub_y, _fmt_date(submitted_at))

    # Body content begins 16pt below the banner.
    return img_bottom - 16


def _draw_applicant_banner(c: Canvas, opts: dict, y: float) -> float:
    name = (opts.get("student_name") or "—").upper()
    course = (opts.get("course") or "—").upper()
    college = (opts.get("college") or "—").upper()

    c.setFillColor(INK)
    c.setFont(_FONT_FAMILY_BOLD, 20)
    c.drawString(MARGIN, y - 3, name)

    c.setFont(_FONT_FAMILY_SEMI, 10)
    c.drawString(MARGIN, y - 18, course)

    c.setFont(_FONT_FAMILY_SEMI, 10)
    c.setFillColor(MUTED)
    c.drawString(MARGIN, y - 31, college)

    c.setFillColor(INK)
    c.setFont(_FONT_FAMILY_SEMI, 8.5)
    c.drawRightString(PAGE_WIDTH - MARGIN, y - 6,
                      f"Admission Type:  {opts.get('admission_type') or '—'}")
    c.drawRightString(PAGE_WIDTH - MARGIN, y - 20,
                      f"Academic Year:  {opts.get('academic_year') or '—'}")

    c.setStrokeColor(RULE)
    c.setLineWidth(0.4)
    c.line(MARGIN, y - 40, PAGE_WIDTH - MARGIN, y - 40)
    return y - 53


def _draw_section_header(c: Canvas, title: str, y: float, sub: str | None = None) -> float:
    c.setFillColor(INK)
    c.setFont(_FONT_FAMILY_BOLD, 11)
    c.drawString(MARGIN, y, title.upper())
    c.setStrokeColor(INK)
    c.setLineWidth(0.7)
    c.line(MARGIN, y - 3, PAGE_WIDTH - MARGIN, y - 3)
    if sub:
        c.setFillColor(MUTED)
        c.setFont(_FONT_FAMILY_PRIMARY, 7)
        c.drawString(MARGIN, y - 13, sub)
        return y - 22
    return y - 14


def _kv_table(pairs: list[tuple[str, Any]]) -> Table:
    rows: list[list[Any]] = []
    buf: tuple[str, Any] | None = None
    for label, value in pairs:
        if buf is None:
            buf = (label, value)
        else:
            rows.append([buf[0], _v(buf[1]), label, _v(value)])
            buf = None
    if buf is not None:
        rows.append([buf[0], _v(buf[1]), "", ""])

    table = Table(rows, colWidths=[85, 175, 85, 175])
    table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), _FONT_FAMILY_SEMI),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("TEXTCOLOR", (0, 0), (0, -1), MUTED),
        ("TEXTCOLOR", (2, 0), (2, -1), MUTED),
        ("TEXTCOLOR", (1, 0), (1, -1), INK),
        ("TEXTCOLOR", (3, 0), (3, -1), INK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        # Compact vertical padding so all sections fit on a single A4 page.
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def _wide_row(label: str, value: Any) -> Table:
    table = Table([[label, _v(value)]], colWidths=[85, CONTENT_WIDTH - 85])
    table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), _FONT_FAMILY_SEMI),
        ("TEXTCOLOR", (0, 0), (0, -1), MUTED),
        ("TEXTCOLOR", (1, 0), (1, -1), INK),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def _academic_table(tenth: dict, twelfth: dict) -> Table:
    body = [
        [{"colSpan": 6, "content": "10th Standard"}, "", "", "", "", ""],
        ["Register No.", _v(tenth.get("register_number")),
         "Board", _v(tenth.get("board")),
         "Year", _v(tenth.get("year_of_passing"))],
        ["School", _v(tenth.get("school_name")),
         "Place", _v(tenth.get("school_place")),
         "Percentage", _v(tenth.get("percentage"))],
        [{"colSpan": 6, "content": "12th Standard / Diploma"}, "", "", "", "", ""],
        ["Register No.", _v(twelfth.get("register_number")),
         "Board", _v(twelfth.get("board")),
         "Year", _v(twelfth.get("year_of_passing"))],
        ["School", _v(twelfth.get("school_name")),
         "Place", _v(twelfth.get("school_place")),
         "Percentage", _v(twelfth.get("percentage"))],
    ]
    norm: list[list[Any]] = []
    for row in body:
        norm.append([cell.get("content") if isinstance(cell, dict) else cell for cell in row])

    # Column widths tuned so the "Percentage" label fits without wrapping
    # (was breaking as "Percenta\nge" on the previous 60pt label column).
    col_widths = [
        75,                 # 0: label – Register No. / School
        150,                # 1: value
        50,                 # 2: label – Board / Place
        100,                # 3: value
        75,                 # 4: label – Year / Percentage  ← fits "Percentage"
        CONTENT_WIDTH - 75 - 150 - 50 - 100 - 75,  # 5: value (rest)
    ]
    table = Table(norm, colWidths=col_widths)
    style = [
        ("SPAN", (0, 0), (-1, 0)),
        ("SPAN", (0, 3), (-1, 3)),
        ("BACKGROUND", (0, 0), (-1, 0), PINK_ACCENT),
        ("BACKGROUND", (0, 3), (-1, 3), PINK_ACCENT),
        ("FONTNAME", (0, 0), (-1, 0), _FONT_FAMILY_BOLD),
        ("FONTNAME", (0, 3), (-1, 3), _FONT_FAMILY_BOLD),
        ("FONTSIZE", (0, 0), (-1, 0), 9.5),
        ("FONTSIZE", (0, 3), (-1, 3), 9.5),
        ("TEXTCOLOR", (0, 0), (-1, 0), INK),
        ("TEXTCOLOR", (0, 3), (-1, 3), INK),
        ("LEFTPADDING", (0, 0), (-1, 0), 6),
        ("LEFTPADDING", (0, 3), (-1, 3), 6),
        ("TOPPADDING", (0, 0), (-1, 0), 4),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 4),
        ("TOPPADDING", (0, 3), (-1, 3), 4),
        ("BOTTOMPADDING", (0, 3), (-1, 3), 4),
        ("FONTNAME", (0, 1), (-1, 2), _FONT_FAMILY_SEMI),
        ("FONTNAME", (0, 4), (-1, 5), _FONT_FAMILY_SEMI),
        ("FONTSIZE", (0, 1), (-1, 2), 9.5),
        ("FONTSIZE", (0, 4), (-1, 5), 9.5),
        ("TEXTCOLOR", (0, 1), (0, 2), MUTED),
        ("TEXTCOLOR", (2, 1), (2, 2), MUTED),
        ("TEXTCOLOR", (4, 1), (4, 2), MUTED),
        ("TEXTCOLOR", (0, 4), (0, 5), MUTED),
        ("TEXTCOLOR", (2, 4), (2, 5), MUTED),
        ("TEXTCOLOR", (4, 4), (4, 5), MUTED),
        ("TEXTCOLOR", (1, 1), (1, 2), INK),
        ("TEXTCOLOR", (3, 1), (3, 2), INK),
        ("TEXTCOLOR", (5, 1), (5, 2), INK),
        ("TEXTCOLOR", (1, 4), (1, 5), INK),
        ("TEXTCOLOR", (3, 4), (3, 5), INK),
        ("TEXTCOLOR", (5, 4), (5, 5), INK),
        ("LINEBELOW", (0, 1), (-1, 1), 0.3, RULE),
        ("LINEBELOW", (0, 4), (-1, 4), 0.3, RULE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 1), (-1, -1), 6),
        ("RIGHTPADDING", (0, 1), (-1, -1), 6),
        ("TOPPADDING", (0, 1), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 5),
    ]
    table.setStyle(TableStyle(style))
    return table


def _draw_declaration_box(c: Canvas, college_name: str | None, y: float) -> None:
    """Draw the DECLARATION heading + black-bordered box containing:
        - declaration paragraph (with top padding inside the box)
        - "Place" stub
        - Applicant Signature lines + labels + subtitles
          (with bottom padding inside the box)
    """
    # 1) Heading — drawn ABOVE the box (outside)
    c.setFillColor(INK)
    c.setFont(_FONT_FAMILY_BOLD, 11)
    c.drawString(MARGIN, y, "DECLARATION")
    c.setStrokeColor(INK)
    c.setLineWidth(0.7)
    c.line(MARGIN, y - 3, PAGE_WIDTH - MARGIN, y - 3)

    # 2) Box geometry — top sits just below the heading underline; bottom
    # hovers comfortably above the footer strip.
    box_top = y - 8
    box_bottom = FOOTER_BAR_HEIGHT + 25
    box_left = MARGIN
    box_right = PAGE_WIDTH - MARGIN
    inner_pad_x = 12
    inner_top_pad = 14
    inner_bottom_pad = 20

    # Draw the outer border
    c.setStrokeColor(INK)
    c.setLineWidth(0.4)
    c.rect(box_left, box_bottom, box_right - box_left, box_top - box_bottom,
           stroke=1, fill=0)

    # 3) Declaration paragraph — starts BELOW the box top line (with padding)
    text = _render_declaration(college_name)
    inner_width_chars = 115  # Wraps within the box's inner width at 8.5pt
    para_y = box_top - inner_top_pad
    c.setFont(_FONT_FAMILY_LIGHT, 8.5)
    c.setFillColor(INK)
    lines = wrap(text, width=inner_width_chars)
    for ln in lines:
        c.drawString(box_left + inner_pad_x, para_y, ln)
        para_y -= 11

    # 4) Signature area — anchored from the BOTTOM of the box (with padding)
    #   Layout bottom-up inside the box:
    #     box_bottom + inner_bottom_pad → subtitle baseline (sig_y - 23)
    #   → sig_y = box_bottom + inner_bottom_pad + 23
    sig_y = box_bottom + inner_bottom_pad + 23 + 10  # extra 10pt for label
    panel_w = 200
    right_x = box_right - inner_pad_x - panel_w
    left_x = box_left + inner_pad_x

    # 5) Place stubs — label + thin filled-in line.
    place_y = box_bottom + inner_bottom_pad + 23 + 10   # place label baseline
    c.setFont(_FONT_FAMILY_SEMI, 8)
    c.setFillColor(MUTED)
    c.drawString(left_x, place_y, "Place")
    c.setStrokeColor(RULE)
    c.setLineWidth(0.4)
    c.line(left_x + 30, place_y - 2, left_x + 200, place_y - 2)

    # 6) Signature lines + labels + subtitles
    c.setStrokeColor(INK)
    c.setLineWidth(0.6)
    c.line(right_x, sig_y, right_x + panel_w, sig_y)

    c.setFillColor(INK)
    c.setFont(_FONT_FAMILY_BOLD, 9)
    c.drawString(right_x, sig_y - 13, "Applicant Signature")
    c.setFont(_FONT_FAMILY_PRIMARY, 7)
    c.setFillColor(MUTED)
    c.drawString(right_x, sig_y - 23, "I have read and agreed to the declaration above.")


def _draw_footer(c: Canvas) -> None:
    """Decorative bottom strip + contact info.

    The strip mirrors the header band visually — black at the left,
    transitioning to red at the right, with the contact line printed
    centred above it.
    """
    # Contact line — sits above the strip
    contact_y = FOOTER_BAR_HEIGHT + 15
    c.setFillColor(INK)
    c.setFont(_FONT_FAMILY_BOLD, 7)
    c.drawCentredString(
        PAGE_WIDTH / 2, contact_y,
        "More Information: +91 88846 27275  |  info@kmfoundation.co.in  |  www.kmfoundation.co.in",
    )
    c.setFillColor(MUTED)
    c.setFont(_FONT_FAMILY_PRIMARY, 6.5)
    c.drawCentredString(
        PAGE_WIDTH / 2, contact_y - 10,
        f"Generated {datetime.now().strftime('%d/%m/%Y, %H:%M:%S')}.  FinFlow by KM Foundation",
    )

    # Decorative strip — black→red, mirrors the header
    _draw_gradient_strip(c, FOOTER_BAR_HEIGHT, FOOTER_BAR_HEIGHT, reverse=True)


def render_application_pdf(student: dict) -> bytes:
    """Generate the admission application PDF (single-page A4)."""
    app = student.get("application")
    if not app:
        raise ValueError("Student has no application data attached")

    ref_code = (student.get("id") or "")[:8].upper() or "—"
    submitted_at = student.get("application_submitted_at") or ""

    buf = BytesIO()
    c = Canvas(buf, pagesize=A4)

    # ---- Header ----
    y = _draw_header(c, ref_code, submitted_at)

    # ---- Applicant banner ----
    bi = app.get("basic_info") or {}
    co = app.get("course") or {}
    y = _draw_applicant_banner(c, {
        "student_name": bi.get("student_full_name") or student.get("name") or "",
        "course": co.get("interested_course") or "",
        "college": co.get("preferred_college") or "",
        "admission_type": _label_of(ADMISSION_MAP, co.get("admission_type")),
        "academic_year": co.get("academic_year") or "",
    }, y)

    # ---- CANDIDATE DETAILS ----
    y = _draw_section_header(c, "Candidate Details", y, sub="*Your personal information")
    block = _kv_table([
        ("Mobile", bi.get("mobile_number")),
        ("Date of Birth", _fmt_date(bi.get("date_of_birth"))),
        ("Email", bi.get("email")),
        ("Gender", _label_of(GENDER_MAP, bi.get("gender"))),
        ("Nationality", bi.get("nationality") or "Indian"),
        ("Aadhaar", bi.get("aadhaar_number")),
        ("Caste", bi.get("caste")),
        ("Religion", bi.get("religion")),
    ])
    w, h = block.wrap(CONTENT_WIDTH, y)
    block.drawOn(c, MARGIN, y - h)
    y -= h + 16  # consistent breathable gap between sections

    # ---- PARENTS & ADDRESS ----
    cm = app.get("communication") or {}
    addr = ", ".join(filter(None, [cm.get("address_line_1"), cm.get("address_line_2")]))
    y = _draw_section_header(c, "Parents & Address", y)
    block = _kv_table([
        ("Father's Name", cm.get("father_name")),
        ("Mother's Name", cm.get("mother_name")),
        ("Father's Mobile", cm.get("father_mobile")),
        ("Mother's Mobile", cm.get("mother_mobile")),
    ])
    w, h = block.wrap(CONTENT_WIDTH, y)
    block.drawOn(c, MARGIN, y - h)
    y -= h + 2

    block = _wide_row("Address", addr or "—")
    w, h = block.wrap(CONTENT_WIDTH, y)
    block.drawOn(c, MARGIN, y - h)
    y -= h + 2

    block = _kv_table([
        ("City", cm.get("city")),
        ("Pincode", cm.get("pincode")),
        ("State", cm.get("state")),
        ("", ""),
    ])
    w, h = block.wrap(CONTENT_WIDTH, y)
    block.drawOn(c, MARGIN, y - h)
    y -= h + 16

    # ---- ACADEMIC QUALIFICATIONS ----
    ac = app.get("academic") or {}
    y = _draw_section_header(c, "Academic Qualifications", y)
    block = _academic_table(ac.get("tenth") or {}, ac.get("twelfth") or {})
    w, h = block.wrap(CONTENT_WIDTH, y)
    block.drawOn(c, MARGIN, y - h)
    y -= h + 16

    # ---- DECLARATION + SIGNATURE — wrapped in a single bordered box ----
    _draw_declaration_box(c, co.get("preferred_college"), y)

    # ---- Footer ----
    _draw_footer(c)

    c.showPage()
    c.save()
    return buf.getvalue()