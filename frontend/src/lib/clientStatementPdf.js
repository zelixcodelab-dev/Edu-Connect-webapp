// Per-client PDF exports — used from the Client Detail page.
// Staff → incentive payout report (Paid vs Pending breakdown)
// Sub Agent / Associate / KM Office → SC + Credit/Debit statement
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatMoneyForPdf as formatMoney, formatDate } from "@/lib/format";

const CLIENT_TYPE_LABEL = {
  staff: "Staff",
  sub_agent_associate: "Sub Agent / Associate",
  associate_consultant: "Associate Consultant",
  km_blr_office: "KM BLR Office",
  km_tcr_office: "KM TCR Office",
  km_kmly_office: "KM KMLY Office",
};

const STATUS_LABEL = {
  inquiry: "Inquiry",
  enrolled: "Enrolled",
  cancelled: "Cancelled",
  completed: "Completed",
};

function _drawHeader(doc, { title, eyebrow, client, user }) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(28, 25, 23);
  doc.text(title, margin, 70);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 113, 108);
  doc.text(eyebrow, margin, 86);

  // Right block: business name
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(28, 25, 23);
  doc.text(
    user?.business_name || user?.name || "KM Connet",
    pageWidth - margin,
    70,
    { align: "right" }
  );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 113, 108);
  doc.text(new Date().toLocaleString(), pageWidth - margin, 86, { align: "right" });

  // Client block
  let y = 130;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(120, 113, 108);
  doc.text("CLIENT", margin, y);

  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.setTextColor(28, 25, 23);
  doc.text(client?.name || "—", margin, y);

  y += 14;
  doc.setFontSize(9);
  doc.setTextColor(120, 113, 108);
  const sub = [
    CLIENT_TYPE_LABEL[client?.client_type] || "",
    client?.office ? client.office.replace("KM_", "KM ") : "",
    client?.company,
  ].filter(Boolean).join(" · ");
  if (sub) doc.text(sub, margin, y);

  if (client?.email) { y += 12; doc.text(client.email, margin, y); }
  if (client?.phone) { y += 12; doc.text(client.phone, margin, y); }

  return y + 28; // next free Y
}

function _drawFooter(doc) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(168, 162, 158);
  doc.text("Edu Connect", 48, pageHeight - 24);
  doc.text("Generated " + new Date().toLocaleString(), pageWidth - 48, pageHeight - 24, { align: "right" });
}

