import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { formatMoney, formatMoneyForPdf, formatDate } from "@/lib/format";

// PDF generator below uses the PDF-safe variant via the `fmtPdf` alias so the
// XLSX exporter can keep using the rich `formatMoney` (Excel renders ₹ natively).
const fmtPdf = formatMoneyForPdf;

const RECEIVED_LABELS = {
  college: "College Acc.",
  cash: "Cash",
  bank: "Bank Acc.",
  sub_agent: "Sub Agent Acc.",
  associate: "Associate Acc.",
  km: "KM Acc.",
};

const FEE_LABELS = {
  booking_admission: "Booking / Admission Fees",
  tution: "Tution Fees",
  other: "Other Fees",
};

const PAYMENT_MODE_LABELS = {
  cash: "Cash",
  bank_transfer: "Bank Transfer",
  upi: "UPI",
  cheque: "Cheque",
  card: "Card",
  other: "Other",
};

const SUB_AGENT_LABELS = {
  sub_agent: "Sub Agent",
  associate: "Associate",
  km: "KM",
};

const STATUS_LABELS = {
  inquiry: "Inquiry",
  enrolled: "Enrolled",
  cancelled: "Cancelled",
  completed: "Completed",
};

// ---------------- Individual student PDF ----------------
export function downloadStudentPdf({ student, user }) {
  const currency = user?.currency || "USD";
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(28, 25, 23);
  doc.text("STUDENT FEE STATEMENT", margin, 70);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(120, 113, 108);
  doc.text(student.name || "—", margin, 88);

  // Business block (right)
  doc.setFontSize(11);
  doc.setTextColor(28, 25, 23);
  doc.setFont("helvetica", "bold");
  doc.text(user?.business_name || user?.name || "Edu Connect", pageWidth - margin, 70, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 113, 108);
  if (user?.email) doc.text(user.email, pageWidth - margin, 86, { align: "right" });
  doc.text(`Generated ${formatDate(new Date().toISOString().slice(0, 10))}`, pageWidth - margin, 100, { align: "right" });

  // Status badge
  const statusColors = {
    inquiry: [231, 229, 228],
    enrolled: [187, 247, 208],
    cancelled: [254, 205, 211],
    completed: [186, 230, 253],
  };
  const sc = statusColors[student.status] || [231, 229, 228];
  doc.setFillColor(sc[0], sc[1], sc[2]);
  doc.roundedRect(pageWidth - margin - 80, 108, 80, 18, 3, 3, "F");
  doc.setTextColor(41, 37, 36);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text((STATUS_LABELS[student.status] || student.status || "—").toUpperCase(), pageWidth - margin - 40, 120, { align: "center" });

  // Profile block
  let y = 150;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(120, 113, 108);
  doc.text("PROFILE", margin, y);

  y += 14;
  const profileRows = [
    ["Course", student.course || "—"],
    ["College", student.college || "—"],
    ["Reference", student.reference || "—"],
    ["Enrollment Date", student.enrollment_date ? formatDate(student.enrollment_date) : "—"],
  ];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  for (const [label, value] of profileRows) {
    doc.setTextColor(120, 113, 108);
    doc.text(label, margin, y);
    doc.setTextColor(28, 25, 23);
    const lines = doc.splitTextToSize(String(value), pageWidth - margin * 2 - 140);
    doc.text(lines, margin + 140, y);
    y += 14 * Math.max(1, lines.length);
  }

  if (student.notes) {
    y += 4;
    doc.setTextColor(120, 113, 108);
    doc.text("Notes", margin, y);
    doc.setTextColor(28, 25, 23);
    const noteLines = doc.splitTextToSize(student.notes, pageWidth - margin * 2 - 140);
    doc.text(noteLines, margin + 140, y);
    y += 14 * Math.max(1, noteLines.length);
  }

  // Summary tiles
  y += 18;
  doc.setDrawColor(231, 229, 228);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 18;

  const tiles = [
    ["SC Earned", fmtPdf(student.sc_earned_effective ?? student.sc_out_fixed, currency)],
    ["Scheduled total", fmtPdf(Math.max(0, (student.scheduled_total || 0) - (student.collected_total || 0)), currency)],
    ["Collected", fmtPdf(student.collected_total, currency)],
    ["Balance vs SC Earned", fmtPdf(student.balance_vs_sc, currency)],
  ];
  const tileWidth = (pageWidth - margin * 2) / tiles.length;
  tiles.forEach(([label, value], i) => {
    const x = margin + tileWidth * i;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(120, 113, 108);
    doc.text(label.toUpperCase(), x, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(28, 25, 23);
    doc.text(value, x, y + 18);
  });
  y += 40;

  // Schedules table
  const schedules = student.schedules || [];
  if (schedules.length) {
    autoTable(doc, {
      startY: y,
      head: [["Schedule", "Amount", "Remarks", "Due"]],
      body: schedules.map((sc) => [
        sc.label || "—",
        fmtPdf(sc.amount, currency),
        sc.remarks || "—",
        sc.due_date ? formatDate(sc.due_date) : "—",
      ]),
      foot: [["Scheduled total", fmtPdf(student.scheduled_total, currency), "", ""]],
      theme: "plain",
      styles: { fontSize: 9, textColor: [28, 25, 23], cellPadding: 6 },
      headStyles: { fillColor: [245, 245, 244], textColor: [120, 113, 108], fontStyle: "bold", fontSize: 8 },
      footStyles: { fillColor: [250, 250, 249], textColor: [28, 25, 23], fontStyle: "bold" },
      columnStyles: { 1: { halign: "right", cellWidth: 90 } },
      margin: { left: margin, right: margin },
      didDrawPage: () => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(120, 113, 108);
        doc.text("PAYMENT SCHEDULE", margin, y - 6);
      },
    });
    y = doc.lastAutoTable.finalY + 24;
  }

  // Payments table
  const payments = student.payments || [];
  if (payments.length) {
    if (y > 700) { doc.addPage(); y = 70; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(120, 113, 108);
    doc.text("PAYMENTS RECEIVED", margin, y);
    y += 6;

    const body = payments.map((p) => {
      const sch = (student.schedules || []).find((x) => x.id === p.schedule_id);
      const received = p.received_in || {};
      const receivedLabel = `${RECEIVED_LABELS[received.type] || received.type || "—"}${received.name ? ` (${received.name})` : ""}`;
      return [
        formatDate(p.date),
        sch ? sch.label : "Unscheduled",
        FEE_LABELS[p.fee_type] || "Other Fees",
        receivedLabel,
        fmtPdf(p.amount, currency),
        p.remarks || "—",
      ];
    });

    autoTable(doc, {
      startY: y,
      head: [["Date", "Schedule", "Fee Type", "Received In", "Amount", "Remarks"]],
      body,
      foot: [["", "", "", "Total collected", fmtPdf(student.collected_total, currency), ""]],
      theme: "plain",
      styles: { fontSize: 9, textColor: [28, 25, 23], cellPadding: 6 },
      headStyles: { fillColor: [245, 245, 244], textColor: [120, 113, 108], fontStyle: "bold", fontSize: 8 },
      footStyles: { fillColor: [250, 250, 249], textColor: [28, 25, 23], fontStyle: "bold" },
      columnStyles: { 4: { halign: "right" } },
      margin: { left: margin, right: margin },
    });
    y = doc.lastAutoTable.finalY + 18;

    // Adjustments detail
    const withAdj = payments.filter((p) => p.has_adjustment && (p.adjustments || []).length);
    if (withAdj.length) {
      if (y > 720) { doc.addPage(); y = 70; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(120, 113, 108);
      doc.text("PAYMENT ADJUSTMENTS", margin, y);
      y += 6;

      const adjBody = [];
      withAdj.forEach((p) => {
        (p.adjustments || []).forEach((a) => {
          adjBody.push([
            formatDate(p.date),
            a.kind === "paid_to_college" ? "Paid to College" : "Payment adjusted towards SC",
            fmtPdf(a.amount, currency),
            formatDate(a.payment_date),
            PAYMENT_MODE_LABELS[a.payment_mode] || a.payment_mode || "—",
            a.kind === "sc_adjusted"
              ? `${SUB_AGENT_LABELS[a.sub_agent_type] || ""} ${a.sub_agent_name || ""}`.trim() || "—"
              : "—",
            a.remarks || "—",
          ]);
        });
      });

      autoTable(doc, {
        startY: y,
        head: [["Payment Date", "Kind", "Amount", "Adj. Date", "Mode", "Sub / KM / Assoc.", "Remarks"]],
        body: adjBody,
        theme: "plain",
        styles: { fontSize: 8.5, textColor: [28, 25, 23], cellPadding: 5 },
        headStyles: { fillColor: [245, 245, 244], textColor: [120, 113, 108], fontStyle: "bold", fontSize: 8 },
        columnStyles: { 2: { halign: "right" } },
        margin: { left: margin, right: margin },
      });
    }
  }

  // Footer on every page
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(168, 162, 158);
    doc.text("Generated with " + (user?.business_name || "Edu Connect"), margin, pageHeight - 28);
    doc.text(`Page ${i} / ${pageCount}`, pageWidth - margin, pageHeight - 28, { align: "right" });
  }

  const safeName = (student.name || "student").replace(/[^a-z0-9-_ ]/gi, "_");
  doc.save(`${safeName} - fee statement.pdf`);
}

// ---------------- Consolidated XLSX ----------------
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function downloadStudentsXlsx({ students, currency = "USD" }) {
  const wb = XLSX.utils.book_new();
  const symbol = currency === "INR" ? "₹" : "$";
  const currencyFmt = currency === "INR"
    ? '[$₹-en-IN]#,##0.00;[Red]-[$₹-en-IN]#,##0.00'
    : '[$$-en-US]#,##0.00;[Red]-[$$-en-US]#,##0.00';

  // Sheet 1: Summary
  const summaryRows = students.map((s) => ({
    "Student": s.name || "",
    "Course": s.course || "",
    "College": s.college || "",
    "Reference": s.reference || "",
    "Status": STATUS_LABELS[s.status] || s.status || "",
    "Enrollment Date": s.enrollment_date || "",
    "SC Earned": num(s.sc_out_fixed),
    "Scheduled Total": num(s.scheduled_total),
    "Collected": num(s.collected_total),
    "Balance vs SC Earned": num(s.balance_vs_sc),
    "Balance vs Scheduled": num(s.balance_vs_scheduled),
    "Notes": s.notes || "",
  }));

  // Aggregate totals row
  const totalsRow = {
    "Student": "TOTAL",
    "Course": "",
    "College": "",
    "Reference": "",
    "Status": "",
    "Enrollment Date": "",
    "SC Earned": summaryRows.reduce((a, r) => a + r["SC Earned"], 0),
    "Scheduled Total": summaryRows.reduce((a, r) => a + r["Scheduled Total"], 0),
    "Collected": summaryRows.reduce((a, r) => a + r["Collected"], 0),
    "Balance vs SC Earned": summaryRows.reduce((a, r) => a + r["Balance vs SC Earned"], 0),
    "Balance vs Scheduled": summaryRows.reduce((a, r) => a + r["Balance vs Scheduled"], 0),
    "Notes": "",
  };

  const summarySheet = XLSX.utils.json_to_sheet([...summaryRows, totalsRow]);
  applyCurrencyFormat(summarySheet, ["SC Earned", "Scheduled Total", "Collected", "Balance vs SC Earned", "Balance vs Scheduled"], summaryRows.length + 1, currencyFmt);
  summarySheet["!cols"] = [
    { wch: 24 }, { wch: 18 }, { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 14 },
    { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 20 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

  // Sheet 2: Schedules
  const scheduleRows = [];
  students.forEach((s) => {
    (s.schedules || []).forEach((sc) => {
      scheduleRows.push({
        "Student": s.name || "",
        "College": s.college || "",
        "Schedule": sc.label || "",
        "Amount": num(sc.amount),
        "Due Date": sc.due_date || "",
        "Remarks": sc.remarks || "",
      });
    });
  });
  const schedSheet = XLSX.utils.json_to_sheet(scheduleRows.length ? scheduleRows : [{ "Student": "(no schedules)", "College": "", "Schedule": "", "Amount": 0, "Due Date": "", "Remarks": "" }]);
  applyCurrencyFormat(schedSheet, ["Amount"], scheduleRows.length || 1, currencyFmt);
  schedSheet["!cols"] = [{ wch: 24 }, { wch: 22 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, schedSheet, "Schedules");

  // Sheet 3: Payments
  const paymentRows = [];
  students.forEach((s) => {
    (s.payments || []).forEach((p) => {
      const sch = (s.schedules || []).find((x) => x.id === p.schedule_id);
      const received = p.received_in || {};
      paymentRows.push({
        "Date": p.date || "",
        "Student": s.name || "",
        "College": s.college || "",
        "Schedule": sch ? sch.label : "Unscheduled",
        "Fee Type": FEE_LABELS[p.fee_type] || "Other Fees",
        "Received In": RECEIVED_LABELS[received.type] || received.type || "",
        "Received From": received.name || "",
        "Amount": num(p.amount),
        "Has Adjustment": p.has_adjustment ? "Yes" : "No",
        "Adj. Paid to College": (p.adjustments || []).filter(a => a.kind === "paid_to_college").reduce((a, b) => a + num(b.amount), 0),
        "Adj. SC Adjusted": (p.adjustments || []).filter(a => a.kind === "sc_adjusted").reduce((a, b) => a + num(b.amount), 0),
        "Remarks": p.remarks || "",
      });
    });
  });
  const paySheet = XLSX.utils.json_to_sheet(paymentRows.length ? paymentRows : [{ "Date": "", "Student": "(no payments)", "College": "", "Schedule": "", "Fee Type": "", "Received In": "", "Received From": "", "Amount": 0, "Has Adjustment": "", "Adj. Paid to College": 0, "Adj. SC Adjusted": 0, "Remarks": "" }]);
  applyCurrencyFormat(paySheet, ["Amount", "Adj. Paid to College", "Adj. SC Adjusted"], paymentRows.length || 1, currencyFmt);
  paySheet["!cols"] = [
    { wch: 12 }, { wch: 24 }, { wch: 22 }, { wch: 16 }, { wch: 24 }, { wch: 18 },
    { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 18 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, paySheet, "Payments");

  // Sheet 4: Adjustments
  const adjustmentRows = [];
  students.forEach((s) => {
    (s.payments || []).forEach((p) => {
      (p.adjustments || []).forEach((a) => {
        adjustmentRows.push({
          "Payment Date": p.date || "",
          "Student": s.name || "",
          "College": s.college || "",
          "Kind": a.kind === "paid_to_college" ? "Paid to College" : "Payment adjusted towards SC",
          "Amount": num(a.amount),
          "Adj. Date": a.payment_date || "",
          "Mode": PAYMENT_MODE_LABELS[a.payment_mode] || a.payment_mode || "",
          "Sub-agent Type": SUB_AGENT_LABELS[a.sub_agent_type] || "",
          "Sub-agent Name": a.sub_agent_name || "",
          "Remarks": a.remarks || "",
        });
      });
    });
  });
  if (adjustmentRows.length) {
    const adjSheet = XLSX.utils.json_to_sheet(adjustmentRows);
    applyCurrencyFormat(adjSheet, ["Amount"], adjustmentRows.length, currencyFmt);
    adjSheet["!cols"] = [
      { wch: 14 }, { wch: 24 }, { wch: 22 }, { wch: 18 }, { wch: 14 },
      { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 24 }, { wch: 30 },
    ];
    XLSX.utils.book_append_sheet(wb, adjSheet, "Adjustments");
  }

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Students - consolidated (${symbol}) ${stamp}.xlsx`);
}

function applyCurrencyFormat(sheet, headerNames, rowCount, fmt) {
  const ref = sheet["!ref"];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  // header row is range.s.r (usually 0); detect columns
  const targetCols = new Set();
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cellAddr = XLSX.utils.encode_cell({ r: range.s.r, c });
    const cell = sheet[cellAddr];
    if (cell && headerNames.includes(cell.v)) targetCols.add(c);
  }
  for (const c of targetCols) {
    for (let r = range.s.r + 1; r <= Math.min(range.e.r, range.s.r + rowCount); r++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (cell && typeof cell.v === "number") {
        cell.t = "n";
        cell.z = fmt;
      }
    }
  }
}
