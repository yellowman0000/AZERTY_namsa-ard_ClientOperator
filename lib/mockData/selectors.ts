/**
 * Pure adapters from editable fixture rows to the app's real view models.
 *
 * Everything here is a pure function of its arguments (no clock, no storage), so
 * it is unit-tested directly and safe to call during render. Date fields are
 * stored as local `datetime-local` strings; these helpers convert them to the ISO
 * strings the views expect and fill safe fallbacks for half-edited rows.
 */
import type { SignedReceipt, TransactionPayload } from '../api';
import {
  LOG_PAGE_SIZE,
  type ChecksumFormat,
  type InspectedLog,
  type LogInspection,
  type LogPage,
  type LogSummary,
  type VerificationStatus,
} from '../logs';
import type { ReconciliationRecord } from '../reconciliation';
import type { StakeholderAnalytics } from '../stakeholderAnalytics';
import { demoDigest, localDay } from './datasets';
import type { FixtureRow, FixtureValue, MockSnapshot } from './types';

/* ---------- value readers ---------- */

export function readText(value: FixtureValue): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

export function readNumber(value: FixtureValue): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function readBoolean(value: FixtureValue): boolean {
  return value === true || value === 'true';
}

/** Parse a `datetime-local` or ISO string; null when empty or unreadable. */
export function fixtureDate(value: FixtureValue): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function fixtureIso(value: FixtureValue): string | null {
  const date = fixtureDate(value);
  return date ? date.toISOString() : null;
}

/** Local calendar day key for a fixture date field, or null when unreadable. */
export function fixtureDay(value: FixtureValue): string | null {
  const date = fixtureDate(value);
  return date ? localDay(date) : null;
}

/* ---------- dataset selection ---------- */

/** Rows of one dataset from a snapshot; never null, so callers can map directly. */
export function rowsOf(snapshot: MockSnapshot, datasetId: string): readonly FixtureRow[] {
  return snapshot.datasets[datasetId] ?? [];
}

export interface RangeQuery {
  startDate?: string;
  endDate?: string;
}

/* ---------- operations review ---------- */

export function toReconciliationRecord(row: FixtureRow): ReconciliationRecord {
  const recordedAt = fixtureIso(row.recordedAt);
  const operatorId = readText(row.operatorId);
  const waterType = readText(row.waterType);
  const proofImageUrl = readText(row.proofImageUrl);
  return {
    id: readText(row.id),
    transactionId: readText(row.transactionId),
    kioskId: readText(row.kioskId),
    operatorId: operatorId === '' ? null : operatorId,
    meterVolume: readNumber(row.meterVolume) ?? 0,
    reportedCash: readNumber(row.reportedCash),
    expectedRevenue: readNumber(row.expectedRevenue),
    variance: readNumber(row.variance),
    isAnomaly: readBoolean(row.isAnomaly),
    waterType: waterType === '' ? undefined : waterType,
    proofImageUrl: proofImageUrl === '' ? null : proofImageUrl,
    isSynced: readBoolean(row.isSynced),
    acceptedAt: fixtureIso(row.acceptedAt),
    // An unreadable timestamp survives as '' so the daily table can report it as skipped.
    recordedAt: recordedAt ?? '',
    createdAt: fixtureIso(row.createdAt),
  };
}

/**
 * Fixture records inside the applied range, newest first.
 *
 * The bounds are local calendar days (`YYYY-MM-DD`), matching the promise the
 * date filter already makes to managers. With no bounds every row is shown —
 * including rows whose timestamp is unreadable, which the dashboard then reports
 * as skipped instead of dropping them silently.
 */
export function selectReconciliationRecords(
  rows: readonly FixtureRow[],
  range: RangeQuery = {}
): ReconciliationRecord[] {
  const start = (range.startDate ?? '').trim();
  const end = (range.endDate ?? '').trim();
  const hasBounds = start !== '' || end !== '';

  const records = rows
    .filter((row) => {
      if (!hasBounds) return true;
      const day = fixtureDay(row.recordedAt);
      if (day === null) return false;
      if (start && day < start) return false;
      if (end && day > end) return false;
      return true;
    })
    .map(toReconciliationRecord);

  return records.sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
}

/* ---------- historical logs ---------- */

export function toLogSummary(row: FixtureRow): LogSummary {
  const recordedAt = fixtureIso(row.recordedAt);
  return {
    id: readText(row.id),
    transactionId: readText(row.transactionId),
    kioskId: readText(row.kioskId),
    meterVolume: readNumber(row.meterVolume) ?? 0,
    recordedAt: recordedAt ?? '',
    createdAt: fixtureIso(row.createdAt) ?? recordedAt ?? '',
  };
}

