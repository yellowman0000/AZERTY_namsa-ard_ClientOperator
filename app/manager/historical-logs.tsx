'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchLogPage, type LogSummary } from '../../lib/logs';
import { formatDateTime, formatLiters } from './format';
import LogInspectionModal from './log-inspection-modal';

export default function HistoricalLogs() {
  const [logs, setLogs] = useState<LogSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inspectingId, setInspectingId] = useState<string | null>(null);

  // First page. State starts as "loading", so the effect only sets state once
  // the request settles.
  useEffect(() => {
    const controller = new AbortController();
    fetchLogPage(null, controller.signal)
      .then((page) => {
        setLogs(page.data);
        setNextCursor(page.nextCursor);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Could not load logs.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  // "Load older logs" and "Try again".
  const loadPage = async (cursor: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchLogPage(cursor);
      setLogs((current) => (cursor ? [...current, ...page.data] : page.data));
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load logs.');
    }
    setLoading(false);
  };

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
        <nav className="topbar-actions" aria-label="Manager views">
          <Link className="nav-link" href="/">
            Daily submission
          </Link>
          <Link className="nav-link" href="/manager/operations-review">
            Operations review
          </Link>
          <Link className="nav-link" href="/manager/stakeholder-analytics">
            Stakeholder analytics
          </Link>
        </nav>
      </header>

      <section className="operator-dashboard">
        <div className="operator-heading">
          <div>
            <p className="eyebrow">OPERATIONS · READ-ONLY</p>
            <h1>Historical logs</h1>
            <p className="heading-copy">
              Inspect any submitted log to see its details and check that it has not changed since submission.
            </p>
          </div>
        </div>

        <section className="logs-card" aria-labelledby="logs-title">
          <div className="logs-card-heading">
            <h2 id="logs-title">Submitted logs</h2>
            <span className="logs-count">
              {logs.length} {logs.length === 1 ? 'log' : 'logs'} shown
            </span>
          </div>

          {logs.length > 0 && (
            <div className="logs-table-wrap">
              <table className="logs-table">
                <caption className="visually-hidden">Submitted daily logs, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Recorded at</th>
                    <th scope="col">Kiosk</th>
                    <th scope="col">Transaction ID</th>
                    <th scope="col" className="logs-num">
                      Meter volume
                    </th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td>
                        <time dateTime={log.recordedAt}>{formatDateTime(log.recordedAt)}</time>
                      </td>
                      <td>{log.kioskId}</td>
                      <td>
                        <code>{log.transactionId}</code>
                      </td>
                      <td className="logs-num">{formatLiters(log.meterVolume)}</td>
                      <td className="logs-action">
                        <button
                          className="button button-secondary"
                          type="button"
                          aria-label={`Inspect log ${log.transactionId}`}
                          onClick={() => setInspectingId(log.id)}
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {error ? (
            <div className="logs-message logs-message-error" role="alert">
              <p>Could not load logs. {error}</p>
              <button className="button button-secondary" type="button" onClick={() => void loadPage(logs.length ? nextCursor : null)}>
                Try again
              </button>
            </div>
          ) : loading ? (
            <p className="logs-message" role="status">
              Loading logs…
            </p>
          ) : logs.length === 0 ? (
            <p className="logs-message">No logs have been submitted yet.</p>
          ) : nextCursor ? (
            <div className="logs-more">
              <button className="button button-secondary" type="button" onClick={() => void loadPage(nextCursor)}>
                Load older logs
              </button>
            </div>
          ) : (
            <p className="logs-message">You have reached the oldest log.</p>
          )}
        </section>
      </section>

      <footer className="operator-footer">
        <span>Nam Sa-ard · Operator</span>
        <span>Read-only log history</span>
      </footer>

      {inspectingId && <LogInspectionModal logId={inspectingId} onClose={() => setInspectingId(null)} />}
    </main>
  );
}
