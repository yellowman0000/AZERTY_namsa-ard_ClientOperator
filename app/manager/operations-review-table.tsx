'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EMPTY_RANGE,
  describeRange,
  presetRange,
  rangeToQuery,
  validateDateRange,
  type DateRange,
  type PresetKey,
} from '../../lib/dateRange';
import { DateRangeFilter } from './date-range-filter';
import { ReportMenu } from './report-menu';
import { downloadReport, type ReportFormat } from '../../lib/reports';
import {
  fetchReconciliation,
  getReviewFlags,
  getReviewTone,
  getVarianceRatio,
  hasFiniteNumber,
  summarizeReconciliation,
  type ReconciliationRecord,
  type ReviewFlag,
  type ReviewSummary,
} from '../../lib/reconciliation';
import {
  formatAmount,
  formatDateTime,
  formatLiters,
  formatPercent,
  formatSignedAmount,
} from './format';

const FLAG_BADGES: Record<ReviewFlag, { className: string; label: string; detail: string }> = {
  anomaly: {
    className: 'review-badge review-badge-anomaly',
    label: 'Flagged anomaly',
    detail: 'The server flagged this record as an anomaly.',
  },
  shortfall: {
    className: 'review-badge review-badge-shortfall',
    label: 'Revenue shortfall',
    detail: 'Reported cash is below the expected revenue (variance < 0).',
  },
};

const EMPTY_MESSAGE = 'No reconciliation records to review.';
const EMPTY_FLAGGED_MESSAGE = 'No records are flagged right now.';

/** The endpoint has no pagination; render the newest records and say so. */
export const REVIEW_DISPLAY_LIMIT = 200;

function Missing({ label }: { label: string }) {
  return (
    <span className="review-missing" aria-label={`${label} not recorded`}>
      —
    </span>
  );
}

function varianceClassName(value: number) {
  if (value < 0) return 'review-variance-negative';
  if (value > 0) return 'review-variance-positive';
  return undefined;
}

function rowClassName(record: ReconciliationRecord) {
  const tone = getReviewTone(record);
  if (tone === 'critical') return 'review-row review-row-critical';
  if (tone === 'warning') return 'review-row review-row-warning';
  return 'review-row';
}

/** Warning badges for one row; a row with nothing to triage says so explicitly. */
export function ReviewBadges({ record }: { record: ReconciliationRecord }) {
  const flags = getReviewFlags(record);

  if (flags.length === 0) {
    return <span className="review-badge review-badge-clear">Clear</span>;
  }

  return (
    <>
      {flags.map((flag) => (
        <span
          key={flag}
          className={FLAG_BADGES[flag].className}
          title={FLAG_BADGES[flag].detail}
        >
          {FLAG_BADGES[flag].label}
        </span>
      ))}
    </>
  );
}

/**
 * The Operations Review table. Rows the server flagged as anomalous
 * (`isAnomaly === true`) or where the reported cash is short of the expected
 * revenue (`variance < 0`) are highlighted and carry warning badges.
 */