/** One cursor page of fixture logs, newest first. `cursor` is the row offset. */
export function selectLogPage(
  rows: readonly FixtureRow[],
  cursor: string | null,
  pageSize: number = LOG_PAGE_SIZE
): LogPage {
  const sorted = [...rows].sort((left, right) =>
    String(right.recordedAt ?? '').localeCompare(String(left.recordedAt ?? ''))
  );
  const parsed = cursor === null ? 0 : Number.parseInt(cursor, 10);
  const start = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  const data = sorted.slice(start, start + pageSize).map(toLogSummary);
  const next = start + pageSize < sorted.length ? String(start + pageSize) : null;
  return { data, nextCursor: next };
}

/* ---------- log inspection ---------- */

const VERIFICATION_STATUSES: readonly VerificationStatus[] = [
  'VERIFIED',
  'CHECKSUM_MISMATCH',
  'NO_CHECKSUM',
];

const CHECKSUM_FORMATS: readonly ChecksumFormat[] = ['v1', 'legacy', 'receipt'];

function toVerificationStatus(value: FixtureValue): VerificationStatus {
  const text = readText(value) as VerificationStatus;
  return VERIFICATION_STATUSES.includes(text) ? text : 'VERIFIED';
}

function toChecksumFormat(value: FixtureValue): ChecksumFormat | null {
  const text = readText(value) as ChecksumFormat;
  return CHECKSUM_FORMATS.includes(text) ? text : null;
}

function toInspectedLog(row: FixtureRow): InspectedLog {
  const recordedAt = fixtureIso(row.recordedAt);
  const operatorId = readText(row.operatorId);
  const waterType = readText(row.waterType);
  const proofImageUrl = readText(row.proofImageUrl);
  return {
    id: readText(row.id),
    transactionId: readText(row.transactionId),
    kioskId: readText(row.kioskId),
    meterVolume: readNumber(row.meterVolume) ?? 0,
    recordedAt: recordedAt ?? '',
    createdAt: fixtureIso(row.createdAt) ?? recordedAt ?? '',
    operatorId: operatorId === '' ? null : operatorId,
    reportedCash: readNumber(row.reportedCash),
    expectedRevenue: readNumber(row.expectedRevenue),
    variance: readNumber(row.variance),
    isAnomaly: readBoolean(row.isAnomaly),
    proofImageUrl: proofImageUrl === '' ? null : proofImageUrl,
    waterType: waterType === '' ? null : waterType,
    isSynced: readBoolean(row.isSynced),
    acceptedAt: fixtureIso(row.acceptedAt),
  };
}

function inspectionFromRow(row: FixtureRow): LogInspection {
  const stored = readText(row.storedChecksum);
  const recomputed = readText(row.recomputedChecksum);
  return {
    log: toInspectedLog(row),
    verification: {
      status: toVerificationStatus(row.verificationStatus),
      algorithm: 'SHA-256',
      format: toChecksumFormat(row.checksumFormat),
      storedChecksum: stored === '' ? null : stored,
      recomputedChecksum: recomputed === '' ? null : recomputed,
      verifiedAt: fixtureIso(row.verifiedAt) ?? fixtureIso(row.recordedAt) ?? '',
    },
  };
}

/** A record without its own inspection row is presented as VERIFIED. */
function synthesisedInspection(row: FixtureRow): LogInspection {
  const log = toInspectedLog(row);
  const checksum = demoDigest(`stored:${log.id}`);
  return {
    log,
    verification: {
      status: 'VERIFIED',
      algorithm: 'SHA-256',
      format: 'v1',
      storedChecksum: checksum,
      recomputedChecksum: checksum,
      verifiedAt: log.recordedAt,
    },
  };
}

export interface MockInspectionSources {
  reconciliation: readonly FixtureRow[];
  logs: readonly FixtureRow[];
  inspection: readonly FixtureRow[];
}

function matchesLogId(row: FixtureRow, logId: string): boolean {
  return readText(row.id) === logId || readText(row.transactionId) === logId;
}

/**
 * The inspection payload for `logId`: an explicit inspection row wins, then the
 * reconciliation record, then the historical-log row, otherwise null (the modal
 * shows its normal error state).
 */
export function buildMockInspection(
  logId: string,
  sources: MockInspectionSources
): LogInspection | null {
  const override = sources.inspection.find((row) => matchesLogId(row, logId));
  if (override) return inspectionFromRow(override);

  const record = sources.reconciliation.find((row) => matchesLogId(row, logId));
  if (record) return synthesisedInspection(record);

  const log = sources.logs.find((row) => matchesLogId(row, logId));
  if (log) {
    const recordedAt = fixtureIso(log.recordedAt);
    return synthesisedInspection({
      ...log,
      operatorId: '',
      reportedCash: null,
      expectedRevenue: null,
      variance: null,
      isAnomaly: false,
      createdAt: recordedAt ?? '',
    });
  }

  return null;
}

