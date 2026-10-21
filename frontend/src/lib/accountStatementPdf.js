// Per-account Credit & Debit statement PDF — used from the Accounts page.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatMoneyForPdf as formatMoney, formatDate } from "@/lib/format";

const TYPE_LABEL = { bank: "Bank", cash: "Cash", credit_card: "Credit Card" };

export function downloadAccountStatementPDF({ account, transactions, user, currency, fromDate, toDate }) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;

  const dateOnly = (d) => (d || "").slice(0, 10);
  const inRange = (d) => {
    const day = dateOnly(d);
    if (fromDate && day < fromDate) return false;
    if (toDate && day > toDate) return false;
    return true;
  };
  const periodLabel = fromDate || toDate
    ? `${fromDate ? formatDate(fromDate) : "Start"} → ${toDate ? formatDate(toDate) : "Today"}`
    : "All time";

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(28, 25, 23);
  doc.text("Account Statement", margin, 70);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 113, 108);
  doc.text(`${account.name} · ${TYPE_LABEL[account.type] || account.type}`, margin, 86);
  doc.text(`Period: ${periodLabel}`, margin, 99);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(28, 25, 23);
  doc.text(user?.business_name || user?.name || "EduConnect Pro", pageWidth - margin, 70, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 113, 108);
  doc.text(new Date().toLocaleString(), pageWidth - margin, 86, { align: "right" });

  // Oldest → newest for a correct running balance
  const sorted = [...(transactions || [])].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const opening = Number(account.opening_balance || 0);
  let running = opening;
  let openingForPeriod = opening; // balance carried into the selected period
  let totalCr = 0;
  let totalDr = 0;

  const body = [];
  sorted.forEach((t) => {
    const amt = Number(t.amount || 0);
    const isCredit = t.type === "income";
    if (!inRange(t.date)) {
      // Fold pre-period movement into the period's opening balance.
      if (dateOnly(t.date) < (fromDate || "")) {
        running += isCredit ? amt : -amt;
        openingForPeriod = running;
      }
      return;
    }
    if (isCredit) { running += amt; totalCr += amt; }
    else { running -= amt; totalDr += amt; }
    body.push([
      formatDate(t.date),
      t.description || "—",
      isCredit ? formatMoney(amt, currency) : "",
      isCredit ? "" : formatMoney(amt, currency),
      formatMoney(running, currency),
    ]);
  });

  const closing = running;

  // Summary strip
  let y = 118;
  doc.setDrawColor(231, 229, 228);
  doc.setFillColor(250, 250, 249);
  doc.roundedRect(margin, y, pageWidth - margin * 2, 54, 6, 6, "FD");
  const col = (pageWidth - margin * 2) / 4;
  const cell = (i, label, value, color) => {
    const x = margin + col * i + 14;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120, 113, 108);
    doc.text(label.toUpperCase(), x, y + 20);
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...(color || [28, 25, 23]));
    doc.text(value, x, y + 40);
  };
  cell(0, "Opening", formatMoney(openingForPeriod, currency));
  cell(1, "Credits", formatMoney(totalCr, currency), [21, 128, 61]);
  cell(2, "Debits", formatMoney(totalDr, currency), [190, 24, 38]);
  cell(3, "Closing", formatMoney(closing, currency));

  autoTable(doc, {
    startY: y + 70,
    head: [["Date", "Description", "Credit", "Debit", "Balance"]],
    body: body.length ? body : [["—", "No transactions in this period.", "", "", formatMoney(openingForPeriod, currency)]],
    styles: { font: "helvetica", fontSize: 9, cellPadding: 6, textColor: [41, 37, 36] },
    headStyles: { fillColor: [245, 158, 11], textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 70 },
      2: { halign: "right", textColor: [21, 128, 61] },
      3: { halign: "right", textColor: [190, 24, 38] },
      4: { halign: "right", fontStyle: "bold" },
    },
    alternateRowStyles: { fillColor: [250, 250, 249] },
    margin: { left: margin, right: margin },
  });

  const safe = (account.name || "account").replace(/[^a-z0-9]+/gi, "_");
  const suffix = fromDate || toDate ? `_${fromDate || "start"}_${toDate || "today"}` : "";
  doc.save(`statement_${safe}${suffix}.pdf`);
}
