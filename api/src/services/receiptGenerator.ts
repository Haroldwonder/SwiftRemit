/**
 * Generates a PDF receipt for a completed remittance transaction (Issue #948).
 * Uses PDFKit for document generation.
 */

import PDFDocument from 'pdfkit';
import { Remittance } from '../db/remittanceStore';

const BRAND_COLOR = '#1a56db';
const LABEL_COLOR = '#6b7280';
const EXPLORER_BASE_URL =
  process.env.STELLAR_EXPLORER_URL ?? 'https://stellarchain.io/transactions';

function formatAmount(stroops: number): string {
  return (stroops / 10_000_000).toFixed(7);
}

/**
 * Generates a PDF receipt for the given remittance and resolves to a Buffer.
 */
export function generateReceiptPdf(remittance: Remittance): Promise<Buffer> {
  return new Promise((resolve, reject) => {
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ margin: 50, size: 'A4' });

  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);

  // ── Header ──────────────────────────────────────────────────────────────────
  doc
    .fontSize(22)
    .fillColor(BRAND_COLOR)
    .text('SwiftRemit', { align: 'left' })
    .fontSize(10)
    .fillColor(LABEL_COLOR)
    .text('Blockchain-Powered Remittances', { align: 'left' })
    .moveDown(0.5);

  doc
    .moveTo(50, doc.y)
    .lineTo(545, doc.y)
    .strokeColor(BRAND_COLOR)
    .lineWidth(1.5)
    .stroke()
    .moveDown(0.8);

  doc
    .fontSize(16)
    .fillColor('#111827')
    .text('Transfer Receipt', { align: 'center' })
    .moveDown(1);

  // ── Transaction details table ────────────────────────────────────────────────
  const rows: [string, string][] = [
    ['Transaction ID', remittance.id],
    ['Status', remittance.status],
    ['Sender', remittance.sender_id],
    ['Agent / Recipient', remittance.agent_id],
    ['Amount (USDC)', formatAmount(remittance.amount)],
    ['Fee (USDC)', formatAmount(remittance.fee)],
    ['Net Amount (USDC)', formatAmount(remittance.amount - remittance.fee)],
    ['Created', new Date(remittance.created_at).toUTCString()],
    ['Last Updated', new Date(remittance.updated_at).toUTCString()],
  ];

  const labelX = 50;
  const valueX = 220;
  const rowHeight = 22;

  rows.forEach(([label, value], idx) => {
    const y = doc.y;
    if (idx % 2 === 0) {
      doc.save().fillColor('#f9fafb').rect(labelX, y - 3, 495, rowHeight).fill().restore();
    }
    doc.fontSize(10).fillColor(LABEL_COLOR).text(label, labelX, y, { width: 160 });
    doc.fontSize(10).fillColor('#111827').text(value, valueX, y, { width: 325 });
    doc.moveDown(0.6);
  });

  doc.moveDown(1);

  // ── Explorer link ────────────────────────────────────────────────────────────
  doc
    .fontSize(9)
    .fillColor(LABEL_COLOR)
    .text('Verify on-chain:', labelX)
    .fillColor(BRAND_COLOR)
    .text(`${EXPLORER_BASE_URL}/${remittance.id}`, labelX, doc.y - 12, {
      link: `${EXPLORER_BASE_URL}/${remittance.id}`,
      underline: true,
      width: 495,
    });

  doc.moveDown(2);

  // ── Footer ───────────────────────────────────────────────────────────────────
  doc
    .moveTo(50, doc.y)
    .lineTo(545, doc.y)
    .strokeColor('#e5e7eb')
    .lineWidth(1)
    .stroke()
    .moveDown(0.5);

  doc
    .fontSize(8)
    .fillColor(LABEL_COLOR)
    .text(
      `This receipt was generated on ${new Date().toUTCString()}. ` +
        'SwiftRemit is not responsible for exchange rate fluctuations after settlement.',
      { align: 'center', width: 495 },
    );

  doc.end();
  }); // end Promise
}
