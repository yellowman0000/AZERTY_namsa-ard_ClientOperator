'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useKioskHeartbeat } from '../lib/heartbeat';
import {
  CorruptedPayloadError,
  DuplicateTransactionError,
  EvidenceStorageUnavailableError,
  parseSignedReceipt,
  submitTransactionLog,
  type SignedReceipt,
  type TransactionPayload,
} from '../lib/api';
import { ConnectionDroppedError, connectionStatus } from '../lib/http';
import { listenForReconnection } from '../lib/networkListener';
import {
  removeOfflineEvidence,
  saveOfflineEvidence,
} from '../lib/offlineEvidence';
import ProofReceipt from './proof-receipt';
import { prepareEvidencePhoto } from '../lib/evidenceImage';
import {
  isAcceptableEvidence,
  receiptMatchesSubmission,
  validateDailySubmission,
  SUBMISSION_MESSAGES,
} from '../lib/submission';
import {
  PROCESSED_KEY,
  QUEUE_KEY,
  QUARANTINE_KEY,
  syncDispatcher,
} from '../lib/queue';
import { mockDataStore } from '../lib/mockData';
import {
  rowsOf,
  selectKioskStatus,
  selectNotice,
  selectQueuePayloads,
  selectReceipts,
} from '../lib/mockData/selectors';
import { useMockData } from '../lib/mockData/useMockData';

const kioskId = process.env.NEXT_PUBLIC_KIOSK_ID || 'KIOSK-001';
const configuredOperatorId = process.env.NEXT_PUBLIC_OPERATOR_ID || '';

type Notice = { kind: 'success' | 'warning' | 'error'; text: string };

