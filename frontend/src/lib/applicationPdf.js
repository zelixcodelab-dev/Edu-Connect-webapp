// Per-student admission application PDF.
//
// Mirrors /app/backend/lib/application_pdf.py exactly:
//   - Tall red→black gradient strip at the very top edge
//   - AdmissionForm wordmark TOP-LEFT (Admission = black, Form = red)
//   - KM logo TOP-RIGHT
//   - Ref / Submitted right-aligned, below the logo
//   - Thin red rule separator
//   - Body sections with consistent breathable spacing
//   - Pink (#FFE7F3) sub-headers in academic table
//   - Declaration paragraph 8pt
//   - Signature blocks + contact line + bottom gradient strip (mirror of header)
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate } from "@/lib/format";
import { renderDeclaration } from "@/lib/applicationSchema";

const LABELS = {
  gender: { male: "Male", female: "Female", other: "Other" },
  admission_type: {
    management: "MANAGEMENT", government: "GOVERNMENT",
    merit: "MERIT", lateral_entry: "LATERAL ENTRY", other: "OTHER",
  },
};

const MARGIN = 36;
const HEADER_BAR_HEIGHT = 36;
const HEADER_BLOCK_HEIGHT = 80;
const FOOTER_BAR_HEIGHT = 30;

const BRAND_RED = [199, 0, 0];
const BRAND_BLACK = [16, 16, 16];
const PINK = [255, 231, 243];
const INK = [0, 0, 0];
const MUTED = [90, 90, 90];
const RULE = [212, 212, 212];

// ---- Font registry (Montserrat) ----
const FONT_FILES = [
  { name: "Montserrat", style: "normal", file: "Montserrat-Regular.ttf" },
  { name: "Montserrat", style: "bold", file: "Montserrat-Bold.ttf" },
  { name: "MontserratSemi", style: "normal", file: "Montserrat-SemiBold.ttf" },
  { name: "MontserratLight", style: "normal", file: "Montserrat-Light.ttf" },
];

