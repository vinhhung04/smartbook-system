import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface ExportColumn {
  header: string;
  key: string;
  width?: number;
}

export function exportToExcel(
  data: Record<string, unknown>[],
  columns: ExportColumn[],
  filename: string,
) {
  const rows = data.map((row) =>
    columns.reduce<Record<string, unknown>>((acc, col) => {
      acc[col.header] = row[col.key] ?? '';
      return acc;
    }, {}),
  );

  const ws = XLSX.utils.json_to_sheet(rows);

  const colWidths = columns.map((col) => ({
    wch: Math.max(col.header.length, col.width ?? 15),
  }));
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export function exportToPdf(
  data: Record<string, unknown>[],
  columns: ExportColumn[],
  title: string,
  filename: string,
) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFontSize(16);
  doc.text(title, 14, 18);

  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Exported: ${new Date().toLocaleString('vi-VN')}`, 14, 25);
  doc.setTextColor(0);

  const head = [columns.map((c) => c.header)];
  const body = data.map((row) => columns.map((c) => String(row[c.key] ?? '')));

  autoTable(doc, {
    startY: 30,
    head,
    body,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  });

  doc.save(`${filename}.pdf`);
}

export interface SummaryReportData {
  title: string;
  dateRange: string;
  kpis: { label: string; value: string | number }[];
  sections: {
    title: string;
    columns: ExportColumn[];
    data: Record<string, unknown>[];
  }[];
}

export function exportSummaryReport(report: SummaryReportData) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFillColor(79, 70, 229);
  doc.rect(0, 0, pageW, 35, 'F');
  doc.setTextColor(255);
  doc.setFontSize(18);
  doc.text(report.title, 14, 18);
  doc.setFontSize(9);
  doc.text(`${report.dateRange} — Exported: ${new Date().toLocaleString('vi-VN')}`, 14, 27);
  doc.setTextColor(0);

  let y = 42;

  doc.setFontSize(11);
  doc.text('Key Metrics', 14, y);
  y += 6;

  const kpiCols = Math.min(report.kpis.length, 4);
  const kpiW = (pageW - 28) / kpiCols;
  report.kpis.forEach((kpi, i) => {
    const col = i % kpiCols;
    const row = Math.floor(i / kpiCols);
    const x = 14 + col * kpiW;
    const ky = y + row * 16;

    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, ky, kpiW - 3, 14, 2, 2, 'F');
    doc.setFontSize(7);
    doc.setTextColor(100);
    doc.text(kpi.label, x + 3, ky + 5);
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text(String(kpi.value), x + 3, ky + 11);
  });

  y += Math.ceil(report.kpis.length / kpiCols) * 16 + 8;

  for (const section of report.sections) {
    if (y > 250) {
      doc.addPage();
      y = 15;
    }

    doc.setFontSize(11);
    doc.setTextColor(79, 70, 229);
    doc.text(section.title, 14, y);
    doc.setTextColor(0);
    y += 3;

    const head = [section.columns.map(c => c.header)];
    const body = section.data.slice(0, 20).map(row => section.columns.map(c => String(row[c.key] ?? '')));

    autoTable(doc, {
      startY: y,
      head,
      body,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold', fontSize: 7 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14 },
    });

    y = (doc as any).lastAutoTable?.finalY + 8 || y + 40;
  }

  doc.setFontSize(7);
  doc.setTextColor(150);
  doc.text('SmartBook Library System — Auto-generated report', 14, doc.internal.pageSize.getHeight() - 8);

  doc.save(`${report.title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