/* ---------- operator page ---------- */

export function selectQueuePayloads(rows: readonly FixtureRow[]): TransactionPayload[] {
  return rows.map((row) => {
    const recordedAt = fixtureIso(row.recorded_at);
    const evidencePending = readBoolean(row.evidence_pending);
    const operatorId = readText(row.operator_id);
    const reportedCash = readNumber(row.reported_cash);
    return {
      transaction_id: readText(row.transaction_id),
      kiosk_id: readText(row.kiosk_id),
      meter_volume: readNumber(row.meter_volume) ?? 0,
      recorded_at: recordedAt ?? readText(row.recorded_at),
      ...(operatorId === '' ? {} : { operator_id: operatorId }),
      ...(reportedCash === null ? {} : { reported_cash: reportedCash }),
      ...(evidencePending ? { evidence_pending: true } : {}),
    };
  });
}

export function selectReceipts(rows: readonly FixtureRow[]): SignedReceipt[] {
  const fallbackStamp = new Date(0).toISOString();
  return rows.map((row) => {
    const proofImageUrl = readText(row.proofImageUrl);
    const evidencePath = readText(row.evidencePath);
    return {
      receiptId: readText(row.receiptId),
      transactionId: readText(row.transactionId),
      kioskId: readText(row.kioskId),
      operatorId: readText(row.operatorId),
      meterVolume: readNumber(row.meterVolume) ?? 0,
      reportedCash: readNumber(row.reportedCash) ?? 0,
      recordedAt: fixtureIso(row.recordedAt) ?? fallbackStamp,
      checksum: readText(row.checksum),
      hash: readText(row.hash),
      signature: readText(row.signature),
      algorithm: 'SHA-256',
      issuedAt: fixtureIso(row.issuedAt) ?? fallbackStamp,
      signedAt: fixtureIso(row.signedAt) ?? fallbackStamp,
      ...(proofImageUrl === '' ? {} : { proofImageUrl }),
      ...(evidencePath === '' ? {} : { evidencePath }),
    };
  });
}

export interface MockKioskStatus {
  kioskId: string;
  isOnline: boolean;
  connection: 'connected' | 'retrying' | 'dropped';
  pingStatus: 'idle' | 'ok' | 'failed';
  lastPingTime: string | null;
}

const CONNECTIONS: readonly MockKioskStatus['connection'][] = ['connected', 'retrying', 'dropped'];
const PING_STATUSES: readonly MockKioskStatus['pingStatus'][] = ['idle', 'ok', 'failed'];

export function selectKioskStatus(row: FixtureRow | undefined): MockKioskStatus | null {
  if (!row) return null;
  const connection = readText(row.connection) as MockKioskStatus['connection'];
  const pingStatus = readText(row.pingStatus) as MockKioskStatus['pingStatus'];
  const lastPingTime = readText(row.lastPingTime);
  return {
    kioskId: readText(row.kioskId),
    isOnline: readBoolean(row.isOnline),
    connection: CONNECTIONS.includes(connection) ? connection : 'connected',
    pingStatus: PING_STATUSES.includes(pingStatus) ? pingStatus : 'ok',
    lastPingTime: lastPingTime === '' ? null : lastPingTime,
  };
}

export interface MockNotice {
  kind: 'success' | 'warning' | 'error';
  text: string;
}

export function selectNotice(row: FixtureRow | undefined): MockNotice | null {
  if (!row) return null;
  const text = readText(row.text);
  if (text === '') return null;
  const kind = readText(row.kind) as MockNotice['kind'];
  return {
    kind: kind === 'warning' || kind === 'error' ? kind : 'success',
    text,
  };
}

/* ---------- stakeholder analytics ---------- */

export function selectStakeholderAnalytics(
  row: FixtureRow | undefined,
  fallbackMonth: string
): StakeholderAnalytics | null {
  if (!row) return null;
  const month = readText(row.month);
  return {
    month: month === '' ? fallbackMonth : month,
    summaryCards: {
      totalGrossRevenue: readNumber(row.totalGrossRevenue) ?? 0,
      outstandingUncollectedCash: readNumber(row.outstandingUncollectedCash) ?? 0,
      waterLossPercentage: readNumber(row.waterLossPercentage) ?? 0,
    },
    socialAssistanceChart: {
      subsidizedVolumeLiters: readNumber(row.subsidizedVolumeLiters) ?? 0,
      commercialSalesVolumeLiters: readNumber(row.commercialSalesVolumeLiters) ?? 0,
    },
  };
}