async function loadFontDataUrl(file) {
  try {
    const res = await fetch(`/fonts/${file}`, { cache: "force-cache" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const chunkSize = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  } catch (err) {
    console.warn(`[applicationPdf] font load failed (${file}):`, err?.message || err);
    return null;
  }
}

let FONTS_BASE64 = null;
async function ensureFonts(doc) {
  if (!FONTS_BASE64) {
    const entries = await Promise.all(FONT_FILES.map(async (f) => ({
      ...f, b64: await loadFontDataUrl(f.file),
    })));
    FONTS_BASE64 = entries.filter((e) => e.b64);
  }
  if (!FONTS_BASE64.length) {
    return { primary: "helvetica", bold: "helvetica", semi: "helvetica", light: "helvetica" };
  }
  for (const f of FONTS_BASE64) {
    doc.addFileToVFS(f.file, f.b64);
    doc.addFont(f.file, f.name, f.style);
  }
  return { primary: "Montserrat", bold: "Montserrat", semi: "MontserratSemi", light: "MontserratLight" };
}

// ---- Helpers ----
function v(value) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}
function labelOf(map, value) {
  if (!value) return "—";
  return map[value] || value;
}

async function loadImageDataUrl(filename) {
  try {
    const res = await fetch(`/${filename}`, { cache: "force-cache" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn(`[applicationPdf] image load failed (${filename}):`, err?.message || err);
    return null;
  }
}

function drawGradientStrip(doc, topY, height, reverse = false) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const steps = 240;
  const stripeW = pageWidth / steps;
  for (let i = 0; i < steps; i += 1) {
    let t = i / (steps - 1);
    if (reverse) t = 1 - t;
    const r = Math.round(BRAND_RED[0] + (BRAND_BLACK[0] - BRAND_RED[0]) * t);
    const g = Math.round(BRAND_RED[1] + (BRAND_BLACK[1] - BRAND_RED[1]) * t);
    const b = Math.round(BRAND_RED[2] + (BRAND_BLACK[2] - BRAND_RED[2]) * t);
    doc.setFillColor(r, g, b);
    doc.rect(i * stripeW, topY, stripeW + 0.6, height, "F");
  }
}

// Pre-composed PDF header banner image dimensions.
// Source artwork is 4000×770px (aspect 5.195) — drawn full A4 width (595pt).
const HEADER_IMG_HEIGHT = 595 / 5.195; // ≈ 114.5pt
// Pixel-measured positions of the white "Ref:" / "Submitted:" labels
// (fractions of the banner image size).
const REF_LABEL_Y_FRAC = 0.1403;
const SUBMITTED_LABEL_Y_FRAC = 0.2494;
const LABEL_COLON_X_FRAC = 0.8645;

function drawHeader(doc, fonts, opts) {
  const pageWidth = doc.internal.pageSize.getWidth();
  // 1) Draw the pre-composed banner spanning full width at the top edge
  if (opts.headerDataUrl) {
    try {
      doc.addImage(opts.headerDataUrl, "PNG", 0, 0, pageWidth, HEADER_IMG_HEIGHT);
    } catch (err) {
      console.warn("[applicationPdf] header image addImage failed", err);
    }
  }

  // 2) Overlay the dynamic Ref + Submitted values in white next to the
  //    labels printed inside the banner.
  const valueX = pageWidth * LABEL_COLON_X_FRAC + 6;
  const refY = HEADER_IMG_HEIGHT * REF_LABEL_Y_FRAC + 3;
  const subY = HEADER_IMG_HEIGHT * SUBMITTED_LABEL_Y_FRAC + 3;
  doc.setTextColor(255, 255, 255);
  doc.setFont(fonts.semi, "normal");
  doc.setFontSize(7.5);
  doc.text(opts.refCode, valueX, refY);
  doc.setFont(fonts.primary, "normal");
  doc.setFontSize(7);
  doc.text(opts.submittedAt, valueX, subY);

  // Body content begins 16pt below the banner — keeps everything on one page.
  return HEADER_IMG_HEIGHT + 16;
}

function drawApplicantBanner(doc, fonts, opts, y) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFont(fonts.bold, "bold");
  doc.setFontSize(20);
  doc.setTextColor(...INK);
  doc.text((opts.studentName || "—").toUpperCase(), MARGIN, y + 3);

  doc.setFont(fonts.semi, "normal");
  doc.setFontSize(10);
  doc.text((opts.course || "—").toUpperCase(), MARGIN, y + 18);

  doc.setFont(fonts.semi, "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text((opts.college || "—").toUpperCase(), MARGIN, y + 31);

  doc.setFont(fonts.semi, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...INK);
  doc.text(`Admission Type:  ${opts.admissionType || "—"}`,
    pageWidth - MARGIN, y + 6, { align: "right" });
  doc.text(`Academic Year:  ${opts.academicYear || "—"}`,
    pageWidth - MARGIN, y + 20, { align: "right" });

  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y + 40, pageWidth - MARGIN, y + 40);
  return y + 53;
}

function drawSectionHeader(doc, fonts, title, y, sub) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFont(fonts.bold, "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(title.toUpperCase(), MARGIN, y);
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.7);
  doc.line(MARGIN, y + 3, pageWidth - MARGIN, y + 3);
  if (sub) {
    doc.setFont(fonts.primary, "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(sub, MARGIN, y + 13);
    return y + 22;
  }
  return y + 14;
}

function drawKvBlock(doc, fonts, rows, startY) {
  const body = [];
  let buffer = null;
  for (const r of rows) {
    if (!buffer) {
      buffer = [r[0], v(r[1])];
    } else {
      body.push([buffer[0], buffer[1], r[0], v(r[1])]);
      buffer = null;
    }
  }
  if (buffer) body.push([buffer[0], buffer[1], "", ""]);

  autoTable(doc, {
    startY,
    body,
    theme: "plain",
    styles: {
      font: fonts.semi,
      fontStyle: "normal",
      fontSize: 9.5,
      textColor: INK,
      cellPadding: { top: 5, right: 6, bottom: 5, left: 0 },
      valign: "top",
    },
    columnStyles: {
      0: { textColor: MUTED, cellWidth: 85 },
      1: { textColor: INK, cellWidth: 175 },
      2: { textColor: MUTED, cellWidth: 85 },
      3: { textColor: INK, cellWidth: 175 },
    },
    margin: { left: MARGIN, right: MARGIN },
  });
  return doc.lastAutoTable.finalY;
}

function drawWideRow(doc, fonts, label, value, startY) {
  const pageWidth = doc.internal.pageSize.getWidth();
  autoTable(doc, {
    startY,
    body: [[label, v(value)]],
    theme: "plain",
    styles: {
      font: fonts.semi,
      fontStyle: "normal",
      fontSize: 9.5,
      textColor: INK,
      cellPadding: { top: 5, right: 6, bottom: 5, left: 0 },
      valign: "top",
    },
    columnStyles: {
      0: { textColor: MUTED, cellWidth: 85 },
      1: { textColor: INK, cellWidth: pageWidth - MARGIN * 2 - 85 },
    },
    margin: { left: MARGIN, right: MARGIN },
  });
  return doc.lastAutoTable.finalY;
}

function drawAcademicTable(doc, fonts, tenth, twelfth, startY) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentW = pageWidth - MARGIN * 2;
  // Column widths tuned so "Percentage" label fits on one line (was wrapping
  // as "Percenta\nge" on the previous 60pt column).
  const colWidths = [
    75,                   // 0: label – Register No. / School
    150,                  // 1: value
    50,                   // 2: label – Board / Place
    100,                  // 3: value
    75,                   // 4: label – Year / Percentage  ← fits "Percentage"
    contentW - 75 - 150 - 50 - 100 - 75,  // 5: value (rest)
  ];

  const body = [
    [{ content: "10th Standard", colSpan: 6, styles: { fillColor: PINK, fontStyle: "bold", textColor: INK, fontSize: 9.5, cellPadding: { top: 4, bottom: 4, left: 6, right: 6 } } }],
    [
      { content: "Register No.", styles: { textColor: MUTED } }, v(tenth.register_number),
      { content: "Board", styles: { textColor: MUTED } }, v(tenth.board),
      { content: "Year", styles: { textColor: MUTED } }, v(tenth.year_of_passing),
    ],
    [
      { content: "School", styles: { textColor: MUTED } }, v(tenth.school_name),
      { content: "Place", styles: { textColor: MUTED } }, v(tenth.school_place),
      { content: "Percentage", styles: { textColor: MUTED } }, v(tenth.percentage),
    ],
    [{ content: "12th Standard / Diploma", colSpan: 6, styles: { fillColor: PINK, fontStyle: "bold", textColor: INK, fontSize: 9.5, cellPadding: { top: 4, bottom: 4, left: 6, right: 6 } } }],
    [
      { content: "Register No.", styles: { textColor: MUTED } }, v(twelfth.register_number),
      { content: "Board", styles: { textColor: MUTED } }, v(twelfth.board),
      { content: "Year", styles: { textColor: MUTED } }, v(twelfth.year_of_passing),
    ],
    [
      { content: "School", styles: { textColor: MUTED } }, v(twelfth.school_name),
      { content: "Place", styles: { textColor: MUTED } }, v(twelfth.school_place),
      { content: "Percentage", styles: { textColor: MUTED } }, v(twelfth.percentage),
    ],
  ];

  autoTable(doc, {
    startY,
    body,
    theme: "plain",
    // Never split this table across pages — keeps the academic block intact.
    rowPageBreak: "avoid",
    pageBreak: "avoid",
    styles: {
      font: fonts.semi,
      fontStyle: "normal",
      fontSize: 9.5,
      textColor: INK,
      cellPadding: { top: 5, right: 6, bottom: 5, left: 6 },
      valign: "middle",
    },
    columnStyles: {
      0: { cellWidth: colWidths[0] }, 1: { cellWidth: colWidths[1] },
      2: { cellWidth: colWidths[2] }, 3: { cellWidth: colWidths[3] },
      4: { cellWidth: colWidths[4] }, 5: { cellWidth: colWidths[5] },
    },
    margin: { left: MARGIN, right: MARGIN },
  });
  return doc.lastAutoTable.finalY;
}

