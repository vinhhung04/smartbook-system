import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export function printLoanReceipt(loan: any) {
  const doc = new jsPDF({ unit: 'mm', format: 'a5' });
  const w = doc.internal.pageSize.getWidth();

  // Header
  doc.setFillColor(79, 70, 229);
  doc.rect(0, 0, w, 28, 'F');
  doc.setTextColor(255);
  doc.setFontSize(16);
  doc.text('SmartBook Library', w / 2, 12, { align: 'center' });
  doc.setFontSize(9);
  doc.text('LOAN RECEIPT', w / 2, 20, { align: 'center' });

  // Info
  doc.setTextColor(0);
  let y = 36;
  doc.setFontSize(9);
  const info = [
    ['Loan Number', loan.loan_number || loan.id?.slice(0, 8) || '-'],
    ['Customer', loan.customer_name || loan.customer?.full_name || '-'],
    ['Borrow Date', loan.borrow_date ? new Date(loan.borrow_date).toLocaleDateString('vi-VN') : '-'],
    ['Due Date', loan.due_date ? new Date(loan.due_date).toLocaleDateString('vi-VN') : '-'],
    ['Status', loan.status || '-'],
  ];
  info.forEach(([label, value]) => {
    doc.setTextColor(100);
    doc.text(label + ':', 10, y);
    doc.setTextColor(0);
    doc.text(String(value), 55, y);
    y += 6;
  });

  // Items table
  const items = loan.loan_items || [];
  if (items.length > 0) {
    y += 4;
    autoTable(doc, {
      startY: y,
      head: [['#', 'Book', 'Qty']],
      body: items.map((item: any, i: number) => [
        String(i + 1),
        item.book_title || item.variant_id?.slice(0, 12) || '-',
        String(item.quantity || 1),
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [79, 70, 229], textColor: 255, fontSize: 8 },
      margin: { left: 10, right: 10 },
    });
  }

  // Footer
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(7);
  doc.setTextColor(150);
  doc.text(`Printed: ${new Date().toLocaleString('vi-VN')}`, 10, pageH - 8);
  doc.text('SmartBook Library System', w - 10, pageH - 8, { align: 'right' });

  doc.save(`loan_${loan.loan_number || 'receipt'}.pdf`);
}

export function printReservationReceipt(reservation: any) {
  const doc = new jsPDF({ unit: 'mm', format: 'a5' });
  const w = doc.internal.pageSize.getWidth();

  doc.setFillColor(245, 158, 11);
  doc.rect(0, 0, w, 28, 'F');
  doc.setTextColor(255);
  doc.setFontSize(16);
  doc.text('SmartBook Library', w / 2, 12, { align: 'center' });
  doc.setFontSize(9);
  doc.text('RESERVATION RECEIPT', w / 2, 20, { align: 'center' });

  doc.setTextColor(0);
  let y = 36;
  doc.setFontSize(9);
  const info = [
    ['Reservation #', reservation.reservation_number || reservation.id?.slice(0, 8) || '-'],
    ['Customer', reservation.customer_name || reservation.customer?.full_name || '-'],
    ['Created', reservation.created_at ? new Date(reservation.created_at).toLocaleDateString('vi-VN') : '-'],
    ['Expires', reservation.expires_at ? new Date(reservation.expires_at).toLocaleDateString('vi-VN') : '-'],
    ['Status', reservation.status || '-'],
  ];
  info.forEach(([label, value]) => {
    doc.setTextColor(100);
    doc.text(label + ':', 10, y);
    doc.setTextColor(0);
    doc.text(String(value), 55, y);
    y += 6;
  });

  const items = reservation.reservation_items || [];
  if (items.length > 0) {
    y += 4;
    autoTable(doc, {
      startY: y,
      head: [['#', 'Book', 'Qty']],
      body: items.map((item: any, i: number) => [
        String(i + 1),
        item.book_title || item.variant_id?.slice(0, 12) || '-',
        String(item.quantity || 1),
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [245, 158, 11], textColor: 255, fontSize: 8 },
      margin: { left: 10, right: 10 },
    });
  }

  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(7);
  doc.setTextColor(150);
  doc.text(`Printed: ${new Date().toLocaleString('vi-VN')}`, 10, pageH - 8);
  doc.text('SmartBook Library System', w - 10, pageH - 8, { align: 'right' });

  doc.save(`reservation_${reservation.reservation_number || 'receipt'}.pdf`);
}
