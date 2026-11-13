'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  acceptReceipt,
  fetchLogInspection,
  type AcceptReceiptResult,
  type ChecksumFormat,
  type LogInspection,
  type VerificationStatus,
} from '../../lib/logs';
import { formatAmount, formatDateTime, formatLiters } from './format';
import { mockDataStore } from '../../lib/mockData';
import { localStamp } from '../../lib/mockData/datasets';
import { buildMockInspection, readText, rowsOf } from '../../lib/mockData/selectors';
import { useMockData } from '../../lib/mockData/useMockData';

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

/** Acceptance + Google Sheets state of a receipt, as shown to the manager. */
export function ReceiptStatus({
  acceptedAt,
  isSynced,
}: {
  acceptedAt?: string | null;
  isSynced?: boolean | null;
}) {
  if (!acceptedAt) {
    return <span className="receipt-status receipt-status-pending">Awaiting review</span>;
  }
  return isSynced ? (
    <span className="receipt-status receipt-status-synced">Accepted · in Google Sheet</span>
  ) : (
    <span className="receipt-status receipt-status-accepted">Accepted · sheet pending</span>
  );
}

export function InspectionBody({ inspection }: { inspection: LogInspection }) {
  const { log, verification } = inspection;
  const badge = BADGES[verification.status];

  return (
    <>
      {log.acceptedAt !== undefined && (
        <p className="receipt-status-line">
          <ReceiptStatus acceptedAt={log.acceptedAt} isSynced={log.isSynced} />
          {log.acceptedAt && (
            <span>
              Accepted <Timestamp iso={log.acceptedAt} />
            </span>
          )}
        </p>
      )}
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
        {log.waterType && (
          <Field label="Water type">{log.waterType === 'SUBSIDIZED' ? 'Subsidized' : 'Commercial'}</Field>
        )}
        <Field label="Log ID" wide>
          <code>{log.id}</code>
        </Field>
      </dl>

      {log.proofImageUrl !== undefined && (
        <figure className="receipt-evidence">
          <figcaption>Evidence photo from the operator</figcaption>
          {log.proofImageUrl ? (
            <a href={log.proofImageUrl} target="_blank" rel="noreferrer">
              {/* External evidence host (ImgBB); next/image would need its domain configured. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={log.proofImageUrl} alt={`Evidence photo for receipt ${log.transactionId}`} />
            </a>
          ) : (
            <p>No photo was attached to this receipt.</p>
          )}
        </figure>
      )}

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

const SHEET_NOTICES: Record<
  AcceptReceiptResult['sheet']['status'],
  { tone: 'success' | 'warning'; text: string }
> = {
  SYNCED: { tone: 'success', text: 'Receipt accepted and added to the Google Sheet.' },
  ALREADY_SYNCED: { tone: 'success', text: 'This receipt was already accepted and is in the Google Sheet.' },
  PENDING: { tone: 'warning', text: 'Receipt accepted, but the Google Sheet did not take the row yet.' },
  DISABLED: { tone: 'warning', text: 'Receipt accepted, but Google Sheets is not set up on the server yet.' },
};

/**
 * Proof view of one stored log. The server recomputes the checksum on every
 * open and on "Verify again", so the badge reflects the record as it is stored
 * right now.
 *
 * Without `onAccepted` the modal is read-only (historical logs). With it, the
 * manager reviews the operator receipt and can Accept it, which adds the log
 * to the Google Sheet.
 */
export default function LogInspectionModal({
  logId,
  onClose,
  onAccepted,
}: {
  logId: string;
  onClose: () => void;
  onAccepted?: (result: AcceptReceiptResult) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [fetchedInspection, setFetchedInspection] = useState<LogInspection | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [acceptResult, setAcceptResult] = useState<AcceptReceiptResult | null>(null);
  const reviewMode = onAccepted !== undefined;
  const mock = useMockData();
  const mockActive = mock.active;

  // Demo fixtures are derived in render; the storage update in `accept` is what
  // makes the accepted state appear (it bumps the store revision).
  const fixtureInspection = mockActive
    ? buildMockInspection(logId, {
        reconciliation: rowsOf(mock, 'reconciliation'),
        logs: rowsOf(mock, 'logs'),
        inspection: rowsOf(mock, 'inspection'),
      })
    : null;
  const inspection = mockActive ? fixtureInspection : fetchedInspection;
  const error = mockActive
    ? fixtureInspection
      ? null
      : 'No mock record has this id. Add one in the mock data editor, then verify again.'
    : fetchError;
  const shownLoading = mockActive ? false : loading;

  const accept = async () => {
    setAccepting(true);
    setAcceptError(null);
    try {
      if (mockActive) {
        // Demo mode: stamp the fixture and report a sheet sync without a request.
        const snapshot = mockDataStore.getSnapshot();
        const rows = rowsOf(snapshot, 'reconciliation');
        const index = rows.findIndex(
          (row) => readText(row.id) === logId || readText(row.transactionId) === logId
        );
        const acceptedAt = new Date().toISOString();
        if (index >= 0) {
          mockDataStore.updateField('reconciliation', index, 'acceptedAt', localStamp(new Date()));
          mockDataStore.updateField('reconciliation', index, 'isSynced', true);
        }
        const result: AcceptReceiptResult = {
          logId,
          transactionId: inspection?.log.transactionId ?? logId,
          acceptedAt,
          acceptedBy: null,
          alreadyAccepted: false,
          sheet: { status: 'SYNCED' },
        };
        setAcceptResult(result);
        onAccepted?.(result);
        return;
      }

      const result = await acceptReceipt(logId);
      setAcceptResult(result);
      const inSheet = result.sheet.status === 'SYNCED' || result.sheet.status === 'ALREADY_SYNCED';
      setFetchedInspection((current) =>
        current ? { ...current, log: { ...current.log, acceptedAt: result.acceptedAt, isSynced: inSheet } } : current
      );
      onAccepted?.(result);
    } catch (err) {
      setAcceptError(err instanceof Error ? err.message : 'Could not accept this receipt.');
    } finally {
      setAccepting(false);
    }
  };

  const tampered = inspection?.verification.status === 'CHECKSUM_MISMATCH';
  const alreadyAccepted = Boolean(inspection?.log.acceptedAt);
  // Accepted, but the sheet has not taken the row (e.g. a header problem that
  // was fixed since): accepting again is safe and resends just this row.
  const canResend = reviewMode && alreadyAccepted && inspection?.log.isSynced === false;
  const sheetNotice = acceptResult ? SHEET_NOTICES[acceptResult.sheet.status] : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    // Starts in the loading state; "Verify again" resets it before bumping
    // `attempt`, so the effect itself never sets state synchronously.
    if (mockActive) return;

    const controller = new AbortController();
    fetchLogInspection(logId, controller.signal)
      .then(setFetchedInspection)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setFetchedInspection(null); // never leave an outdated badge on screen
        setFetchError(err instanceof Error ? err.message : 'Could not load this log.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [logId, attempt, mockActive]);

  // Closing goes through the native dialog so the browser returns focus to the
  // button that opened it; the `close` event then unmounts the modal.
  const close = () => dialogRef.current?.close();

  return (
    <dialog
      ref={dialogRef}
      className="inspect-dialog"
      aria-labelledby="inspect-title"
      aria-busy={shownLoading}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) close(); // backdrop click
      }}
    >
      <div className="inspect-panel">
        <header className="inspect-header">
          <div>
            <p className="card-kicker">{reviewMode ? 'OPERATOR RECEIPT · REVIEW' : 'READ-ONLY · HISTORICAL LOG'}</p>
            <h2 id="inspect-title">{reviewMode ? 'Review receipt' : 'Log inspection'}</h2>
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

        {sheetNotice && (
          <p className={`receipt-notice receipt-notice-${sheetNotice.tone}`} role="status">
            {sheetNotice.text}
            {acceptResult?.sheet.status === 'PENDING' && (
              <>
                {acceptResult.sheet.message && <> Reason: {acceptResult.sheet.message}</>}
                {acceptResult.sheet.retryable
                  ? ' The server retries automatically.'
                  : ' Fix the problem, then use Send to sheet again.'}
              </>
            )}
          </p>
        )}
        {acceptError && (
          <p className="receipt-notice receipt-notice-error" role="alert">
            Could not accept this receipt. {acceptError}
          </p>
        )}
        {reviewMode && tampered && !alreadyAccepted && (
          <p className="receipt-notice receipt-notice-error" role="alert">
            This receipt changed after submission, so it cannot be accepted.
          </p>
        )}

        <footer className="inspect-footer">
          <p>
            {reviewMode
              ? 'Accepting adds this receipt to the Google Sheet. The record itself is not changed.'
              : 'Read-only view. Records cannot be changed here.'}
          </p>
          <div className="inspect-actions">
            <button
              className="button button-secondary"
              type="button"
              disabled={shownLoading}
              onClick={() => {
                setLoading(true);
                setFetchError(null);
                setAttempt((n) => n + 1);
              }}
            >
              {shownLoading ? 'Verifying…' : error ? 'Try again' : 'Verify again'}
            </button>
            {reviewMode && !alreadyAccepted ? (
              <button
                className="button button-primary"
                type="button"
                disabled={shownLoading || accepting || !inspection || tampered}
                onClick={() => void accept()}
              >
                {accepting ? 'Accepting…' : 'Accept'}
              </button>
            ) : canResend ? (
              <button
                className="button button-primary"
                type="button"
                disabled={shownLoading || accepting}
                onClick={() => void accept()}
              >
                {accepting ? 'Sending…' : 'Send to sheet again'}
              </button>
            ) : (
              <button className="button button-primary" type="button" onClick={close}>
                Close
              </button>
            )}
          </div>
        </footer>
      </div>
    </dialog>
  );
}
