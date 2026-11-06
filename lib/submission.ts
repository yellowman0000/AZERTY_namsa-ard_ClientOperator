import type { SignedReceipt, TransactionPayload } from './api';

export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_EVIDENCE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const SUBMISSION_MESSAGES = {
  evidence: 'Choose a JPEG, PNG, or WebP photo that is 5 MB or smaller.',
  volume: 'Enter a water volume greater than zero.',
  operatorId: 'Enter the Operator ID as OP-001 (three digits).',
  cash: 'Enter cash collected as zero or a positive amount.',
} as const;

/** Canonical operator identifier, e.g. OP-001 — mirrors the server DTO. */
export const OPERATOR_ID_PATTERN = /^OP-\d{3}$/;

/** Only the file metadata matters for validation, so tests can pass a plain object. */
export interface EvidenceCandidate {
  type: string;
  size: number;
}

export interface DailySubmissionInput {
  volume: string;
  cash: string;
  operatorId: string;
  kioskId: string;
  transactionId: string;
  recordedAt: string;
  evidencePhoto?: EvidenceCandidate | null;
}

export type DailySubmissionResult =
  | { ok: true; record: TransactionPayload; hasEvidence: boolean }
  | { ok: false; error: string };

/** A photo is optional; when present it must be a supported image type under 5 MB. */
export function isAcceptableEvidence(
  photo: EvidenceCandidate | null | undefined
): boolean {
  if (!photo) return true;
  return (
    (ALLOWED_EVIDENCE_TYPES as readonly string[]).includes(photo.type) &&
    photo.size <= MAX_EVIDENCE_BYTES
  );
}

/**
 * Validates one daily cash & liter submission and, when it is valid, builds the
 * payload the operator console posts to `/api/kiosk/logs`.
 */
export function validateDailySubmission(
  input: DailySubmissionInput
): DailySubmissionResult {
  if (!isAcceptableEvidence(input.evidencePhoto)) {
    return { ok: false, error: SUBMISSION_MESSAGES.evidence };
  }

  const meterVolume = Number(input.volume);
  if (!Number.isFinite(meterVolume) || meterVolume <= 0) {
    return { ok: false, error: SUBMISSION_MESSAGES.volume };
  }

  const operatorId = input.operatorId.trim().toUpperCase();
  if (!OPERATOR_ID_PATTERN.test(operatorId)) {
    return { ok: false, error: SUBMISSION_MESSAGES.operatorId };
  }

  const reportedCash = Number(input.cash);
  if (
    input.cash.trim() === '' ||
    !Number.isFinite(reportedCash) ||
    reportedCash < 0
  ) {
    return { ok: false, error: SUBMISSION_MESSAGES.cash };
  }

  return {
    ok: true,
    hasEvidence: Boolean(input.evidencePhoto),
    record: {
      transaction_id: input.transactionId,
      kiosk_id: input.kioskId,
      reading_type: 'CUMULATIVE_METER',
      operator_id: operatorId,
      meter_volume: meterVolume,
      reported_cash: reportedCash,
      recorded_at: input.recordedAt,
    },
  };
}

/**
 * A receipt may only be shown for the submission it belongs to. When the
 * operator attached a photo, the receipt must also reference stored evidence.
 */
export function receiptMatchesSubmission(
  receipt: SignedReceipt,
  record: TransactionPayload,
  requiresEvidence = false
): boolean {
  return (
    receipt.transactionId === record.transaction_id &&
    receipt.kioskId === record.kiosk_id &&
    receipt.operatorId === record.operator_id &&
    receipt.meterVolume === record.meter_volume &&
    receipt.reportedCash === record.reported_cash &&
    Date.parse(receipt.recordedAt) === Date.parse(record.recorded_at) &&
    (!requiresEvidence || Boolean(receipt.proofImageUrl || receipt.evidencePath))
  );
}