// Draws the DECLARATION heading + a black-bordered box that wraps:
//   - declaration paragraph (with top padding inside the box)
//   - "Date" stub (stacked ABOVE "Place")
//   - "Place" stub
//   - Applicant Signature / Admissions Officer signature lines + labels + subtitles
//     (with bottom padding inside the box)
function drawDeclarationBox(doc, fonts, collegeName, headingY) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // 1) Heading drawn ABOVE the box
  doc.setFont(fonts.bold, "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text("DECLARATION", MARGIN, headingY);
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.7);
  doc.line(MARGIN, headingY + 3, pageWidth - MARGIN, headingY + 3);

  // 2) Box geometry (jsPDF y-axis grows downward, so box_top < box_bottom)
  const boxTop = headingY + 8;
  const boxBottom = pageHeight - FOOTER_BAR_HEIGHT - 25;
  const boxLeft = MARGIN;
  const boxRight = pageWidth - MARGIN;
  const innerPadX = 12;
  const innerTopPad = 14;
  const innerBottomPad = 20;

  // Outer black border
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.4);
  doc.rect(boxLeft, boxTop, boxRight - boxLeft, boxBottom - boxTop, "S");

  // 3) Declaration paragraph — starts BELOW the box top line
  const text = renderDeclaration(collegeName).replace(/\n\n/g, " ");
  doc.setFont(fonts.light, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...INK);
  const wrapW = boxRight - boxLeft - innerPadX * 2;
  const lines = doc.splitTextToSize(text, wrapW);
  let paraY = boxTop + innerTopPad;
  for (const ln of lines) {
    doc.text(ln, boxLeft + innerPadX, paraY);
    paraY += 11;
  }

  // 4) Signature area — anchored from the BOTTOM of the box
  //   Layout (top→bottom inside the box, bottom-anchored):
  //     subtitle baseline = boxBottom - innerBottomPad
  //     label baseline    = subtitle - 10
  //     signature line    = label - 13 (=> sigY)
  //     Place row above (label + line)
  const sigY = boxBottom - innerBottomPad - 10 - 13;
  const panelW = 200;
  const leftX = boxLeft + innerPadX;
  const rightX = boxRight - innerPadX - panelW;

  // 5) Place stubs
  const placeY = boxBottom - innerBottomPad - 10 - 13;
  doc.setFont(fonts.semi, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("Place", leftX, placeY);
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.4);
  doc.line(leftX + 30, placeY + 2, leftX + 200, placeY + 2);

  // 6) Signature lines + labels + subtitles
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.6);
  doc.line(rightX, sigY, rightX + panelW, sigY);

  doc.setFont(fonts.bold, "bold");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text("Applicant Signature", rightX, sigY + 13);
  doc.setFont(fonts.primary, "normal");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text("I have read and agreed to the declaration above.", rightX, sigY + 23);
}

