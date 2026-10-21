import { generatePayloadChecksum, CURRENT_CHECKSUM_VERSION } from './checksum';
import { fetchWithRetry } from './http';

export interface TransactionPayload {
  transaction_id: string;
  kiosk_id: string;
  meter_volume: number;
  recorded_at: string;
  checksum?: string;
  checksum_version?: string;
  cached_at?: string;
  quarantined_at?: string;
  quarantine_reason?: string;
}

export class CorruptedPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorruptedPayloadError';
  }
}

export class DuplicateTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateTransactionError';
  }
}

export interface SubmitLogOptions {
  serverUrl?: string;
  retryDelaysMs?: number[];
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.message === 'string') return value.message;
  if (Array.isArray(value.message)) {
    return value.message.filter((item): item is string => typeof item === 'string').join(', ');
  }
  return undefined;
}

function isDuplicateResponse(value: unknown, transactionId: string): boolean {
  if (!isRecord(value) || value.error !== 'Conflict') return false;
  const message = getErrorMessage(value)?.toLowerCase();
  return Boolean(
    message &&
      message.includes(transactionId.toLowerCase()) &&
      (message.includes('already exists') ||
        message.includes('already recorded') ||
        message.includes('duplicate'))
  );
}

function getStateConflictReason(value: unknown): string | undefined {
  if (!isRecord(value) || value.error !== 'STATE_CONFLICT') return undefined;
  if (typeof value.reason === 'string') return value.reason;
  return (
    getErrorMessage(value) ||
    'The server rejected this reading because it conflicts with its current state.'
  );
}

/**
 * Prepares payload with SHA-256 checksum and submits to POST /api/kiosk/logs (or /api/logs)
 *
 * Network behaviour (see ./http):
 *  - 5 s timeout per attempt
 *  - on timeout / network error / 5xx: retry after 2 s, 4 s, 8 s (or custom retryDelaysMs)
 *  - if all attempts fail, throws ConnectionDroppedError
 *
 * Idempotency: recognized duplicate responses are distinguished from other
 * conflicts so state conflicts are never treated as successful duplicates.
 */
export async function submitTransactionLog(
  payload: TransactionPayload | Omit<TransactionPayload, 'checksum'>,
  serverUrlOrOptions: string | SubmitLogOptions = '/api/kiosk/logs'
): Promise<{ ack: boolean; status?: string; logId?: string }> {
  const options: SubmitLogOptions =
    typeof serverUrlOrOptions === 'string'
      ? { serverUrl: serverUrlOrOptions }
      : serverUrlOrOptions;

  const serverUrl = options.serverUrl || '/api/kiosk/logs';
  const retryDelaysMs = options.retryDelaysMs;

  // Use existing stored checksum if available; otherwise generate deterministic checksum
  let checksum = 'checksum' in payload ? payload.checksum : undefined;
  let checksumVersion = (payload as TransactionPayload).checksum_version;

  if (!checksum) {
    const checksumResult = await generatePayloadChecksum(payload, {
      version: CURRENT_CHECKSUM_VERSION,
    });
    checksum = checksumResult.checksum;
    checksumVersion = checksumResult.version;
  }

  // Format request body compatible with NestJS IngestLogDto (camelCase) and client (snake_case)
  const bodyPayload = {
    transactionId: payload.transaction_id,
    kioskId: payload.kiosk_id,
    meterVolume: payload.meter_volume,
    recordedAt: payload.recorded_at,
    checksum,
    // snake_case preserved for client & legacy servers
    transaction_id: payload.transaction_id,
    kiosk_id: payload.kiosk_id,
    meter_volume: payload.meter_volume,
    recorded_at: payload.recorded_at,
    checksum_version: checksumVersion,
  };

  const response = await fetchWithRetry(
    serverUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
    },
    {
      ...(retryDelaysMs !== undefined ? { retryDelaysMs } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      onRetry: (attempt, delayMs) => {
        console.warn(`[API] Attempt ${attempt} failed, retrying in ${delayMs / 1000}s...`);
      },
    }
  );

  if (response.status === 409) {
    const conflictBody: unknown = await response.json().catch(() => null);
    const stateConflictReason = getStateConflictReason(conflictBody);
    if (stateConflictReason) {
      throw new CorruptedPayloadError(`Server state conflict: ${stateConflictReason}`);
    }
    if (isDuplicateResponse(conflictBody, payload.transaction_id)) {
      throw new DuplicateTransactionError(
        `Duplicate transaction rejected: ${payload.transaction_id}`
      );
    }
    throw new Error('Server returned HTTP 409 without a recognized duplicate transaction response.');
  }

  if (response.status === 422) {
    throw new CorruptedPayloadError('Checksum mismatch or corrupted payload');
  }

  if (response.status === 400) {
    const errorJson: unknown = await response.json().catch(() => null);
    const errorDetail = getErrorMessage(errorJson) || 'Bad Request / Invalid payload schema';
    throw new CorruptedPayloadError(`Server rejected invalid payload: ${errorDetail}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP Error ${response.status}`);
  }

  const result: unknown = await response.json();
  if (!isRecord(result)) {
    throw new Error('Server response did not acknowledge the transaction.');
  }

  if (result.ack === true) {
    return {
      ack: true,
      ...(typeof result.status === 'string' ? { status: result.status } : {}),
      ...(typeof result.logId === 'string' ? { logId: result.logId } : {}),
    };
  }

  if (result.success === true && result.transactionId === payload.transaction_id) {
    return {
      ack: true,
      status: 'saved',
      ...(typeof result.logId === 'string' ? { logId: result.logId } : {}),
    };
  }

  throw new Error('Server response did not acknowledge the transaction.');
}