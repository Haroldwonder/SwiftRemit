import jsPDF from 'jspdf';
import type { TransactionHistoryItem } from '../components/TransactionHistory';

export function generatePDF(transaction: TransactionHistoryItem): void {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  let yPos = margin;

  // Header
  doc.setFontSize(20);
  doc.text('Transaction Receipt', margin, yPos);
  yPos += 15;

  // Transaction Details
  doc.setFontSize(12);
  const details = [
    ['Transaction ID', transaction.id],
    ['Amount', `${transaction.amount} ${transaction.asset}`],
    ['Recipient', transaction.recipient],
    ['Status', transaction.status],
    ['Timestamp', new Date(transaction.timestamp).toLocaleString()],
  ];

  if (transaction.memo) {
    details.push(['Memo', transaction.memo]);
  }

  details.forEach(([label, value]) => {
    doc.text(`${label}:`, margin, yPos);
    doc.text(String(value), pageWidth - margin - 60, yPos, { align: 'right' });
    yPos += 8;
  });

  // Additional details
  if (transaction.details) {
    yPos += 10;
    doc.setFontSize(11);
    doc.text('Additional Details', margin, yPos);
    yPos += 8;

    Object.entries(transaction.details).forEach(([key, value]) => {
      doc.setFontSize(10);
      doc.text(`${key}:`, margin + 5, yPos);
      doc.text(String(value), pageWidth - margin - 60, yPos, { align: 'right' });
      yPos += 7;

      if (yPos > pageHeight - margin) {
        doc.addPage();
        yPos = margin;
      }
    });
  }

  // Footer
  doc.setFontSize(8);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, pageHeight - 10);

  doc.save(`receipt-${transaction.id}.pdf`);
}

export function generateBulkPDF(
  transactions: TransactionHistoryItem[],
  dateRange?: { from: Date; to: Date }
): void {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  let yPos = margin;

  // Header
  doc.setFontSize(20);
  doc.text('Transaction Export', margin, yPos);
  yPos += 12;

  if (dateRange) {
    doc.setFontSize(10);
    doc.text(
      `Period: ${dateRange.from.toLocaleDateString()} to ${dateRange.to.toLocaleDateString()}`,
      margin,
      yPos
    );
    yPos += 8;
  }

  // Table header
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  const headers = ['ID', 'Amount', 'Asset', 'Status', 'Timestamp'];
  const colWidths = [40, 25, 20, 30, 40];
  let xPos = margin;

  headers.forEach((header, i) => {
    doc.text(header, xPos, yPos);
    xPos += colWidths[i];
  });

  yPos += 10;
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);

  // Table rows
  transactions.forEach((tx) => {
    xPos = margin;
    const cols = [
      tx.id.substring(0, 8) + '...',
      tx.amount.toString(),
      tx.asset,
      tx.status,
      new Date(tx.timestamp).toLocaleDateString(),
    ];

    cols.forEach((col, i) => {
      doc.text(col, xPos, yPos);
      xPos += colWidths[i];
    });

    yPos += 8;

    if (yPos > pageHeight - 20) {
      doc.addPage();
      yPos = margin;
    }
  });

  // Footer
  doc.setFontSize(8);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, pageHeight - 10);

  const filename = dateRange
    ? `export-${dateRange.from.toISOString().split('T')[0]}-to-${dateRange.to.toISOString().split('T')[0]}.pdf`
    : `export-${new Date().toISOString().split('T')[0]}.pdf`;

  doc.save(filename);
}
