import { generatePayloadChecksum, CURRENT_CHECKSUM_VERSION } from './checksum';
import { fetchWithRetry, fetchWithTimeout } from './http';

export interface TransactionPayload {
  transaction_id: string;
  kiosk_id: string;
  meter_volume: number;
  recorded_at: string;
  reading_type?: 'CUMULATIVE_METER' | 'DAILY_VOLUME';
  operator_id?: string;
  reported_cash?: number;
  proof_image_url?: string;
  proofImageUrl?: string;
  evidence_path?: string;
  evidence_pending?: boolean;
  checksum?: string;
  checksum_version?: string;
  cached_at?: string;
  quarantined_at?: string;
  quarantine_reason?: string;
}

export interface SignedReceipt {
  receiptId: string;
  transactionId: string;
  kioskId: string;
  operatorId: string;
  meterVolume: number;
  reportedCash: number;
  recordedAt: string;
  checksum: string;
  hash: string;
  signature: string;
  algorithm: 'SHA-256';
  proofImageUrl?: string;
  evidencePath?: string;
  issuedAt: string;
  signedAt: string;
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

export class EvidenceStorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceStorageUnavailableError';
  }
}

export interface SubmitLogOptions {
  serverUrl?: string;
  retryDelaysMs?: number[];
  timeoutMs?: number;
  evidenceFile?: Blob;
  evidenceFileName?: string;
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
  if (typeof value.reason === 'string') {
    const detail = getErrorMessage(value);
    return detail ? `${value.reason}: ${detail}` : value.reason;
  }
  return (
    getErrorMessage(value) ||
    'The server rejected this reading because it conflicts with its current state.'
  );
}

