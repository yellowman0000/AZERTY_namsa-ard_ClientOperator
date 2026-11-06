'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  fetchLogInspection,
  type ChecksumFormat,
  type LogInspection,
  type VerificationStatus,
} from '../../lib/logs';
import { formatAmount, formatDateTime, formatLiters } from './format';

const BADGES: Record<VerificationStatus, { tone: string; icon: string; label: string; detail: string }> = {
  VERIFIED: {
    tone: 'verified',
    icon: '✓',
    label: 'Verified (Tamper-Evident)',
    detail: 'The stored record matches the checksum saved when it was submitted. No changes detected.',
  },
  CHECKSUM_MISMATCH: {
    tone: 'mismatch',
    icon: '✕',
    label: 'Checksum Mismatch',
    detail:
      'The stored record no longer matches the checksum saved when it was submitted. It may have been changed after submission.',
  },
  NO_CHECKSUM: {
    tone: 'unverified',
    icon: '?',
    label: 'No checksum on record',
    detail: 'This log was submitted without a checksum, so it cannot be verified.',
  },
};

const FORMAT_LABELS: Record<ChecksumFormat, string> = {
  v1: 'v1 payload',
  legacy: 'legacy payload',
  receipt: 'receipt',
};

function Timestamp({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={iso}>
      {formatDateTime(iso)}
    </time>
  );
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'inspect-field-wide' : undefined}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function InspectionBody({ inspection }: { inspection: LogInspection }) {
  const { log, verification } = inspection;
  const badge = BADGES[verification.status];

  return (
    <>
      <div className={`verify-panel verify-${badge.tone}`}>
        <p className="verify-badge" role="status">
          <span className="verify-icon" aria-hidden="true">
            {badge.icon}
          </span>
          {badge.label}
        </p>
        <p className="verify-detail">{badge.detail}</p>
      </div>

      <dl className="inspect-details">
        <Field label="Transaction ID">{log.transactionId}</Field>
        <Field label="Kiosk ID">{log.kioskId}</Field>
        <Field label="Recorded at">
          <Timestamp iso={log.recordedAt} />
        </Field>
        <Field label="Received by server">
          <Timestamp iso={log.createdAt} />
        </Field>
        <Field label="Meter volume">{formatLiters(log.meterVolume)}</Field>
        {log.operatorId !== null && <Field label="Operator ID">{log.operatorId}</Field>}
        {log.reportedCash !== null && <Field label="Reported cash">{formatAmount(log.reportedCash)}</Field>}
        {log.expectedRevenue !== null && (
          <Field label="Expected revenue">{formatAmount(log.expectedRevenue)}</Field>
        )}
        {log.variance !== null && <Field label="Variance">{formatAmount(log.variance)}</Field>}
        {log.isAnomaly !== null && <Field label="Volume anomaly">{log.isAnomaly ? 'Flagged' : 'None'}</Field>}
        <Field label="Log ID" wide>
          <code>{log.id}</code>
        </Field>
      </dl>

      {verification.status !== 'NO_CHECKSUM' && (
        <dl className="inspect-proof" aria-label="Checksum proof">
          <Field
            label={`Stored at submission (${verification.algorithm}${
              verification.format ? ` · ${FORMAT_LABELS[verification.format]}` : ''
            })`}
          >
            <code>{verification.storedChecksum}</code>
          </Field>
          <Field label="Recomputed from current record">
            <code>{verification.recomputedChecksum}</code>
          </Field>
        </dl>
      )}
      <p className="inspect-checked-at">
        Checked by the server at <Timestamp iso={verification.verifiedAt} />
      </p>
    </>
  );
}

/**
 * Read-only proof view of one stored log. The server recomputes the checksum
 * on every open and on "Verify again", so the badge reflects the record as it
 * is stored right now.
 */
export default function LogInspectionModal({ logId, onClose }: { logId: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [inspection, setInspection] = useState<LogInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    // Starts in the loading state; "Verify again" resets it before bumping
    // `attempt`, so the effect itself never sets state synchronously.
    const controller = new AbortController();
    fetchLogInspection(logId, controller.signal)
      .then(setInspection)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setInspection(null); // never leave an outdated badge on screen
        setError(err instanceof Error ? err.message : 'Could not load this log.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [logId, attempt]);

  // Closing goes through the native dialog so the browser returns focus to the
  // button that opened it; the `close` event then unmounts the modal.
  const close = () => dialogRef.current?.close();

  return (
    <dialog
      ref={dialogRef}
      className="inspect-dialog"
      aria-labelledby="inspect-title"
      aria-busy={loading}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) close(); // backdrop click
      }}
    >
      <div className="inspect-panel">
        <header className="inspect-header">
          <div>
            <p className="card-kicker">READ-ONLY · HISTORICAL LOG</p>
            <h2 id="inspect-title">Log inspection</h2>
          </div>
          <button className="inspect-close" type="button" aria-label="Close" onClick={close}>
            ×
          </button>
        </header>

        {error ? (
          <div className="inspect-message inspect-message-error" role="alert">
            <p>{error}</p>
          </div>
        ) : inspection ? (
          <InspectionBody inspection={inspection} />
        ) : (
          <div className="inspect-message" role="status">
            <p>Verifying checksum…</p>
          </div>
        )}

        <footer className="inspect-footer">
          <p>Read-only view. Records cannot be changed here.</p>
          <div className="inspect-actions">
            <button
              className="button button-secondary"
              type="button"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                setError(null);
                setAttempt((n) => n + 1);
              }}
            >
              {loading ? 'Verifying…' : error ? 'Try again' : 'Verify again'}
            </button>
            <button className="button button-primary" type="button" onClick={close}>
              Close
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
