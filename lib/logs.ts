/**
 * Read-only access to stored daily logs for Operation Managers (Story 05).
 * Talks to the server's GET /api/kiosk/logs endpoints through the Next.js proxy.
 */
import { fetchWithTimeout } from './http';

export type VerificationStatus = 'VERIFIED' | 'CHECKSUM_MISMATCH' | 'NO_CHECKSUM';
export type ChecksumFormat = 'v1' | 'legacy' | 'receipt';

export interface LogSummary {
  id: string;
  transactionId: string;
  kioskId: string;
  meterVolume: number;
  recordedAt: string;
  createdAt: string;
}

export interface LogPage {
  data: LogSummary[];
  nextCursor: string | null;
}

export interface InspectedLog extends LogSummary {
  operatorId: string | null;
  reportedCash: number | null;
  expectedRevenue: number | null;
  variance: number | null;
  isAnomaly: boolean | null;
}

export interface ChecksumVerification {
  status: VerificationStatus;
  algorithm: 'SHA-256';
  format: ChecksumFormat | null;
  storedChecksum: string | null;
  recomputedChecksum: string | null;
  verifiedAt: string;
}

export interface LogInspection {
  log: InspectedLog;
  verification: ChecksumVerification;
}

export const LOG_PAGE_SIZE = 20;

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' }, signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error("Couldn't reach the server. Check the connection and try again.");
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : `The server answered ${res.status}.`;
    throw new Error(message);
  }
  return body as T;
}

/** One page of logs, newest first. Pass the previous page's `nextCursor` to continue. */
export function fetchLogPage(cursor: string | null, signal?: AbortSignal): Promise<LogPage> {
  const params = new URLSearchParams({ limit: String(LOG_PAGE_SIZE) });
  if (cursor) params.set('cursor', cursor);
  return getJson(`/api/kiosk/logs?${params}`, signal);
}

/** A log's stored details plus a checksum check the server runs on every call. */
export function fetchLogInspection(logId: string, signal?: AbortSignal): Promise<LogInspection> {
  return getJson(`/api/kiosk/logs/${encodeURIComponent(logId)}/inspect`, signal);
}