export function parseSignedReceipt(value: unknown): SignedReceipt | undefined {
  if (!isRecord(value)) return undefined;

  const receiptId = value.receiptId;
  const transactionId = value.transactionId;
  const kioskId = value.kioskId;
  const operatorId = value.operatorId;
  const recordedAt = value.recordedAt;
  const checksum = value.checksum;
  const hash = value.hash;
  const signature = value.signature;
  const proofImageUrl = value.proofImageUrl;
  const evidencePath = value.evidencePath;
  const issuedAt = value.issuedAt;
  const signedAt = value.signedAt;
  if (
    typeof receiptId !== 'string' ||
    !receiptId ||
    typeof transactionId !== 'string' ||
    typeof kioskId !== 'string' ||
    typeof operatorId !== 'string' ||
    typeof recordedAt !== 'string' ||
    typeof checksum !== 'string' ||
    typeof hash !== 'string' ||
    typeof signature !== 'string' ||
    typeof issuedAt !== 'string' ||
    typeof signedAt !== 'string' ||
    typeof value.meterVolume !== 'number' ||
    !Number.isFinite(value.meterVolume) ||
    typeof value.reportedCash !== 'number' ||
    !Number.isFinite(value.reportedCash) ||
    value.algorithm !== 'SHA-256'
  ) {
    return undefined;
  }

  if (
    !/^[a-f\d]{64}$/i.test(checksum) ||
    hash !== checksum ||
    !/^[a-f\d]{64}$/i.test(signature) ||
    Number.isNaN(Date.parse(issuedAt)) ||
    Number.isNaN(Date.parse(recordedAt)) ||
    Number.isNaN(Date.parse(signedAt))
  ) {
    return undefined;
  }

  return {
    receiptId,
    transactionId,
    kioskId,
    operatorId,
    meterVolume: value.meterVolume,
    reportedCash: value.reportedCash,
    recordedAt,
    checksum,
    hash,
    signature,
    ...(typeof proofImageUrl === 'string' ? { proofImageUrl } : {}),
    ...(typeof evidencePath === 'string' ? { evidencePath } : {}),
    algorithm: 'SHA-256',
    issuedAt,
    signedAt,
  };
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
): Promise<{
  ack: boolean;
  status?: string;
  logId?: string;
  proofImageUrl?: string;
  evidencePath?: string;
  receipt?: SignedReceipt;
}> {
  const options: SubmitLogOptions =
    typeof serverUrlOrOptions === 'string'
      ? { serverUrl: serverUrlOrOptions }
      : serverUrlOrOptions;

  const serverUrl = options.serverUrl || '/api/kiosk/logs';
  const retryDelaysMs = options.retryDelaysMs;
  let proofImageUrl =
    payload.proof_image_url ?? payload.proofImageUrl ?? payload.evidence_path;

  if (options.evidenceFile) {
    const formData = new FormData();
    formData.append(
      'file',
      options.evidenceFile,
      options.evidenceFileName || `evidence-${payload.transaction_id}`
    );
    const evidenceUrl = `${serverUrl.replace(/\/+$/, '')}/${encodeURIComponent(payload.transaction_id)}/evidence`;
    let uploadResponse: Response;
    try {
      uploadResponse = await fetchWithTimeout(
        evidenceUrl,
        { method: 'POST', body: formData },
        // Above the server's imgBB budget (IMGBB_TIMEOUT_MS, 90s default) so the
        // server can answer 503 itself instead of the browser aborting first.
        options.timeoutMs ?? 120000
      );
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : '';
      throw new EvidenceStorageUnavailableError(
        `Could not reach the server's evidence storage.${detail} The reading and photo remain queued for sync.`
      );
    }
    if (!uploadResponse.ok) {
      const errorBody: unknown = await uploadResponse.json().catch(() => null);
      const detail = getErrorMessage(errorBody);
      if (uploadResponse.status === 503) {
        throw new EvidenceStorageUnavailableError(
          detail ||
            'Evidence storage is unavailable on the server. Check the server image storage configuration; this submission remains queued.'
        );
      }
      if (uploadResponse.status >= 400 && uploadResponse.status < 500) {
        throw new CorruptedPayloadError(
          detail || `Server rejected evidence image (HTTP ${uploadResponse.status}).`
        );
      }
      throw new Error(
        detail || `Evidence upload failed with HTTP ${uploadResponse.status}.`
      );
    }

    const uploadResult: unknown = await uploadResponse.json();
    if (!isRecord(uploadResult)) {
      throw new Error('Evidence upload response was not a valid object.');
    }
    proofImageUrl =
      typeof uploadResult.proofImageUrl === 'string'
        ? uploadResult.proofImageUrl
        : typeof uploadResult.evidencePath === 'string'
          ? uploadResult.evidencePath
          : undefined;
    if (!proofImageUrl) {
      throw new Error('Evidence upload response did not contain a proof image URL.');
    }
  }

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
    operatorId: payload.operator_id,
    meterVolume: payload.meter_volume,
    reportedCash: payload.reported_cash,
    readingType: payload.reading_type,
    proofImageUrl,
    evidencePath: proofImageUrl,
    recordedAt: payload.recorded_at,
    checksum,
    // snake_case preserved for client & legacy servers
    transaction_id: payload.transaction_id,
    kiosk_id: payload.kiosk_id,
    operator_id: payload.operator_id,
    meter_volume: payload.meter_volume,
    reported_cash: payload.reported_cash,
    reading_type: payload.reading_type,
    proof_image_url: proofImageUrl,
    evidence_path: proofImageUrl,
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
    const parsedReceipt = parseSignedReceipt(result.receipt);
    const responseProofImageUrl =
      typeof result.proofImageUrl === 'string'
        ? result.proofImageUrl
        : typeof result.evidencePath === 'string'
          ? result.evidencePath
          : parsedReceipt?.proofImageUrl ?? parsedReceipt?.evidencePath;
    const receipt =
      parsedReceipt && responseProofImageUrl && !parsedReceipt.proofImageUrl
        ? { ...parsedReceipt, proofImageUrl: responseProofImageUrl }
        : parsedReceipt;
    return {
      ack: true,
      ...(typeof result.status === 'string' ? { status: result.status } : {}),
      ...(typeof result.logId === 'string' ? { logId: result.logId } : {}),
      ...(responseProofImageUrl
        ? { proofImageUrl: responseProofImageUrl, evidencePath: responseProofImageUrl }
        : {}),
      ...(receipt ? { receipt } : {}),
    };
  }

  if (result.success === true && result.transactionId === payload.transaction_id) {
    const parsedReceipt = parseSignedReceipt(result.receipt);
    const responseProofImageUrl =
      typeof result.proofImageUrl === 'string'
        ? result.proofImageUrl
        : typeof result.evidencePath === 'string'
          ? result.evidencePath
          : parsedReceipt?.proofImageUrl ?? parsedReceipt?.evidencePath;
    const receipt =
      parsedReceipt && responseProofImageUrl && !parsedReceipt.proofImageUrl
        ? { ...parsedReceipt, proofImageUrl: responseProofImageUrl }
        : parsedReceipt;
    return {
      ack: true,
      status: 'saved',
      ...(typeof result.logId === 'string' ? { logId: result.logId } : {}),
      ...(responseProofImageUrl
        ? { proofImageUrl: responseProofImageUrl, evidencePath: responseProofImageUrl }
        : {}),
      ...(receipt ? { receipt } : {}),
    };
  }

  throw new Error('Server response did not acknowledge the transaction.');
}