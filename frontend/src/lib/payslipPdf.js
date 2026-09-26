// Monthly employee payslip PDF (client-side jsPDF) — laid out to match the
// Razorpay-style sample: company header, Net Pay band, employee details,
// Earnings (Gross A), Deductions (B), and Yearly Taxable Income (C).
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatMoneyForPdf as fmt } from "@/lib/format";
import api from "@/lib/api";

const OFFICE_LABEL = {
  KM_BLR: "KM Bangalore",
  KM_TCR: "KM Thrissur",
  KM_KMLY: "KM Kollam",
};

function monthLabel(month) {
  try {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  } catch {
    return month;
  }
}

function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

// Best-effort: fetch a (possibly auth-protected) logo URL into a data URI so
// jsPDF can embed it. Returns null on any failure so the header falls back to
// the company name as text.
async function loadLogoDataUri(url) {
  if (!url) return null;
  try {
    const isAbsolute = /^https?:\/\//i.test(url) || url.startsWith("data:");
    const res = isAbsolute
      ? await fetch(url).then((r) => r.blob())
      : (await api.get(url, { responseType: "blob" })).data;
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(res);
    });
  } catch {
    return null;
  }
}

// Build the payslip jsPDF doc from the /attendance/payslip response.
// `data` = { month, company, employee, payslip }.
export async function buildPayslipDoc(data, currency = "INR") {
  const { month, company = {}, employee = {}, payslip: row = {} } = data || {};
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  const CRIMSON = [190, 24, 60];
  const INK = [28, 25, 23];
  const MUTE = [120, 113, 108];

  // ---- Company header ----
  let y = margin;
  const logo = await loadLogoDataUri(company.logo_url);
  let textX = margin;
  if (logo) {
    try {
      doc.addImage(logo, "PNG", margin, y, 54, 54);
      textX = margin + 66;
    } catch { /* bad image → text only */ }
  }
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(company.legal_name || "Company", textX, y + 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTE);
  const addrLines = doc.splitTextToSize(company.address || "", pageWidth - textX - margin);
  doc.text(addrLines, textX, y + 32);
  y += Math.max(58, 32 + addrLines.length * 11 + 10);

  // Title band
  doc.setDrawColor(230, 230, 230);
  doc.setLineWidth(1);
  doc.line(margin, y, pageWidth - margin, y);
  y += 18;
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`Payslip for the month of ${monthLabel(month)}`, margin, y);
  y += 16;

  // ---- Net Pay summary band ----
  const gross = Number(row.monthly_salary || 0);
  const deductionsTotal = Number(row.deduction || 0);
  const held = !!row.salary_hold;
  const netPay = held ? 0 : Number(row.net_pay || 0);

  autoTable(doc, {
    startY: y,
    theme: "plain",
    body: [[
      { content: "Employee Net Pay", styles: { fontStyle: "bold", textColor: INK } },
      { content: held ? `${fmt(netPay, currency)}  (ON HOLD)` : fmt(netPay, currency),
        styles: { fontStyle: "bold", fontSize: 16, halign: "right", textColor: CRIMSON } },
    ], [
      { content: "Gross Pay (A) − Deductions (B)", styles: { textColor: MUTE, fontSize: 9 } },
      { content: `${fmt(gross, currency)} − ${fmt(deductionsTotal, currency)}`, styles: { halign: "right", textColor: MUTE, fontSize: 9 } },
    ]],
    styles: { cellPadding: 6 },
    margin: { left: margin, right: margin },
    tableWidth: pageWidth - margin * 2,
    didDrawCell: () => {},
    tableLineColor: [240, 240, 240],
    tableLineWidth: 1,
  });
  y = doc.lastAutoTable.finalY + 14;

  // ---- Employee details block ----
  const details = [
    ["Employee code", employee.employee_code || "—"],
    ["Name", employee.name || "—"],
    ["Designation", employee.designation || "—"],
    ["Department", employee.department || "—"],
    ["Date of joining", fmtDate(employee.date_of_joining) || "—"],
    ["Payable days", String(row.paid_days ?? "—")],
    ["Bank account no.", employee.bank_account_no || "—"],
    ["IFSC code", employee.ifsc_code || "—"],
    ["Paid sick leave", `${row.paid_sick_days ?? 0} / 2${(row.sick_leave_days ?? 0) > (row.paid_sick_days ?? 0) ? ` (${row.sick_leave_days} taken)` : ""}`],
    ["Paid casual leave", `${row.paid_casual_days ?? 0} / 1${(row.casual_leave_days ?? 0) > (row.paid_casual_days ?? 0) ? ` (${row.casual_leave_days} taken)` : ""}`],
    ["Regime opted", employee.tax_regime ? String(employee.tax_regime) : "—"],
    ["Leave balance", employee.leave_balance != null ? String(employee.leave_balance) : "—"],
  ];
  const detailBody = [];
  for (let i = 0; i < details.length; i += 2) {
    const a = details[i], b = details[i + 1] || ["", ""];
    detailBody.push([a[0], a[1], b[0], b[1]]);
  }
  autoTable(doc, {
    startY: y,
    theme: "grid",
    head: [[{ content: "Employee Summary", colSpan: 4, styles: { fontStyle: "bold", textColor: INK } }]],
    body: detailBody,
    styles: { fontSize: 9, cellPadding: 5, textColor: INK },
    headStyles: { fillColor: [246, 246, 247], textColor: INK },
    columnStyles: {
      0: { textColor: MUTE, cellWidth: 110 },
      1: { fontStyle: "bold", cellWidth: (pageWidth - margin * 2) / 2 - 110 },
      2: { textColor: MUTE, cellWidth: 110 },
      3: { fontStyle: "bold" },
    },
    margin: { left: margin, right: margin },
  });
  y = doc.lastAutoTable.finalY + 16;

  // ---- Earnings (Gross Pay A) ----
  const breakup = Array.isArray(row.salary_breakup) ? row.salary_breakup : [];
  autoTable(doc, {
    startY: y,
    theme: "grid",
    head: [["Earnings — Gross Pay (A)", "Monthly", "Total amount"]],
    body: breakup.map((b) => [b.label, fmt(b.amount, currency), fmt(b.amount, currency)]),
    foot: [["Gross Earnings (A)", "", fmt(gross, currency)]],
    styles: { fontSize: 9.5, cellPadding: 6, textColor: INK },
    headStyles: { fillColor: [246, 246, 247], textColor: INK, fontStyle: "bold" },
    footStyles: { fillColor: [246, 246, 247], textColor: INK, fontStyle: "bold" },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
    margin: { left: margin, right: margin },
  });
  y = doc.lastAutoTable.finalY + 14;

  // ---- Deductions (B) ----
  const dedRows = [];
  const unpaidLeave = Number(row.unpaid_leave_days || 0);
  const absentTotal = Number(row.absent_days || 0);
  if (Number(row.deduction || 0) > 0) {
    const note = unpaidLeave > 0
      ? `Loss of pay (${absentTotal} unpaid day${absentTotal === 1 ? "" : "s"}, incl. ${unpaidLeave} leave beyond allowance)`
      : `Loss of pay (${absentTotal} absent day${absentTotal === 1 ? "" : "s"})`;
    dedRows.push([note, fmt(row.deduction, currency)]);
  }
  if (held) {
    dedRows.push(["Salary on hold", fmt(Number(row.net_before_hold || 0), currency)]);
  }
  if (dedRows.length === 0) dedRows.push(["No deductions", fmt(0, currency)]);
  const dedTotal = held ? Number(row.net_before_hold || 0) + Number(row.deduction || 0) : Number(row.deduction || 0);
  autoTable(doc, {
    startY: y,
    theme: "grid",
    head: [["Deductions — (B)", "Amount"]],
    body: dedRows,
    foot: [["Total Deductions (B)", fmt(dedTotal, currency)]],
    styles: { fontSize: 9.5, cellPadding: 6, textColor: INK },
    headStyles: { fillColor: [246, 246, 247], textColor: INK, fontStyle: "bold" },
    footStyles: { fillColor: [246, 246, 247], textColor: INK, fontStyle: "bold" },
    columnStyles: { 1: { halign: "right" } },
    margin: { left: margin, right: margin },
  });
  y = doc.lastAutoTable.finalY + 10;

  // Net pay line
  autoTable(doc, {
    startY: y,
    theme: "plain",
    body: [[
      { content: "Net Pay = Gross Pay (A) − Deductions (B)", styles: { fontStyle: "bold", textColor: INK } },
      { content: fmt(netPay, currency), styles: { fontStyle: "bold", halign: "right", textColor: CRIMSON, fontSize: 13 } },
    ]],
    styles: { cellPadding: 6 },
    tableLineColor: CRIMSON,
    tableLineWidth: 1,
    margin: { left: margin, right: margin },
    tableWidth: pageWidth - margin * 2,
  });
  y = doc.lastAutoTable.finalY + 16;

  // ---- Yearly Taxable Income (C) — monthly × 12, no tax engine ----
  autoTable(doc, {
    startY: y,
    theme: "grid",
    head: [["Yearly Taxable Income (C)", "Gross (Annual)", "Exempted", "Taxable"]],
    body: breakup.map((b) => {
      const annual = Number(b.amount || 0) * 12;
      return [b.label, fmt(annual, currency), fmt(0, currency), fmt(annual, currency)];
    }),
    foot: [["Total", fmt(gross * 12, currency), fmt(0, currency), fmt(gross * 12, currency)]],
    styles: { fontSize: 9, cellPadding: 5, textColor: INK },
    headStyles: { fillColor: [246, 246, 247], textColor: INK, fontStyle: "bold" },
    footStyles: { fillColor: [246, 246, 247], textColor: INK, fontStyle: "bold" },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    margin: { left: margin, right: margin },
  });

  doc.setFontSize(8);
  doc.setTextColor(150, 143, 138);
  doc.text(
    "This is a computer generated payslip and does not require a signature.",
    pageWidth / 2,
    doc.internal.pageSize.getHeight() - 24,
    { align: "center" },
  );

  const safeName = (employee.name || "employee").replace(/[^\w]+/g, "-");
  const filename = `${safeName}-payslip-${month}.pdf`;
  return { doc, filename };
}

export async function downloadPayslipPdf(data, currency = "INR") {
  const { doc, filename } = await buildPayslipDoc(data, currency);
  doc.save(filename);
}

// Returns { base64, filename } for emailing (strips the data-uri prefix).
export async function payslipBase64(data, currency = "INR") {
  const { doc, filename } = await buildPayslipDoc(data, currency);
  const uri = doc.output("datauristring");
  const base64 = uri.includes(",") ? uri.split(",", 2)[1] : uri;
  return { base64, filename };
}
