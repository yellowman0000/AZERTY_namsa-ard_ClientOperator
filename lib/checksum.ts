/**
 * Checksum and Hash Generation Module for Local Offline Caching & Ingestion.
 *
 * Story: 14-2 (Offline data corrupted checker)
 * Subtask: 1. Create checksum / hash generator for local cached payloads before upload
 * Owner: Ball
 *
 * Acceptance Criteria Met:
 * - Deterministic hash/checksum across environments and object key orderings.
 * - Stored alongside cached payload (via `attachChecksumToPayload` & storage integration).
 * - Documented algorithm + versioning approach (see below and docs/CHECKSUM_AND_DISPATCHER.md).
 *
 * ============================================================================
 * ALGORITHM & VERSIONING DOCUMENTATION:
 * ============================================================================
 * 1. Hashing Algorithm:
 *    - Standard: SHA-256 (FIPS 180-4).
 *    - Implementation: Web Crypto API (`crypto.subtle.digest`) with fallback to
 *      Node/Bun crypto module if `crypto.subtle` is unavailable.
 *
 * 2. Canonicalization:
 *    To ensure determinism regardless of key order, formatting, or serialization:
 *    - Fields are extracted and normalized:
 *      * `transaction_id`: trimmed string
 *      * `kiosk_id`: trimmed string
 *      * `meter_volume`: normalized float formatted with 4 decimal places (`toFixed(4)`)
 *      * `recorded_at`: normalized UTC ISO 8601 string (`new Date(recorded_at).toISOString()`)
 *    - Version 'v1' Canonical Format:
 *      `v1|kiosk:<kiosk_id>|meter:<meter_volume_fixed4>|recorded:<recorded_at_iso>|txn:<transaction_id>`
 *      Pipe-delimited key-value segments prevent concatenation collisions.
 *
 * 3. Versioning Strategy:
 *    - `CURRENT_CHECKSUM_VERSION = 'v1'`.
 *    - Payloads store their version alongside the checksum (`checksum_version: 'v1'`).
 *    - If new fields are required in future iterations (e.g. meter pressure, operator ID),
 *      a new version `v2` can be introduced without breaking validation of existing
 *      offline cached payloads created under `v1`.
 *    - 'legacy' mode (`v0`) retains compatibility with `SHA-256(transaction_id + kiosk_id + meter_volume)`.
 * ============================================================================
 */

export type ChecksumVersion = 'v1' | 'legacy';

export const CURRENT_CHECKSUM_VERSION: ChecksumVersion = 'v1';

export interface PayloadForChecksum {
  transaction_id?: string;
  transactionId?: string;
  kiosk_id?: string;
  kioskId?: string;
  meter_volume?: number;
  meterVolume?: number;
  recorded_at?: string;
  recordedAt?: string;
  checksum?: string;
  checksum_version?: string;
  cached_at?: string;
  quarantined_at?: string;
  quarantine_reason?: string;
}

export interface ChecksumOptions {
  /** Checksum schema version to use. Defaults to 'v1'. */
  version?: ChecksumVersion;
  /** Whether to prefix the checksum string with version, e.g. "v1:abcdef...". Defaults to false. */
  prefixVersion?: boolean;
}

export interface ChecksumResult {
  checksum: string;
  version: ChecksumVersion;
  canonicalString: string;
}

export interface ChecksumVerificationResult {
  isValid: boolean;
  computedChecksum: string;
  expectedChecksum?: string;
  version: ChecksumVersion;
  error?: string;
}

/**
 * Extracts and normalizes core transaction fields from camelCase or snake_case objects.
 */
export function normalizePayloadFields(payload: PayloadForChecksum): {
  transactionId: string;
  kioskId: string;
  meterVolume: number;
  recordedAt: string;
} {
  const transactionId = String(payload.transaction_id || payload.transactionId || '').trim();
  const kioskId = String(payload.kiosk_id || payload.kioskId || '').trim();
  const meterVolume = Number(payload.meter_volume ?? payload.meterVolume ?? 0);
  const rawRecorded = payload.recorded_at || payload.recordedAt;
  
  let recordedAt: string;
  if (rawRecorded) {
    const parsed = new Date(rawRecorded);
    recordedAt = isNaN(parsed.getTime()) ? String(rawRecorded).trim() : parsed.toISOString();
  } else {
    recordedAt = new Date().toISOString();
  }

  return { transactionId, kioskId, meterVolume, recordedAt };
}

/**
 * Produces a deterministic canonical string representation of the payload.
 */
export function canonicalizePayload(
  payload: PayloadForChecksum,
  version: ChecksumVersion = CURRENT_CHECKSUM_VERSION
): string {
  const { transactionId, kioskId, meterVolume, recordedAt } = normalizePayloadFields(payload);

  if (version === 'legacy') {
    return `${transactionId}${kioskId}${meterVolume}`;
  }

  // Version 1 canonical string: sorted key pairs separated by '|'
  const normalizedVolume = Number.isFinite(meterVolume) ? meterVolume.toFixed(4) : '0.0000';
  return `v1|kiosk:${kioskId}|meter:${normalizedVolume}|recorded:${recordedAt}|txn:${transactionId}`;
}