function drawFooter(doc, fonts) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  // Contact line above the strip
  const contactY = pageHeight - FOOTER_BAR_HEIGHT - 15;
  doc.setFont(fonts.bold, "bold");
  doc.setFontSize(7);
  doc.setTextColor(...INK);
  doc.text(
    "More Information: +91 88846 27275  |  info@kmfoundation.co.in  |  www.kmfoundation.co.in",
    pageWidth / 2, contactY, { align: "center" },
  );
  doc.setFont(fonts.primary, "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  const ts = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  doc.text(`Generated ${ts}.`,
    pageWidth / 2, contactY + 10, { align: "center" });

  // Decorative strip — black→red (mirrors header gradient)
  drawGradientStrip(doc, pageHeight - FOOTER_BAR_HEIGHT, FOOTER_BAR_HEIGHT, true);
}

export async function downloadApplicationPdf({ student }) {
  const app = student.application;
  if (!app) throw new Error("This student has no application data attached.");

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const [fonts, headerDataUrl] = await Promise.all([
    ensureFonts(doc),
    loadImageDataUrl("pdf-header.png"),
  ]);

  const bi = app.basic_info || {};
  const co = app.course || {};
  const cm = app.communication || {};
  const ac = app.academic || {};

  const submittedAt = student.application_submitted_at
    ? formatDate(student.application_submitted_at) : "—";
  const refCode = (student.id || "").slice(0, 8).toUpperCase() || "—";

  // ---- Header ----
  let y = drawHeader(doc, fonts, { headerDataUrl, refCode, submittedAt });

  // ---- Applicant banner ----
  y = drawApplicantBanner(doc, fonts, {
    studentName: bi.student_full_name || student.name,
    course: co.interested_course,
    college: co.preferred_college,
    admissionType: labelOf(LABELS.admission_type, co.admission_type),
    academicYear: co.academic_year,
  }, y);

  // ---- CANDIDATE DETAILS ----
  y = drawSectionHeader(doc, fonts, "Candidate Details", y, "*Your personal information");
  y = drawKvBlock(doc, fonts, [
    ["Mobile", bi.mobile_number],
    ["Date of Birth", bi.date_of_birth ? formatDate(bi.date_of_birth) : null],
    ["Email", bi.email],
    ["Gender", labelOf(LABELS.gender, bi.gender)],
    ["Nationality", bi.nationality || "Indian"],
    ["Aadhaar", bi.aadhaar_number],
    ["Caste", bi.caste],
    ["Religion", bi.religion],
  ], y);
  y += 16;

  // ---- PARENTS & ADDRESS ----
  const addrLine = [cm.address_line_1, cm.address_line_2].filter(Boolean).join(", ");
  y = drawSectionHeader(doc, fonts, "Parents & Address", y);
  y = drawKvBlock(doc, fonts, [
    ["Father's Name", cm.father_name],
    ["Mother's Name", cm.mother_name],
    ["Father's Mobile", cm.father_mobile],
    ["Mother's Mobile", cm.mother_mobile],
  ], y);
  y = drawWideRow(doc, fonts, "Address", addrLine || "—", y + 2);
  y = drawKvBlock(doc, fonts, [
    ["City", cm.city],
    ["Pincode", cm.pincode],
    ["State", cm.state],
    ["", ""],
  ], y + 2);
  y += 16;

  // ---- ACADEMIC QUALIFICATIONS ----
  y = drawSectionHeader(doc, fonts, "Academic Qualifications", y);
  y = drawAcademicTable(doc, fonts, ac.tenth || {}, ac.twelfth || {}, y);
  y += 16;

  // ---- DECLARATION + SIGNATURE — wrapped in a single bordered box ----
  drawDeclarationBox(doc, fonts, co.preferred_college, y);

  // ---- Footer ----
  drawFooter(doc, fonts);

  const safeName = (bi.student_full_name || student.name || "applicant").replace(/[^a-z0-9_\- ]/gi, "_");
  doc.save(`${safeName} - Application - ${new Date().toISOString().slice(0, 10)}.pdf`);
}