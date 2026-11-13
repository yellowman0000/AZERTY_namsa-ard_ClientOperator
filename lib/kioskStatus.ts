/**
 * Kiosk fleet heartbeat status client (Story 01).
 *
 * Reads the server's read-only fleet snapshot:
 *
 *   GET /api/kiosk/status
 *   {
 *     "count": 3,
 *     "onlineCount": 2,
 *     "staleAfterSeconds": 30,
 *     "kiosks": [
 *       {
 *         "kioskId": "KIOSK-001",
 *         "status": "ONLINE",
 *         "lastHeartbeat": "2026-11-13T14:55:01.234Z",
 *         "secondsSinceLastPing": 4
 *       }
 *     ]
 *   }
 *
 * The server owns the ONLINE/OFFLINE rule (30 s since the last heartbeat), the
 * heartbeat age and the ordering. This module only builds the request,
 * validates the payload and formats the age, so the manager dashboard never
 * renders a NaN card or a guessed status. Everything except
 * `fetchKioskFleet` is pure and unit-tested without a DOM.
 */
import { getJson } from './logs';

export const KIOSK_STATUS_PATH = '/api/kiosk/status';

/** Matches the kiosk heartbeat cadence: a disconnect shows up within ~40 s. */
export const KIOSK_STATUS_POLL_MS = 10_000;

/** Fallback when the server does not advertise its own timeout. */
export const DEFAULT_HEARTBEAT_TIMEOUT_SECONDS = 30;

export type KioskStatusValue = 'ONLINE' | 'OFFLINE';

export interface KioskStatusRecord {
  kioskId: string;
  status: KioskStatusValue;
  /** ISO timestamp, only used for the card's tooltip/accessible title. */
  lastHeartbeat: string | null;
  /** Rounded, never negative; `null` when the kiosk has never pinged. */
  secondsSinceLastPing: number | null;
}

export interface KioskFleet {
  /** `OFFLINE` threshold the server applied, in seconds (defaults to 30). */
  staleAfterSeconds: number;
  onlineCount: number;
  kiosks: KioskStatusRecord[];
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function parseKiosk(value: unknown, index: number): KioskStatusRecord {
  const label = `Kiosk status entry ${index + 1}`;
  const row = asRecord(value, `${label} was not an object.`);

  const kioskId = typeof row.kioskId === 'string' ? row.kioskId.trim() : '';
  if (!kioskId) throw new Error(`${label} is missing a kiosk id.`);

  const status = row.status;
  if (status !== 'ONLINE' && status !== 'OFFLINE') {
    throw new Error(`${label} has an invalid status.`);
  }

  const lastHeartbeat = row.lastHeartbeat;
  if (
    lastHeartbeat !== null &&
    lastHeartbeat !== undefined &&
    typeof lastHeartbeat !== 'string'
  ) {
    throw new Error(`${label} has an invalid last heartbeat.`);
  }

  let secondsSinceLastPing: number | null = null;
  const seconds = row.secondsSinceLastPing;
  if (seconds !== null && seconds !== undefined) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
      throw new Error(`${label} has an invalid heartbeat age.`);
    }
    secondsSinceLastPing = Math.round(seconds);
  }

  return {
    kioskId,
    status,
    lastHeartbeat: typeof lastHeartbeat === 'string' ? lastHeartbeat : null,
    secondsSinceLastPing,
  };
}

/**
 * Validates a raw endpoint body. A malformed answer fails with a readable
 * message instead of rendering an empty or NaN strip.
 */
export function parseKioskFleet(body: unknown): KioskFleet {
  const root = asRecord(body, 'The kiosk status response was not an object.');

  if (!Array.isArray(root.kiosks)) {
    throw new Error(
      'The kiosk status response did not contain a list of kiosks.'
    );
  }

  const kiosks = root.kiosks.map(parseKiosk).sort((a, b) =>
    a.kioskId.localeCompare(b.kioskId)
  );

  const staleAfterSeconds =
    typeof root.staleAfterSeconds === 'number' &&
    Number.isFinite(root.staleAfterSeconds) &&
    root.staleAfterSeconds > 0
      ? root.staleAfterSeconds
      : DEFAULT_HEARTBEAT_TIMEOUT_SECONDS;

  return {
    staleAfterSeconds,
    onlineCount: kiosks.filter((kiosk) => kiosk.status === 'ONLINE').length,
    kiosks,
  };
}

/** Every registered kiosk with its live heartbeat status. */
export async function fetchKioskFleet(signal?: AbortSignal): Promise<KioskFleet> {
  const body = await getJson<unknown>(KIOSK_STATUS_PATH, signal);
  return parseKioskFleet(body);
}

/**
 * Human age of a heartbeat: `4s ago`, `3m ago`, `2h ago`, `3d ago`, or `never`.
 * Locale-independent so the copy and the tests stay stable.
 */
export function formatHeartbeatAge(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'never';

  const safe = Math.max(0, Math.round(seconds));
  if (safe < 60) return `${safe}s ago`;
  if (safe < 3_600) return `${Math.floor(safe / 60)}m ago`;
  if (safe < 86_400) return `${Math.floor(safe / 3_600)}h ago`;
  return `${Math.floor(safe / 86_400)}d ago`;
}
