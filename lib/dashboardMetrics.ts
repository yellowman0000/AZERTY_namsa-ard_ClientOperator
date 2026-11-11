/**
 * Dashboard metrics for the manager metrics views (Story 06).
 *
 * The server applies the `startDate`/`endDate` filter; this module turns the
 * filtered reconciliation records into daily buckets so the metrics table and
 * the charts are always fed by the same filtered dataset. Days are the
 * manager's local calendar days, matching the preset intervals in
 * `lib/dateRange.ts`, so a dashboard opened in Asia/Bangkok does not show
 * yesterday's records under "Today".
 *
 * Everything here is pure so the aggregation and the chart geometry can be
 * unit tested without a DOM.
 */
import { toDateInputValue } from './dateRange';
import {
  isRevenueShortfall,
  isVolumeAnomaly,
  type ReconciliationRecord,
} from './reconciliation';

/** Totals for one local calendar day of filtered records. */
export interface DailyMetrics {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  recordCount: number;
  anomalyCount: number;
  shortfallCount: number;
  meterVolume: number;
  expectedRevenue: number;
  reportedCash: number;
  variance: number;
}

/** Column totals across every day in the filtered range. */
export type DashboardTotals = Omit<DailyMetrics, 'date'>;

export interface DashboardMetrics {
  /** Days with at least one record, ascending by date (charts read left to right). */
  days: DailyMetrics[];
  totals: DashboardTotals;
  /** Records whose `recordedAt` could not be interpreted; never silently summed. */
  skippedRecords: number;
  /** Rounded axis maximum for the volume chart (0 when there is no volume). */
  axisMaxMeterVolume: number;
  /** Rounded axis maximum for the revenue chart (0 when there is no revenue). */
  axisMaxRevenue: number;
}

export interface ChartBar {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GroupedChartBar extends ChartBar {
  /** Index of the day whose values this bar belongs to. */
  groupIndex: number;
  /** Index of the series inside the day's group (0 = expected, 1 = reported). */
  seriesIndex: number;
}

/** A record counts when its `recordedAt` parses; it is never dropped silently. */
export function localDayKey(recordedAt: string): string | null {
  const date = new Date(recordedAt);
  if (Number.isNaN(date.getTime())) return null;
  return toDateInputValue(date);
}

function emptyDay(date: string): DailyMetrics {
  return {
    date,
    recordCount: 0,
    anomalyCount: 0,
    shortfallCount: 0,
    meterVolume: 0,
    expectedRevenue: 0,
    reportedCash: 0,
    variance: 0,
  };
}

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Buckets the filtered reconciliation records by local calendar day.
 *
 * Records with an unparseable `recordedAt` are counted in `skippedRecords`
 * instead of being folded into an arbitrary day. Nullable metrics
 * (`reportedCash`, `expectedRevenue`, `variance`) contribute only when they are
 * finite, so the totals never become `NaN`.
 */
export function buildDashboardMetrics(
  records: ReconciliationRecord[]
): DashboardMetrics {
  const buckets = new Map<string, DailyMetrics>();
  let skippedRecords = 0;

  for (const record of records) {
    const dayKey = localDayKey(record.recordedAt);
    if (dayKey === null) {
      skippedRecords += 1;
      continue;
    }

    const day = buckets.get(dayKey) ?? emptyDay(dayKey);
    day.recordCount += 1;
    if (isVolumeAnomaly(record)) day.anomalyCount += 1;
    if (isRevenueShortfall(record)) day.shortfallCount += 1;
    day.meterVolume += finiteOrZero(record.meterVolume);
    day.expectedRevenue += finiteOrZero(record.expectedRevenue);
    day.reportedCash += finiteOrZero(record.reportedCash);
    day.variance += finiteOrZero(record.variance);
    buckets.set(dayKey, day);
  }

  // `YYYY-MM-DD` sorts lexicographically, which is chronological.
  const days = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));

  const totals: DashboardTotals = {
    recordCount: 0,
    anomalyCount: 0,
    shortfallCount: 0,
    meterVolume: 0,
    expectedRevenue: 0,
    reportedCash: 0,
    variance: 0,
  };
  for (const day of days) {
    totals.recordCount += day.recordCount;
    totals.anomalyCount += day.anomalyCount;
    totals.shortfallCount += day.shortfallCount;
    totals.meterVolume += day.meterVolume;
    totals.expectedRevenue += day.expectedRevenue;
    totals.reportedCash += day.reportedCash;
    totals.variance += day.variance;
  }

  const maxDailyVolume = days.reduce((max, day) => Math.max(max, day.meterVolume), 0);
  const maxDailyRevenue = days.reduce(
    (max, day) => Math.max(max, day.expectedRevenue, day.reportedCash),
    0
  );

  return {
    days,
    totals,
    skippedRecords,
    axisMaxMeterVolume: chartAxisMax(maxDailyVolume),
    axisMaxRevenue: chartAxisMax(maxDailyRevenue),
  };
}