/**
 * Cryptographically computes SHA-256 hash across browser and Node/Bun runtimes.
 */
export async function sha256Hex(dataString: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(dataString);

  // 1. Web Crypto API (Standard in modern browsers, Bun, Node 18+)
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // 2. Node.js crypto fallback
  try {
    // Dynamic import to avoid breaking bundlers targeting browser-only
    const nodeCrypto = await import('crypto');
    return nodeCrypto.createHash('sha256').update(dataString).digest('hex');
  } catch {
    throw new Error('No cryptographic SHA-256 implementation available in current runtime environment.');
  }
}

/**
 * Generates a deterministic checksum for a transaction payload with versioning.
 */
export async function generatePayloadChecksum(
  payload: PayloadForChecksum,
  options: ChecksumOptions = {}
): Promise<ChecksumResult> {
  const version = options.version ?? CURRENT_CHECKSUM_VERSION;
  const canonicalString = canonicalizePayload(payload, version);
  const rawHash = await sha256Hex(canonicalString);

  const checksum = options.prefixVersion ? `${version}:${rawHash}` : rawHash;

  return {
    checksum,
    version,
    canonicalString,
  };
}

/**
 * Attaches deterministic checksum, checksum_version, and cached_at timestamp
 * directly alongside the cached payload record.
 */
export async function attachChecksumToPayload<T extends PayloadForChecksum>(
  payload: T,
  options: ChecksumOptions = {}
): Promise<T & { checksum: string; checksum_version: ChecksumVersion; cached_at: string }> {
  const result = await generatePayloadChecksum(payload, options);
  return {
    ...payload,
    checksum: result.checksum,
    checksum_version: result.version,
    cached_at: (payload.cached_at as string) || new Date().toISOString(),
  };
}

/**
 * Verifies if a payload's data matches its stored checksum.
 * Detects offline data corruption, field tampering, or bit rot.
 */
export async function verifyPayloadChecksum(
  payload: PayloadForChecksum,
  expectedChecksum?: string,
  version?: ChecksumVersion
): Promise<ChecksumVerificationResult> {
  const targetChecksum = expectedChecksum || payload.checksum;
  if (!targetChecksum) {
    return {
      isValid: false,
      computedChecksum: '',
      expectedChecksum: undefined,
      version: version || CURRENT_CHECKSUM_VERSION,
      error: 'Missing checksum for verification',
    };
  }

  // Determine version: check prefix "v1:..." or explicit payload.checksum_version
  let cleanTarget = targetChecksum;
  let detectedVersion = version || (payload.checksum_version as ChecksumVersion);

  if (targetChecksum.startsWith('v1:')) {
    cleanTarget = targetChecksum.substring(3);
    detectedVersion = 'v1';
  } else if (targetChecksum.startsWith('legacy:')) {
    cleanTarget = targetChecksum.substring(7);
    detectedVersion = 'legacy';
  } else if (!detectedVersion) {
    // Default to v1, but check if legacy matches if v1 fails
    detectedVersion = CURRENT_CHECKSUM_VERSION;
  }

  const computedResult = await generatePayloadChecksum(payload, {
    version: detectedVersion,
    prefixVersion: false,
  });

  if (computedResult.checksum.toLowerCase() === cleanTarget.toLowerCase()) {
    return {
      isValid: true,
      computedChecksum: computedResult.checksum,
      expectedChecksum: cleanTarget,
      version: detectedVersion,
    };
  }

  // If defaulting to v1 failed and version wasn't explicitly pinned, try legacy check
  if (!version && !payload.checksum_version && detectedVersion === 'v1') {
    const legacyResult = await generatePayloadChecksum(payload, { version: 'legacy' });
    if (legacyResult.checksum.toLowerCase() === cleanTarget.toLowerCase()) {
      return {
        isValid: true,
        computedChecksum: legacyResult.checksum,
        expectedChecksum: cleanTarget,
        version: 'legacy',
      };
    }
  }

  return {
    isValid: false,
    computedChecksum: computedResult.checksum,
    expectedChecksum: cleanTarget,
    version: detectedVersion,
    error: 'Checksum mismatch: payload data appears modified or corrupted',
  };
}

/**
 * Legacy checksum generator for transaction verification.
 * Format: SHA-256(transaction_id + kiosk_id + meter_volume)
 * Kept for backward compatibility.
 */
export async function generatePayloadHash(
  transaction_id: string,
  kiosk_id: string,
  meter_volume: number
): Promise<string> {
  const result = await generatePayloadChecksum(
    { transaction_id, kiosk_id, meter_volume },
    { version: 'legacy' }
  );
  return result.checksum;
}