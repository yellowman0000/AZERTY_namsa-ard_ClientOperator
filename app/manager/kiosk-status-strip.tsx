import { formatHeartbeatAge, type KioskStatusRecord } from '../../lib/kioskStatus';
import { formatDateTime } from './format';

export interface KioskStatusStripProps {
  kiosks: KioskStatusRecord[];
  onlineCount: number;
  staleAfterSeconds: number;
  /** When the snapshot on screen arrived (client clock); `null` for fixtures. */
  updatedAt: number | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

function cardClassName(status: KioskStatusRecord['status']) {
  return status === 'ONLINE'
    ? 'kiosk-card kiosk-card-online'
    : 'kiosk-card kiosk-card-offline';
}

function heartbeatTitle(kiosk: KioskStatusRecord) {
  if (kiosk.lastHeartbeat && !Number.isNaN(Date.parse(kiosk.lastHeartbeat))) {
    return `Last heartbeat ${formatDateTime(kiosk.lastHeartbeat)}`;
  }
  return 'No heartbeat recorded yet';
}

/**
 * Fleet heartbeat strip for the manager dashboard (Story 01).
 *
 * Presentational on purpose: the polling hook supplies the snapshot, so this
 * component can be rendered to static markup in the unit tests. One card per
 * registered kiosk — the kiosk id, ONLINE/OFFLINE and the heartbeat age; there
 * is deliberately no location name (the server only stores the id).
 */
export function KioskStatusStrip({
  kiosks,
  onlineCount,
  staleAfterSeconds,
  updatedAt,
  loading,
  error,
  onRefresh,
}: KioskStatusStripProps) {
  const count = kiosks.length;
  const updatedLabel =
    updatedAt === null
      ? null
      : `Updated ${new Date(updatedAt).toLocaleTimeString()}`;

  return (
    <section className="kiosk-status" aria-labelledby="kiosk-status-title">
      <div className="kiosk-status-head">
        <div>
          <h2 id="kiosk-status-title">Kiosk status</h2>
          <p className="kiosk-status-copy">
            Heartbeat per kiosk. A kiosk is OFFLINE after {staleAfterSeconds} seconds
            without a heartbeat.
          </p>
        </div>
        <div className="kiosk-status-meta">
          {count > 0 && (
            <span className="kiosk-status-summary" role="status" aria-live="polite">
              {onlineCount} of {count} online
            </span>
          )}
          {updatedLabel && <span className="kiosk-status-updated">{updatedLabel}</span>}
          <button
            className="button button-secondary"
            type="button"
            onClick={onRefresh}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && count > 0 && (
        <p className="logs-message kiosk-status-error" role="status">
          Could not refresh kiosk status. {error}
        </p>
      )}

      {loading ? (
        <p className="logs-message" role="status">
          Loading kiosk status…
        </p>
      ) : error && count === 0 ? (
        <div className="logs-message logs-message-error" role="alert">
          <p>Could not load kiosk status. {error}</p>
          <button className="button button-secondary" type="button" onClick={onRefresh}>
            Try again
          </button>
        </div>
      ) : count === 0 ? (
        <p className="logs-message">No kiosks have registered a heartbeat yet.</p>
      ) : (
        <ul className="kiosk-grid" aria-label="Kiosk fleet status">
          {kiosks.map((kiosk) => (
            <li
              key={kiosk.kioskId}
              className={cardClassName(kiosk.status)}
              title={heartbeatTitle(kiosk)}
            >
              <span className="kiosk-card-id">{kiosk.kioskId}</span>
              <span className="kiosk-card-status">
                <span className="kiosk-card-dot" aria-hidden="true" />
                {kiosk.status}
                <span className="kiosk-card-ago">
                  ({formatHeartbeatAge(kiosk.secondsSinceLastPing)})
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
