'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useKioskHeartbeat } from '../lib/heartbeat';
import {
  CorruptedPayloadError,
  DuplicateTransactionError,
  submitTransactionLog,
  type TransactionPayload,
} from '../lib/api';
import { ConnectionDroppedError, connectionStatus } from '../lib/http';
import { listenForReconnection } from '../lib/networkListener';
import {
  PROCESSED_KEY,
  QUEUE_KEY,
  QUARANTINE_KEY,
  syncDispatcher,
} from '../lib/queue';

const kioskId = process.env.NEXT_PUBLIC_KIOSK_ID || 'KIOSK-001';

type Notice = { kind: 'success' | 'warning' | 'error'; text: string };

function subscribeToQueue(onStoreChange: () => void) {
  const unsubscribe = syncDispatcher.subscribe(onStoreChange);
  const onStorage = (event: StorageEvent) => {
    if ([QUEUE_KEY, QUARANTINE_KEY, PROCESSED_KEY].includes(event.key ?? '')) {
      onStoreChange();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    unsubscribe();
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
const getPendingSnapshot = () => JSON.stringify(syncDispatcher.getQueue());
const getQuarantineSnapshot = () => syncDispatcher.getQuarantineQueue().length;

export default function OperatorConsole() {
  const [volume, setVolume] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const flushing = useRef(false);

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

  const flushPending = useCallback(async () => {
    if (flushing.current || syncDispatcher.getQueue().length === 0) return;
    flushing.current = true;
    try {
      const result = await syncDispatcher.processQueue();
      if (result.processed > 0) {
        setNotice({
          kind: 'success',
          text: `${result.processed} saved ${result.processed === 1 ? 'entry' : 'entries'} synchronized with the server.`,
        });
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
      onReconnect: flushPending,
    });
  }, [flushPending]);

  const { lastPingTime, pingStatus } = useKioskHeartbeat({
    kioskId,
    intervalMs: 10000,
    onHeartbeat: flushPending,
  });

  const queueEntry = async (record: TransactionPayload, reason: string) => {
    try {
      const enqueued = await syncDispatcher.enqueue(record);
      setNotice(
        enqueued
          ? { kind: 'warning', text: reason }
          : { kind: 'error', text: 'This transaction is already queued or has already been processed.' }
      );
      return enqueued;
    } catch (error) {
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

    const meterVolume = Number(volume);
    if (!Number.isFinite(meterVolume) || meterVolume <= 0) {
      setNotice({ kind: 'error', text: 'Enter a water volume greater than zero.' });
      return;
    }

    const record: TransactionPayload = {
      transaction_id: crypto.randomUUID(),
      kiosk_id: kioskId,
      meter_volume: meterVolume,
      recorded_at: new Date().toISOString(),
    };

    if (!navigator.onLine || !isOnline || connection === 'dropped') {
      if (await queueEntry(record, 'Offline entry saved on this device and will sync when the server returns.')) {
        setVolume('');
      }
      return;
    }

    setSubmitting(true);
    try {
      await submitTransactionLog(record);
      syncDispatcher.markProcessed(record.transaction_id);
      setVolume('');
      setNotice({ kind: 'success', text: 'Entry acknowledged by the server and saved.' });
    } catch (error) {
      if (error instanceof DuplicateTransactionError) {
        setNotice({ kind: 'error', text: 'The server already has this transaction. No duplicate was saved.' });
      } else if (error instanceof CorruptedPayloadError) {
        syncDispatcher.quarantine(record, error.message);
        setNotice({ kind: 'error', text: `The server rejected this entry: ${error.message}` });
      } else {
        const message =
          error instanceof ConnectionDroppedError
            ? 'Connection was lost. Entry saved on this device for later sync.'
            : 'Server unavailable. Entry saved on this device for later sync.';
        if (await queueEntry(record, message)) setVolume('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const status = !isOnline
    ? 'offline'
    : connection === 'dropped' || pingStatus === 'failed'
      ? 'offline'
      : connection === 'retrying' || pingStatus === 'idle'
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
        <div className={`status-pill status-${status}`} aria-live="polite">
          <span className="status-dot" />
          {statusLabel}
        </div>
      </header>

      <section className="operator-dashboard">
        <div className="operator-heading">
          <div>
            <p className="eyebrow">KIOSK OPERATIONS · {kioskId}</p>
            <h1>Water volume entry</h1>
            <p className="heading-copy">Record a meter reading. Entries are kept safely if the connection drops.</p>
          </div>
          <div className="server-heartbeat">
            <span className={`heartbeat-indicator indicator-${status}`} />
            <span>
              <strong>{statusLabel}</strong>
              <small>{lastPingTime ? `Heartbeat ${lastPingTime}` : 'Waiting for server heartbeat'}</small>
            </span>
          </div>
        </div>

        <div className="operator-grid">
          <section className="entry-card" aria-labelledby="entry-title">
            <div className="section-title">
              <span className="step-badge">01</span>
              <div>
                <p className="card-kicker">NEW TRANSACTION</p>
                <h2 id="entry-title">Enter water volume</h2>
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
              <p className="field-hint">Use the current reading from the kiosk water meter.</p>
              <button className="submit-button" type="submit" disabled={submitting}>
                <span>{submitting ? 'Saving entry…' : 'Save water entry'}</span>
                <span className="button-arrow" aria-hidden="true">→</span>
              </button>
            </form>

            {notice && (
              <p className={`notice notice-${notice.kind}`} role="status" aria-live="polite">
                {notice.text}
              </p>
            )}
            <p className="integrity-note">
              Each saved entry gets a unique ID and a SHA-256 integrity checksum.
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
      </section>
      <footer className="operator-footer">
        <span>Nam Sa-ard · Operator</span>
        <span>Device storage is limited by available browser space</span>
      </footer>
    </main>
  );
}
