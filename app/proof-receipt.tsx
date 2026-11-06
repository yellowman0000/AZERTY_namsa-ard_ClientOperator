import type { SignedReceipt } from '../lib/api';

function formatTimestamp(value: string) {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleString();
}

function formatAmount(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function ProofReceipt({
  receipt,
  titleId = 'receipt-title',
}: {
  receipt: SignedReceipt;
  titleId?: string;
}) {
  return (
    <details className="proof-receipt">
      <summary className="receipt-summary">
        <span className="receipt-summary-copy">
          <p className="card-kicker">SERVER-ISSUED PROOF</p>
          <h2 id={titleId}>Daily submission receipt</h2>
          <span className="receipt-summary-id">Receipt {receipt.receiptId}</span>
        </span>
        <span className="receipt-summary-action">
          <span className="receipt-status">
            <span aria-hidden="true">✓</span>
            Signed
          </span>
          <span className="receipt-toggle-label">Details</span>
          <span className="receipt-chevron" aria-hidden="true" />
        </span>
      </summary>

      <div className="receipt-expanded">
        <dl className="receipt-details">
          <div>
            <dt>Receipt ID</dt>
            <dd>{receipt.receiptId}</dd>
          </div>
          <div>
            <dt>Timestamp</dt>
            <dd>{formatTimestamp(receipt.issuedAt)}</dd>
          </div>
          <div>
            <dt>Operator ID</dt>
            <dd>{receipt.operatorId}</dd>
          </div>
          <div>
            <dt>Liter volume</dt>
            <dd>{formatAmount(receipt.meterVolume)} L</dd>
          </div>
          <div>
            <dt>Cash submitted</dt>
            <dd>{formatAmount(receipt.reportedCash)}</dd>
          </div>
          <div>
            <dt>Recorded at</dt>
            <dd>{formatTimestamp(receipt.recordedAt)}</dd>
          </div>
          <div className="receipt-proof-field">
            <dt>SHA-256 checksum</dt>
            <dd><code>{receipt.checksum}</code></dd>
          </div>
          <div className="receipt-proof-field">
            <dt>Server signature (HMAC-SHA256)</dt>
            <dd><code>{receipt.signature}</code></dd>
          </div>
        </dl>

        {(receipt.proofImageUrl || receipt.evidencePath) && (
          <p className="receipt-evidence" role="note">
            Evidence photo:{' '}
            <a href={receipt.proofImageUrl || receipt.evidencePath} target="_blank" rel="noreferrer">
              View uploaded photo
            </a>
          </p>
        )}

        <div className="receipt-actions">
          <p>Keep this receipt with the daily cash and meter records.</p>
          <button className="receipt-print-button" type="button" onClick={() => window.print()}>
            Print / Save as PDF
          </button>
        </div>
      </div>
    </details>
  );
}
