import React, { useState } from 'react';
import { generatePDF, generateBulkPDF } from '../services/pdfExportService';
import type { TransactionHistoryItem } from './TransactionHistory';

interface PDFExportProps {
  transactions: TransactionHistoryItem[];
}

export function PDFExport({ transactions }: PDFExportProps): React.ReactElement {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const handleExportSingle = (tx: TransactionHistoryItem) => {
    try {
      generatePDF(tx);
    } catch (error) {
      console.error('Failed to generate PDF', error);
    }
  };

  const handleExportBulk = () => {
    try {
      const dateRange = dateFrom && dateTo
        ? { from: new Date(dateFrom), to: new Date(dateTo) }
        : undefined;

      generateBulkPDF(
        dateRange
          ? transactions.filter(
            tx => new Date(tx.timestamp) >= dateRange.from && new Date(tx.timestamp) <= dateRange.to
          )
          : transactions,
        dateRange
      );
    } catch (error) {
      console.error('Failed to generate bulk PDF', error);
    }
  };

  return (
    <div className="pdf-export">
      <div className="pdf-export-controls">
        <label>
          From:
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="Export date range start"
          />
        </label>
        <label>
          To:
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="Export date range end"
          />
        </label>
        <button
          onClick={handleExportBulk}
          aria-label={`Export ${transactions.length} transactions to PDF`}
          disabled={transactions.length === 0}
        >
          Export PDF
        </button>
      </div>

      <div className="pdf-export-list">
        {transactions.map((tx) => (
          <div key={tx.id} className="pdf-export-item">
            <span>{tx.id}</span>
            <button
              onClick={() => handleExportSingle(tx)}
              aria-label={`Export transaction ${tx.id} to PDF`}
            >
              Download Receipt
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