function subscribeToQueue(onStoreChange: () => void) {
  const unsubscribe = syncDispatcher.subscribe(onStoreChange);
  const unsubscribeMock = mockDataStore.subscribe(onStoreChange);
  const onStorage = (event: StorageEvent) => {
    if ([QUEUE_KEY, QUARANTINE_KEY, PROCESSED_KEY].includes(event.key ?? '')) {
      onStoreChange();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    unsubscribe();
    unsubscribeMock();
    window.removeEventListener('storage', onStorage);
  };
}

function subscribeToNetwork(onStoreChange: () => void) {
  window.addEventListener('online', onStoreChange);
  window.addEventListener('offline', onStoreChange);
  return () => {
    window.removeEventListener('online', onStoreChange);
    window.removeEventListener('offline', onStoreChange);
  };
}

const getNetworkStatus = () => typeof navigator === 'undefined' || navigator.onLine;
const getPendingSnapshot = () => {
  const snapshot = mockDataStore.getSnapshot();
  if (snapshot.active) return JSON.stringify(selectQueuePayloads(rowsOf(snapshot, 'queue')));
  return JSON.stringify(syncDispatcher.getQueue());
};
const getQuarantineSnapshot = () => {
  const snapshot = mockDataStore.getSnapshot();
  if (snapshot.active) return rowsOf(snapshot, 'quarantine').length;
  return syncDispatcher.getQuarantineQueue().length;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTransactionPayload(value: unknown): value is TransactionPayload {
  if (!isRecord(value)) return false;
  const record = value;
  return (
    typeof record.transaction_id === 'string' &&
    typeof record.kiosk_id === 'string' &&
    typeof record.meter_volume === 'number' &&
    typeof record.recorded_at === 'string'
  );
}

export default function OperatorConsole() {
  const [volume, setVolume] = useState('');
  const [cash, setCash] = useState('');
  const [operatorId, setOperatorId] = useState(configuredOperatorId);
  const [evidencePhoto, setEvidencePhoto] = useState<File | null>(null);
  const [evidencePreview, setEvidencePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [receipts, setReceipts] = useState<SignedReceipt[]>([]);
  const flushing = useRef(false);
  const receiptWarning = useRef(false);
  const evidenceInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!evidencePhoto) return;

    let cancelled = false;
    const reader = new FileReader();
    reader.onload = () => {
      if (!cancelled && typeof reader.result === 'string') {
        setEvidencePreview(reader.result);
      }
    };
    reader.onerror = () => {
      if (!cancelled) {
        console.error('[Operator] Could not preview the selected evidence photo:', reader.error);
        setNotice({ kind: 'error', text: 'Could not preview the selected photo. Please choose it again.' });
      }
    };
    reader.readAsDataURL(evidencePhoto);

    return () => {
      cancelled = true;
      reader.abort();
    };
  }, [evidencePhoto]);

  const isOnline = useSyncExternalStore(subscribeToNetwork, getNetworkStatus, () => true);
  const connection = useSyncExternalStore(
    connectionStatus.subscribe,
    connectionStatus.get,
    () => 'connected' as const
  );
  const pendingSnapshot = useSyncExternalStore(subscribeToQueue, getPendingSnapshot, () => '[]');
  const pendingRecords = JSON.parse(pendingSnapshot) as TransactionPayload[];
  const pendingCount = pendingRecords.length;
  const quarantineCount = useSyncExternalStore(
    subscribeToQueue,
    getQuarantineSnapshot,
    () => 0
  );
  const mock = useMockData();
  const mockActive = mock.active;

  const flushPending = useCallback(async () => {
    if (flushing.current || syncDispatcher.getQueue().length === 0) return;
    flushing.current = true;
    receiptWarning.current = false;
    try {
      const result = await syncDispatcher.processQueue();
      if (result.processed > 0) {
        setNotice(
          result.failureReason
            ? {
                kind: 'warning',
                text: `${result.processed} entries synced, but ${result.failed} remain queued. ${result.failureReason}`,
              }
            : receiptWarning.current
            ? {
                kind: 'warning',
                text: 'Some submissions synced without a matching proof receipt. Check the entries below and contact a supervisor if a receipt is missing.',
              }
            : {
                kind: 'success',
                text: `${result.processed} saved ${result.processed === 1 ? 'entry' : 'entries'} synchronized. Proof receipts are shown below.`,
              }
        );
      } else if (result.quarantined > 0) {
        setNotice({
          kind: 'warning',
          text: `${result.quarantined} invalid ${result.quarantined === 1 ? 'entry was' : 'entries were'} isolated for review.`,
        });
      } else if (result.paused) {
        setNotice({
          kind: 'warning',
          text: 'Automatic sync is paused after repeated failures. Pending entries remain safely stored.',
        });
      } else if (result.failureReason) {
        setNotice({
          kind: 'warning',
          text: `${result.failed} ${result.failed === 1 ? 'entry remains' : 'entries remain'} safely queued. ${result.failureReason}`,
        });
      }
    } catch (error) {
      console.error('[Operator] Queue synchronization failed:', error);
      setNotice({
        kind: 'error',
        text: 'Could not synchronize the saved entries. They remain in the local queue.',
      });
    } finally {
      flushing.current = false;
    }
  }, []);

  useEffect(() => {
    return listenForReconnection({
      kioskId,
      serverUrl: '/api/kiosk/heartbeat',
      onReconnect: () => {
        // Reconnection is the right moment to retry: the circuit breaker may
        // still be open from failures that happened while offline.
        if (syncDispatcher.getStatus() === 'paused') {
          syncDispatcher.resume('Network reconnected');
        }
        void flushPending();
      },
    });
  }, [flushPending]);

  const { lastPingTime, pingStatus } = useKioskHeartbeat({
    kioskId,
    intervalMs: 10000,
    onHeartbeat: flushPending,
  });

  useEffect(() => {
    return syncDispatcher.subscribe((event) => {
      if (event.type !== 'item_success') return;

      const record = event.data.record;
      const ack = event.data.ack;
      if (!isTransactionPayload(record) || !isRecord(ack)) return;

      const receipt = parseSignedReceipt(ack.receipt);
      if (!receipt ||
        !receiptMatchesSubmission(receipt, record, record.evidence_pending === true)) {
        if (record.operator_id) {
          receiptWarning.current = true;
        }
        return;
      }

      setReceipts((current) =>
        current.some((existing) => existing.receiptId === receipt.receiptId)
          ? current
          : [...current, receipt]
      );
      setNotice({
        kind: 'success',
        text: `Offline submission ${record.transaction_id} synced. Its proof receipt is ready below.`,
      });
    });
  }, []);

  const queueEntry = async (
    record: TransactionPayload,
    reason: string,
    photo?: File | null
  ) => {
    const queuedRecord = photo ? { ...record, evidence_pending: true } : record;
    let evidenceSaved = false;
    try {
      if (photo) {
        await saveOfflineEvidence(record.transaction_id, photo);
        evidenceSaved = true;
      }

      const accepted = await syncDispatcher.enqueue(queuedRecord);
      const enqueued =
        accepted &&
        syncDispatcher
          .getQueue()
          .some((queued) => queued.transaction_id === record.transaction_id);
      if (accepted && !enqueued) {
        throw new Error('The offline transaction queue did not persist the entry.');
      }
      if (!enqueued && evidenceSaved) {
        await removeOfflineEvidence(record.transaction_id);
      }
      setNotice(
        enqueued
          ? { kind: 'warning', text: reason }
          : { kind: 'error', text: 'This transaction is already queued or has already been processed.' }
      );
      return enqueued;
    } catch (error) {
      if (evidenceSaved) {
        try {
          await removeOfflineEvidence(record.transaction_id);
        } catch (cleanupError) {
          console.error('[Operator] Could not clean up an unqueued evidence photo:', cleanupError);
        }
      }
      console.error('[Operator] Could not persist transaction locally:', error);
      setNotice({
        kind: 'error',
        text: 'Could not save this entry on this device. Keep the reading and try again.',
      });
      return false;
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const validation = validateDailySubmission({
      volume,
      cash,
      operatorId,
      evidencePhoto,
      kioskId,
      transactionId: crypto.randomUUID(),
      recordedAt: new Date().toISOString(),
    });
    if (!validation.ok) {
      setNotice({ kind: 'error', text: validation.error });
      return;
    }

    const record = validation.record;
    // Shrink large camera photos before they are queued or uploaded; a
    // multi-megabyte upload is slow enough to time out mid-sync.
    const photo = evidencePhoto ? await prepareEvidencePhoto(evidencePhoto) : null;

    if (!navigator.onLine || !isOnline || connection === 'dropped') {
      if (await queueEntry(
        record,
        'Offline entry saved on this device and will sync when the server returns.',
        photo
      )) {
        setVolume('');
        setCash('');
        setEvidencePhoto(null);
        setEvidencePreview(null);
        if (evidenceInput.current) evidenceInput.current.value = '';
      }
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitTransactionLog(record, {
        ...(photo ? { evidenceFile: photo, evidenceFileName: photo.name } : {}),
      });
      syncDispatcher.markProcessed(record.transaction_id);
      setVolume('');
      setCash('');
      setEvidencePhoto(null);
      setEvidencePreview(null);
      if (evidenceInput.current) evidenceInput.current.value = '';
      const responseReceipt = result.receipt;
      if (
        responseReceipt &&
        receiptMatchesSubmission(responseReceipt, record, Boolean(photo))
      ) {
        setReceipts((current) =>
          current.some((existing) => existing.receiptId === responseReceipt.receiptId)
            ? current
            : [...current, responseReceipt]
        );
        setNotice({ kind: 'success', text: 'Daily submission saved and proof receipt issued.' });
      } else {
        setNotice({
          kind: 'warning',
          text: 'The server saved this submission but did not return a matching proof receipt. Do not resubmit it; contact a supervisor.',
        });
      }
    } catch (error) {
      if (error instanceof DuplicateTransactionError) {
        setNotice({ kind: 'error', text: 'The server already has this transaction. No duplicate was saved.' });
      } else if (error instanceof CorruptedPayloadError) {
        syncDispatcher.quarantine(record, error.message);
        setNotice({ kind: 'error', text: `The server rejected this entry: ${error.message}` });
      } else {
        const message = error instanceof EvidenceStorageUnavailableError
          ? `Entry and photo saved on this device. Photo sync is waiting for server setup: ${error.message}`
          : error instanceof ConnectionDroppedError
            ? 'Connection was lost. Entry saved on this device for later sync.'
            : 'Server unavailable. Entry saved on this device for later sync.';
        if (await queueEntry(record, message, photo)) {
          setVolume('');
          setCash('');
          setEvidencePhoto(null);
          setEvidencePreview(null);
          if (evidenceInput.current) evidenceInput.current.value = '';
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Demo fixtures replace the live values while mock data is on; every branch
  // below falls back to the real value when it is off.
  const mockStatus = mockActive ? selectKioskStatus(rowsOf(mock, 'kioskStatus')[0]) : null;
  const mockNotice = mockActive ? selectNotice(rowsOf(mock, 'notice')[0]) : null;
  const shownReceipts = mockActive ? selectReceipts(rowsOf(mock, 'receipts')) : receipts;
  const shownNotice = mockActive ? mockNotice : notice;
  const shownKioskId = mockStatus?.kioskId ? mockStatus.kioskId : kioskId;
  const shownPingTime = mockStatus ? mockStatus.lastPingTime : lastPingTime;
  const isOnlineShown = mockStatus ? mockStatus.isOnline : isOnline;
  const connectionShown = mockStatus ? mockStatus.connection : connection;
  const pingStatusShown = mockStatus ? mockStatus.pingStatus : pingStatus;

  const status = !isOnlineShown
    ? 'offline'
    : connectionShown === 'dropped' || pingStatusShown === 'failed'
      ? 'offline'
      : connectionShown === 'retrying' || pingStatusShown === 'idle'
        ? 'checking'
        : 'online';
  const statusLabel =
    status === 'online' ? 'Online' : status === 'offline' ? 'Offline mode' : 'Checking connection';

  return (
    <main className="operator-shell">
      <header className="operator-topbar">
        <Link className="brand" href="/" aria-label="Nam Sa-ard operator console">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 48 48" role="presentation">
              <path d="M24 7C19 15 12 22 12 29a12 12 0 0 0 24 0C36 22 29 15 24 7Z" />
              <path className="brand-wave" d="M13 32c4-3 7 3 11 0s7 3 11 0" />
            </svg>
          </span>
          <span className="brand-name">namsa-ard</span>
          <span className="brand-subtitle">Operator console</span>
        </Link>
        <div className="topbar-actions">
          <Link className="nav-link" href="/manager">
            Historical logs
          </Link>
          <Link className="nav-link" href="/manager/operations-review">
            Operations review
          </Link>
          <Link className="nav-link" href="/manager/stakeholder-analytics">
            Stakeholder analytics
          </Link>
          <div className={`status-pill status-${status}`} aria-live="polite">
            <span className="status-dot" />
            {statusLabel}
          </div>
        </div>
      </header>

      <section className="operator-dashboard">
        <div className="operator-heading">
          <div>
            <p className="eyebrow">KIOSK OPERATIONS · {shownKioskId}</p>
            <h1>Daily cash &amp; liter submission</h1>
            <p className="heading-copy">Submit the operator’s daily meter volume and cash total. Entries are kept safely if the connection drops.</p>
          </div>
          <div className="server-heartbeat">
            <span className={`heartbeat-indicator indicator-${status}`} />
            <span>
              <strong>{statusLabel}</strong>
              <small>{shownPingTime ? `Heartbeat ${shownPingTime}` : 'Waiting for server heartbeat'}</small>
            </span>
          </div>
        </div>

        <div className="operator-grid">
          <section className="entry-card" aria-labelledby="entry-title">
            <div className="section-title">
              <span className="step-badge">01</span>
              <div>
                <p className="card-kicker">FIELD OPERATOR SUBMISSION</p>
                <h2 id="entry-title">Submit daily totals</h2>
              </div>
            </div>

            <form onSubmit={handleSubmit}>
              <label className="volume-label" htmlFor="volume">
                Meter reading
                <span>Liters (L)</span>
              </label>
              <div className="volume-input-wrap">
                <input
                  id="volume"
                  inputMode="decimal"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={volume}
                  onChange={(event) => setVolume(event.target.value)}
                  required
                />
                <span className="volume-unit">L</span>
              </div>
              <p className="field-hint">Enter the liters dispensed for this daily submission.</p>

              <div className="submission-fields">
                <label className="submission-field" htmlFor="operator-id">
                  Operator ID
                  <input
                    id="operator-id"
                    type="text"
                    autoComplete="off"
                    placeholder="OP-001"
                    pattern="OP-[0-9]{3}"
                    title="Operator ID format: OP-001"
                    autoCapitalize="characters"
                    spellCheck={false}
                    maxLength={8}
                    value={operatorId}
                    onChange={(event) =>
                      setOperatorId(event.target.value.toUpperCase())
                    }
                    required
                  />
                </label>
                <label className="submission-field" htmlFor="reported-cash">
                  Cash submitted
                  <span className="submission-input-wrap">
                    <input
                      id="reported-cash"
                      inputMode="decimal"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={cash}
                      onChange={(event) => setCash(event.target.value)}
                      required
                    />
                  </span>
                </label>
              </div>
              <div className="evidence-field">
                <span className="evidence-label">
                  <label htmlFor="evidence-photo">Reading evidence photo</label>
                  <span>Optional</span>
                </span>
                <input
                  ref={evidenceInput}
                  id="evidence-photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0] ?? null;
                    if (file && !isAcceptableEvidence(file)) {
                      event.currentTarget.value = '';
                      setEvidencePhoto(null);
                      setEvidencePreview(null);
                      setNotice({
                        kind: 'error',
                        text: SUBMISSION_MESSAGES.evidence,
                      });
                      return;
                    }
                    setEvidencePreview(null);
                    setEvidencePhoto(file);
                    if (file) setNotice(null);
                  }}
                  disabled={submitting}
                />
                <span className="field-hint">
                  Attach a JPEG, PNG, or WebP up to 5 MB. Offline photos stay on this device until sync.
                </span>
                {evidencePhoto && evidencePreview && (
                  <span className="evidence-preview">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={evidencePreview} alt="Selected reading evidence preview" />
                    <span>
                      <strong>{evidencePhoto.name}</strong>
                      <small>{(evidencePhoto.size / (1024 * 1024)).toFixed(2)} MB</small>
                    </span>
                    <button
                      type="button"
                      className="evidence-remove"
                      onClick={() => {
                        setEvidencePhoto(null);
                        setEvidencePreview(null);
                        if (evidenceInput.current) evidenceInput.current.value = '';
                      }}
                      disabled={submitting}
                      aria-label="Remove evidence photo"
                    >
                      Remove
                    </button>
                  </span>
                )}
              </div>
              <button className="submit-button" type="submit" disabled={submitting}>
                <span>{submitting ? 'Submitting daily totals…' : 'Submit daily totals'}</span>
                <span className="button-arrow" aria-hidden="true">→</span>
              </button>
            </form>

            {shownNotice && (
              <p className={`notice notice-${shownNotice.kind}`} role="status" aria-live="polite">
                {shownNotice.text}
              </p>
            )}
            <p className="integrity-note">
              The server returns a signed SHA-256 proof receipt after saving your submission.
            </p>
          </section>

          <aside className="queue-card" aria-labelledby="queue-title">
            <div className="queue-heading">
              <div>
                <p className="card-kicker">OFFLINE QUEUE</p>
                <h2 id="queue-title">Sync overview</h2>
              </div>
              <span className="queue-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M4 6h16M4 12h16M4 18h10" />
                  <circle cx="18" cy="18" r="3" />
                </svg>
              </span>
            </div>
            <div className="queue-stats">
              <div className="queue-stat">
                <strong>{pendingCount}</strong>
                <span>Waiting to sync</span>
              </div>
              <div className="queue-stat queue-stat-warning">
                <strong>{quarantineCount}</strong>
                <span>Isolated for review</span>
              </div>
            </div>
            <div className="queue-list-heading">
              <span>Pending entries</span>
              <span>FIFO order</span>
            </div>
            {pendingRecords.length > 0 ? (
              <ul className="pending-list">
                {pendingRecords.slice(0, 4).map((record) => (
                  <li key={record.transaction_id}>
                    <span className="record-mark" aria-hidden="true">L</span>
                    <span className="record-info">
                      <strong>{record.meter_volume.toLocaleString()} L</strong>
                      <small>{new Date(record.recorded_at).toLocaleString()}</small>
                    </span>
                    <span className="record-state">Pending</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-queue">
                <span className="empty-check" aria-hidden="true">✓</span>
                <strong>All caught up</strong>
                <span>New offline entries will appear here.</span>
              </div>
            )}
            {pendingCount > 0 && (
              <p className="sync-footnote">
                Saved locally in order. Automatic sync starts after the server confirms its heartbeat.
              </p>
            )}
          </aside>
        </div>
        {shownReceipts.map((item, index) => (
          <ProofReceipt
            key={item.receiptId}
            receipt={item}
            titleId={`receipt-title-${index}`}
          />
        ))}
      </section>
      <footer className="operator-footer">
        <span>Nam Sa-ard · Operator</span>
        <span>Print the proof receipt for your daily records</span>
      </footer>
    </main>
  );
}