export function downloadClientStatementPDF({ detail, user }) {
  const currency = user?.currency || "USD";
  const isStaff = !!detail.is_staff;
  const c = detail.client;
  const t = detail.totals;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;

  let y = _drawHeader(doc, {
    title: isStaff ? "Incentive Payout Statement" : "Client Statement",
    eyebrow: isStaff ? "Staff admissions & incentive earnings" : "SC, credits & debits routed to this client",
    client: c,
    user,
  });

  // ---- Summary tiles row ----
  const tiles = isStaff
    ? [
        ["Students admitted", String(t.students_count)],
        ["Incentive earned", formatMoney(t.incentive_earned, currency)],
        ["Incentive paid", formatMoney(t.incentive_paid, currency)],
        ["Incentive pending", formatMoney(t.incentive_pending, currency)],
      ]
    : [
        ["Students admitted", String(t.students_count)],
        ["SC earned", formatMoney(t.sc_earned, currency)],
        ["Total credits", formatMoney(t.total_income, currency)],
        ["Total debits", formatMoney(t.total_expense, currency)],
      ];

  const tileW = (pageWidth - margin * 2 - 12 * (tiles.length - 1)) / tiles.length;
  tiles.forEach((tile, i) => {
    const x = margin + i * (tileW + 12);
    doc.setDrawColor(231, 229, 228);
    doc.setFillColor(252, 251, 250);
    doc.roundedRect(x, y, tileW, 56, 6, 6, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120, 113, 108);
    doc.text(tile[0].toUpperCase(), x + 12, y + 18);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(28, 25, 23);
    doc.text(tile[1], x + 12, y + 40);
  });
  y += 56 + 24;

  // ---- Students admitted table ----
  if (detail.students?.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(120, 113, 108);
    doc.text("ADMISSIONS", margin, y);
    y += 8;

    const head = isStaff
      ? [["Student", "Course", "College", "Status", "Enrolled", "Incentive"]]
      : [["Student", "Course", "College", "Status", "Enrolled", "SC earned"]];

    const body = detail.students.map((st) => {
      if (isStaff) {
        const incCell = !st.incentive_eligible
          ? "—"
          : `${formatMoney(st.incentive_amount, currency)} ${st.incentive_paid ? "✓ Paid" : "Pending"}`;
        return [
          st.name || "—",
          st.course || "—",
          st.college || "—",
          STATUS_LABEL[st.status] || st.status,
          st.enrollment_date ? formatDate(st.enrollment_date) : "—",
          incCell,
        ];
      }
      return [
        st.name || "—",
        st.course || "—",
        st.college || "—",
        STATUS_LABEL[st.status] || st.status,
        st.enrollment_date ? formatDate(st.enrollment_date) : "—",
        formatMoney(st.sc_out_fixed, currency),
      ];
    });

    const totalCol = isStaff
      ? formatMoney(t.incentive_earned, currency)
      : formatMoney(t.sc_earned, currency);

    autoTable(doc, {
      startY: y,
      head,
      body,
      foot: [[
        { content: "Total", colSpan: 5, styles: { halign: "right", fontStyle: "bold", textColor: [120, 113, 108] } },
        { content: totalCol, styles: { halign: "right", fontStyle: "bold", textColor: [28, 25, 23] } },
      ]],
      theme: "plain",
      styles: { fontSize: 9, textColor: [28, 25, 23], cellPadding: 6 },
      headStyles: { fillColor: [245, 245, 244], textColor: [120, 113, 108], fontStyle: "bold", fontSize: 8 },
      footStyles: { fillColor: [255, 251, 235] },
      columnStyles: {
        0: { cellWidth: 100 },
        1: { cellWidth: 80 },
        2: { cellWidth: "auto" },
        3: { cellWidth: 60 },
        4: { cellWidth: 70 },
        5: { halign: "right", cellWidth: 95 },
      },
      margin: { left: margin, right: margin },
    });

    y = doc.lastAutoTable.finalY + 20;
  }

  // ---- Credit/Debit transactions (non-staff only) ----
  if (!isStaff && detail.transactions?.length) {
    if (y > 700) { doc.addPage(); y = 60; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(120, 113, 108);
    doc.text("MONEY TRAIL", margin, y);
    y += 8;

    autoTable(doc, {
      startY: y,
      head: [["Date", "Description", "Type", "Amount"]],
      body: detail.transactions.map((tx) => [
        formatDate(tx.date),
        tx.description || "—",
        tx.type === "income" ? "Credit" : "Debit",
        `${tx.type === "income" ? "+" : "-"} ${formatMoney(tx.amount, currency)}`,
      ]),
      foot: [[
        { content: "Net", colSpan: 3, styles: { halign: "right", fontStyle: "bold", textColor: [120, 113, 108] } },
        { content: formatMoney(t.net, currency), styles: { halign: "right", fontStyle: "bold", textColor: [28, 25, 23] } },
      ]],
      theme: "plain",
      styles: { fontSize: 9, textColor: [28, 25, 23], cellPadding: 6 },
      headStyles: { fillColor: [245, 245, 244], textColor: [120, 113, 108], fontStyle: "bold", fontSize: 8 },
      footStyles: { fillColor: [255, 251, 235] },
      columnStyles: {
        0: { cellWidth: 80 },
        1: { cellWidth: "auto" },
        2: { cellWidth: 60 },
        3: { halign: "right", cellWidth: 100 },
      },
      margin: { left: margin, right: margin },
    });
  }

  _drawFooter(doc);

  const safeName = (c.name || "client").replace(/[^a-z0-9_\- ]/gi, "_");
  const kind = isStaff ? "Incentive" : "Statement";
  doc.save(`${safeName} - ${kind} - ${new Date().toISOString().slice(0,10)}.pdf`);
}
