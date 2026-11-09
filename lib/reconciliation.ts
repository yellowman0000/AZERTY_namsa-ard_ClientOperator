/**
 * Operations Review data for Operation Managers (Story 04: Interpret Data).
 *
 * Reads the server's reconciliation view — `GET /api/kiosk/reconciliation` —
 * which returns every daily log together with the metrics the reconciliation
 * engine stores on it:
 *
 *   expectedRevenue = meterVolume × unit price
 *   variance        = reportedCash − expectedRevenue
 *   isAnomaly       = the server's anomaly classification for the record
 *
 * The anomaly rule itself belongs to the server (it is stored on each log);
 * this view never recomputes it, so the wording here stays correct if the rule
 * changes.
 */
import { getJson } from './logs';

export const RECONCILIATION_PATH = '/api/kiosk/reconciliation';

export interface ReconciliationRecord {
  id: string;
  transactionId: string;
  kioskId: string;
  operatorId: string | null;
  meterVolume: number;
  reportedCash: number | null;
  expectedRevenue: number | null;
  variance: number | null;
  /** Server-side anomaly classification flag for the record. */
  isAnomaly: boolean;
  proofImageUrl?: string | null;
  waterType?: string;
  isReadByManager?: boolean;
  recordedAt: string;
  createdAt?: string | null;
}

export interface ReconciliationQuery {
  kioskId?: string;
  isAnomaly?: boolean;
  startDate?: string;
  endDate?: string;
}

export interface ReconciliationPage {
  count: number;
  records: ReconciliationRecord[];
}

export type ReviewFlag = 'anomaly' | 'shortfall';

/** `critical` = revenue shortfall, `warning` = volume anomaly only, `clear` = nothing to triage. */
export type ReviewTone = 'critical' | 'warning' | 'clear';

export interface ReviewSummary {
  total: number;
  anomalyCount: number;
  shortfallCount: number;
  flaggedCount: number;
  netVariance: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function buildUrl(query: ReconciliationQuery): string {
  const params = new URLSearchParams();

  const kioskId = query.kioskId?.trim();
  if (kioskId) params.set('kioskId', kioskId);
  // "false" is a meaningful filter, so compare against undefined only.
  if (query.isAnomaly !== undefined) params.set('isAnomaly', String(query.isAnomaly));
  if (query.startDate) params.set('startDate', query.startDate);
  if (query.endDate) params.set('endDate', query.endDate);

  const search = params.toString();
  return search ? `${RECONCILIATION_PATH}?${search}` : RECONCILIATION_PATH;
}

/** Every interpreted record, newest first, plus the server's own count. */
export async function fetchReconciliation(
  query: ReconciliationQuery = {},
  signal?: AbortSignal
): Promise<ReconciliationPage> {
  const body = await getJson<unknown>(buildUrl(query), signal);

  if (!isRecord(body) || !Array.isArray(body.records)) {
    throw new Error('The reconciliation response did not contain a list of records.');
  }

  const records = body.records as ReconciliationRecord[];
  return {
    count:
      typeof body.count === 'number' && Number.isFinite(body.count)
        ? body.count
        : records.length,
    records,
  };
}

/* ---------- Triage rules ---------- */

/** The server's anomaly classification flag; the rule behind it is not re-derived here. */
export function isVolumeAnomaly(record: Pick<ReconciliationRecord, 'isAnomaly'>): boolean {
  return record.isAnomaly === true;
}

/** `variance < 0` means reported cash came in below the expected revenue. */
export function isRevenueShortfall(record: Pick<ReconciliationRecord, 'variance'>): boolean {
  return hasFiniteNumber(record.variance) && record.variance < 0;
}

export function getReviewFlags(record: ReconciliationRecord): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  if (isVolumeAnomaly(record)) flags.push('anomaly');
  if (isRevenueShortfall(record)) flags.push('shortfall');
  return flags;
}

/**
 * Cash that came up short is the most urgent thing on the table, so a negative
 * variance is `critical` on its own; a volume anomaly without a shortfall is a
 * `warning`. A row can carry both badges — the tone only decides the highlight.
 */
export function getReviewTone(record: ReconciliationRecord): ReviewTone {
  if (isRevenueShortfall(record)) return 'critical';
  return isVolumeAnomaly(record) ? 'warning' : 'clear';
}

/**
 * Variance as a share of the expected revenue (−0.05 = 5% short). Null when the
 * expected revenue is missing or zero, because no meaningful ratio exists then.
 */
export function getVarianceRatio(
  record: Pick<ReconciliationRecord, 'variance' | 'expectedRevenue'>
): number | null {
  if (!hasFiniteNumber(record.expectedRevenue) || record.expectedRevenue === 0) return null;
  if (!hasFiniteNumber(record.variance)) return null;
  return record.variance / record.expectedRevenue;
}

/** Header-card numbers for the review table. Records without a usable variance are skipped. */
export function summarizeReconciliation(records: ReconciliationRecord[]): ReviewSummary {
  let anomalyCount = 0;
  let shortfallCount = 0;
  let flaggedCount = 0;
  let netVariance = 0;

  for (const record of records) {
    const flags = getReviewFlags(record);
    if (flags.includes('anomaly')) anomalyCount += 1;
    if (flags.includes('shortfall')) shortfallCount += 1;
    if (flags.length > 0) flaggedCount += 1;
    if (hasFiniteNumber(record.variance)) netVariance += record.variance;
  }

  return {
    total: records.length,
    anomalyCount,
    shortfallCount,
    flaggedCount,
    netVariance,
  };
}