export function ReviewTable({
  records,
  emptyMessage = EMPTY_MESSAGE,
  displayLimit = REVIEW_DISPLAY_LIMIT,
}: {
  records: ReconciliationRecord[];
  emptyMessage?: string;
  displayLimit?: number;
}) {
  if (records.length === 0) {
    return <p className="logs-message">{emptyMessage}</p>;
  }

  const shown = displayLimit > 0 ? records.slice(0, displayLimit) : records;
  const truncated = shown.length < records.length;

  return (
    <>
      {truncated && (
        <p className="logs-message review-note" role="status">
          Showing the newest {shown.length} of {records.length} matching records.
        </p>
      )}
      <div className="logs-table-wrap">
        <table className="logs-table review-table">
          <caption className="visually-hidden">
            Reconciliation review: daily logs with expected revenue, reported cash, variance and
            anomaly flags, newest first
          </caption>
          <thead>
            <tr>
              <th scope="col">Recorded at</th>
              <th scope="col">Kiosk</th>
              <th scope="col">Operator</th>
              <th scope="col" className="logs-num">
                Meter volume
              </th>
              <th scope="col" className="logs-num">
                Reported cash
              </th>
              <th scope="col" className="logs-num">
                Expected revenue
              </th>
              <th scope="col" className="logs-num">
                Variance
              </th>
              <th scope="col" className="logs-num">
                Variance %
              </th>
              <th scope="col">Triage</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((record) => {
              const ratio = getVarianceRatio(record);

              return (
                <tr key={record.id} className={rowClassName(record)}>
                  <td>
                    <time dateTime={record.recordedAt}>{formatDateTime(record.recordedAt)}</time>
                  </td>
                  <td>{record.kioskId}</td>
                  <td>{record.operatorId ? record.operatorId : <Missing label="Operator" />}</td>
                  <td className="logs-num">{formatLiters(record.meterVolume)}</td>
                  <td className="logs-num">
                    {hasFiniteNumber(record.reportedCash) ? (
                      formatAmount(record.reportedCash)
                    ) : (
                      <Missing label="Reported cash" />
                    )}
                  </td>
                  <td className="logs-num">
                    {hasFiniteNumber(record.expectedRevenue) ? (
                      formatAmount(record.expectedRevenue)
                    ) : (
                      <Missing label="Expected revenue" />
                    )}
                  </td>
                  <td className="logs-num">
                    {hasFiniteNumber(record.variance) ? (
                      <span className={varianceClassName(record.variance)}>
                        {formatSignedAmount(record.variance)}
                      </span>
                    ) : (
                      <Missing label="Variance" />
                    )}
                  </td>
                  <td className="logs-num">
                    {ratio === null ? (
                      <Missing label="Variance percentage" />
                    ) : (
                      <span className={varianceClassName(ratio)}>{formatPercent(ratio)}</span>
                    )}
                  </td>
                  <td className="review-triage">
                    <ReviewBadges record={record} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Header cards: how much needs triage at a glance. */
export function ReviewSummaryCards({ summary }: { summary: ReviewSummary }) {
  const netTone =
    summary.netVariance < 0
      ? ' review-summary-card-negative'
      : summary.netVariance > 0
        ? ' review-summary-card-positive'
        : '';

  return (
    <div className="review-summary" role="group" aria-label="Reconciliation summary">
      <div className="review-summary-card">
        <span className="review-summary-label">Records reviewed</span>
        <strong>{summary.total}</strong>
        <span className="review-summary-hint">{summary.flaggedCount} need triage</span>
      </div>
      <div className="review-summary-card review-summary-card-warn">
        <span className="review-summary-label">Flagged anomalies</span>
        <strong>{summary.anomalyCount}</strong>
        <span className="review-summary-hint">flagged by the server</span>
      </div>
      <div className="review-summary-card review-summary-card-alert">
        <span className="review-summary-label">Revenue variance alerts</span>
        <strong>{summary.shortfallCount}</strong>
        <span className="review-summary-hint">cash below expected revenue</span>
      </div>
      <div className={`review-summary-card${netTone}`}>
        <span className="review-summary-label">Net variance</span>
        <strong>{formatSignedAmount(summary.netVariance)}</strong>
        <span className="review-summary-hint">reported cash − expected revenue</span>
      </div>
    </div>
  );
}

/**
 * Read-only Operations Review for Operation Managers. Reads the server's
 * reconciliation view; the data is interpreted on the server, so this view
 * only decides what to highlight and never recalculates the flags itself.
 */
export default function OperationsReview() {
  const [records, setRecords] = useState<ReconciliationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [preset, setPreset] = useState<PresetKey>('all');
  const [range, setRange] = useState<DateRange>(EMPTY_RANGE);
  const [appliedRange, setAppliedRange] = useState<DateRange>(EMPTY_RANGE);
  const [reportOpen, setReportOpen] = useState(false);
  const [exporting, setExporting] = useState<ReportFormat | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  // Inline error for the custom pickers; a non-null value also blocks Apply.
  const rangeError = useMemo(() => validateDateRange(range), [range]);

  useEffect(() => {
    const controller = new AbortController();
    fetchReconciliation(rangeToQuery(appliedRange), controller.signal)
      .then((page) => {
        setRecords(page.records);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setRecords([]);
        setError(
          err instanceof Error ? err.message : 'Could not load reconciliation records.'
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt, appliedRange]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  const applyPreset = useCallback((key: Exclude<PresetKey, 'custom'>) => {
    const next = presetRange(key);
    setLoading(true);
    setPreset(key);
    setRange(next);
    setAppliedRange(next);
  }, []);

  const changeRange = useCallback((field: keyof DateRange, value: string) => {
    setPreset('custom');
    setRange((current) => ({ ...current, [field]: value }));
  }, []);

  const applyRange = useCallback(() => {
    if (validateDateRange(range) !== null) return;
    setLoading(true);
    setAppliedRange(range);
  }, [range]);

  const exportReport = useCallback(
    async (format: ReportFormat) => {
      setReportOpen(false);
      setReportError(null);
      setExporting(format);
      try {
        await downloadReport(format, appliedRange);
      } catch (err: unknown) {
        setReportError(
          err instanceof Error ? err.message : 'Could not download the report.'
        );
      } finally {
        setExporting(null);
      }
    },
    [appliedRange]
  );

  const visibleRecords = useMemo(
    () => (flaggedOnly ? records.filter((record) => getReviewFlags(record).length > 0) : records),
    [records, flaggedOnly]
  );
  const summary = useMemo(() => summarizeReconciliation(records), [records]);

  const showSummary = !error && (!loading || records.length > 0);
  const refreshing = loading && records.length > 0;

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
          <Link className="nav-link" href="/manager">
            Historical logs
          </Link>
        </nav>
      </header>

      <section className="operator-dashboard">
        <div className="operator-heading">
          <div>
            <p className="eyebrow">OPERATIONS · TRIAGE</p>
            <h1>Operations review</h1>
            <p className="heading-copy">
              Daily logs checked against expected revenue and the server&apos;s anomaly
              classification. Records the server flagged, and records where reported cash came in
              below the expected revenue, are highlighted for triage.
            </p>
          </div>
        </div>

        {showSummary && <ReviewSummaryCards summary={summary} />}

        <section className="logs-card" aria-labelledby="review-title">
          <div className="logs-card-heading">
            <h2 id="review-title">Reconciliation records</h2>
            <span className="logs-count">
              {visibleRecords.length} of {records.length}{' '}
              {records.length === 1 ? 'record' : 'records'} shown · {describeRange(appliedRange)}
            </span>
          </div>

          <DateRangeFilter
            preset={preset}
            range={range}
            error={rangeError}
            disabled={loading}
            onPreset={applyPreset}
            onRangeChange={changeRange}
            onApply={applyRange}
          />

          <div className="review-controls">
            <label className="review-filter">
              <input
                type="checkbox"
                checked={flaggedOnly}
                disabled={records.length === 0}
                onChange={(event) => setFlaggedOnly(event.target.checked)}
              />
              Only flagged records
            </label>
            <div className="review-actions">
              <button
                className="button button-secondary"
                type="button"
                onClick={refresh}
                disabled={loading}
              >
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
              <ReportMenu
                open={reportOpen}
                disabled={rangeError !== null || loading}
                disabledReason={rangeError ?? 'Loading records…'}
                exporting={exporting}
                onToggle={() => setReportOpen((open) => !open)}
                onExport={exportReport}
              />
            </div>
          </div>

          {reportError && (
            <p className="review-range-error" role="alert">
              Could not generate the report. {reportError}
            </p>
          )}

          <ul className="review-legend" aria-label="Row highlight legend">
            <li>
              <span className="review-badge review-badge-anomaly">Flagged anomaly</span>
              flagged by the server
            </li>
            <li>
              <span className="review-badge review-badge-shortfall">Revenue shortfall</span>
              reported cash below expected revenue
            </li>
            <li>
              <span className="review-badge review-badge-clear">Clear</span>
              no flag
            </li>
          </ul>

          {error ? (
            <div className="logs-message logs-message-error" role="alert">
              <p>Could not load reconciliation records. {error}</p>
              <button className="button button-secondary" type="button" onClick={refresh}>
                Try again
              </button>
            </div>
          ) : loading && records.length === 0 ? (
            <p className="logs-message" role="status">
              Loading reconciliation records…
            </p>
          ) : (
            <ReviewTable
              records={visibleRecords}
              emptyMessage={flaggedOnly ? EMPTY_FLAGGED_MESSAGE : EMPTY_MESSAGE}
            />
          )}
        </section>
      </section>

      <footer className="operator-footer">
        <span>Nam Sa-ard · Operator</span>
        <span>Read-only reconciliation review</span>
      </footer>
    </main>
  );
}