/**
 * Rounds a chart's axis maximum up to a readable value (0 stays 0).
 * 0 → 0, 850 → 1000, 1200 → 1200, 1250 → 1500.
 */
export function chartAxisMax(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const normalized = value / magnitude;
  // Prefer a tick that leaves only a little headroom above the tallest bar.
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const step = steps.find((candidate) => candidate >= normalized) ?? 10;
  return step * magnitude;
}

/**
 * Bar rectangles for a single series inside `width` × `height`.
 * Every bar grows from the `height` baseline; zero values have zero height.
 */
export function barLayout(
  values: number[],
  max: number,
  width: number,
  height: number,
  gapRatio = 0.24
): ChartBar[] {
  if (values.length === 0 || width <= 0 || height <= 0) return [];
  const slot = width / values.length;
  const barWidth = slot * (1 - gapRatio);

  return values.map((value, index) => {
    const safeValue = Number.isFinite(value) ? Math.max(value, 0) : 0;
    const ratio = max > 0 ? Math.min(safeValue / max, 1) : 0;
    const barHeight = ratio * height;
    return {
      x: index * slot + (slot - barWidth) / 2,
      y: height - barHeight,
      width: barWidth,
      height: barHeight,
    };
  });
}

/**
 * Side-by-side bars per day (two or more series sharing one group slot), used
 * by the expected-vs-reported revenue chart.
 *
 * `groups[dayIndex][seriesIndex]` is one value; all `max` scaling is shared so
 * the series are comparable.
 */
export function groupedBarLayout(
  groups: number[][],
  max: number,
  width: number,
  height: number,
  groupGapRatio = 0.28
): GroupedChartBar[] {
  if (groups.length === 0 || width <= 0 || height <= 0) return [];
  const seriesCount = Math.max(1, ...groups.map((group) => group.length));
  const slot = width / groups.length;
  const groupWidth = slot * (1 - groupGapRatio);
  const innerGapRatio = 0.18;
  const barWidth =
    seriesCount > 1
      ? (groupWidth / seriesCount) * (1 - innerGapRatio)
      : groupWidth;

  const bars: GroupedChartBar[] = [];
  const subSlot = groupWidth / seriesCount;
  groups.forEach((group, groupIndex) => {
    const groupStart = groupIndex * slot + (slot - groupWidth) / 2;
    group.forEach((value, seriesIndex) => {
      const safeValue = Number.isFinite(value) ? Math.max(value, 0) : 0;
      const ratio = max > 0 ? Math.min(safeValue / max, 1) : 0;
      const barHeight = ratio * height;
      bars.push({
        x: groupStart + seriesIndex * subSlot + (subSlot - barWidth) / 2,
        y: height - barHeight,
        width: barWidth,
        height: barHeight,
        groupIndex,
        seriesIndex,
      });
    });
  });
  return bars;
}

const MONTH_ABBREVIATIONS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * "2026-11-07" → "Nov 7". Parsed from the parts so the label never shifts a
 * day in a UTC-negative timezone.
 */
export function formatDayLabel(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const month = MONTH_ABBREVIATIONS[Number(match[2]) - 1];
  return month ? `${month} ${Number(match[3])}` : date;
}

/** Every Nth x-axis label so dense ranges stay readable (1 when they already fit). */
export function labelStep(count: number, maxLabels = 8): number {
  if (!Number.isFinite(count) || count <= maxLabels) return 1;
  return Math.ceil(count / maxLabels);
}

/** Compact deterministic numbers for axis labels: 0 → "0", 1500 → "1.5k". */
export function formatCompactValue(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  const trim = (number: number, digits: number) =>
    number
      .toFixed(digits)
      .replace(/\.0+$/, '')
      .replace(/(\.\d*?)0+$/, '$1');
  if (absolute >= 1_000_000) return `${sign}${trim(absolute / 1_000_000, 1)}M`;
  if (absolute >= 1000) return `${sign}${trim(absolute / 1000, 1)}k`;
  if (absolute >= 100) return `${sign}${trim(absolute, 0)}`;
  return `${sign}${trim(absolute, 1)}`;
}
