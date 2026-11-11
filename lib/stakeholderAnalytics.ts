/**
 * Stakeholder analytics client (Story 09).
 *
 * Reads the monthly aggregation endpoint from the Sprint 2 data contract:
 *
 *   GET /api/kiosk/analytics/stakeholder?month=YYYY-MM
 *   {
 *     "month": "2026-10",
 *     "summaryCards": {
 *       "totalGrossRevenue": 45000.0,
 *       "outstandingUncollectedCash": 1250.0,
 *       "waterLossPercentage": 2.78
 *     },
 *     "socialAssistanceChart": {
 *       "subsidizedVolumeLiters": 8500.0,
 *       "commercialSalesVolumeLiters": 22500.0
 *     }
 *   }
 *
 * The aggregation itself is the server's job; this module only builds the URL,
 * validates the payload, and turns the two chart pairs into comparison data.
 * Everything here is pure except `fetchStakeholderAnalytics`, so it is unit
 * tested without a DOM.
 */
import { getJson } from './logs';

export const STAKEHOLDER_ANALYTICS_PATH = '/api/kiosk/analytics/stakeholder';

export interface StakeholderSummary {
  totalGrossRevenue: number;
  outstandingUncollectedCash: number;
  waterLossPercentage: number;
}

export interface SocialAssistanceChartData {
  subsidizedVolumeLiters: number;
  commercialSalesVolumeLiters: number;
}

export interface StakeholderAnalytics {
  /** Requested month, `YYYY-MM`. */
  month: string;
  summaryCards: StakeholderSummary;
  socialAssistanceChart: SocialAssistanceChartData;
}

/** One column of a side-by-side comparison chart. */
export interface StakeholderComparisonDatum {
  key: string;
  label: string;
  value: number;
  /** Share of the pair's total (0…1); 0 when both values are zero. */
  share: number;
  tone: 'spring' | 'aqua' | 'amber';
}

const MONTH_KEY = /^(\d{4})-(\d{2})$/;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `YYYY-MM` for "now" in the viewer's local timezone. */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function isMonthKey(value: string): boolean {
  const match = MONTH_KEY.exec(value.trim());
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/** "2026-10" → "October 2026" (locale-independent for stable tests). */
export function formatMonthLabel(month: string): string {
  const match = MONTH_KEY.exec(month.trim());
  if (!match) return month;
  const name = MONTH_NAMES[Number(match[2]) - 1];
  return name ? `${name} ${match[1]}` : month;
}

export function buildStakeholderAnalyticsUrl(month: string): string {
  const params = new URLSearchParams({ month: month.trim() });
  return `${STAKEHOLDER_ANALYTICS_PATH}?${params.toString()}`;
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      `The stakeholder analytics response is missing the ${field} object.`
    );
  }
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `The stakeholder analytics response has an invalid ${field}.`
    );
  }
  return value;
}

/**
 * Validates a raw endpoint body. A malformed answer fails with a readable
 * message instead of rendering `NaN` cards.
 */
export function parseStakeholderAnalytics(body: unknown): StakeholderAnalytics {
  const root = asRecord(body, 'root');

  const month = typeof root.month === 'string' ? root.month.trim() : '';
  if (!isMonthKey(month)) {
    throw new Error(
      'The stakeholder analytics response is missing a valid month.'
    );
  }

  const summary = asRecord(root.summaryCards, 'summaryCards');
  const chart = asRecord(root.socialAssistanceChart, 'socialAssistanceChart');

  return {
    month,
    summaryCards: {
      totalGrossRevenue: finiteNumber(
        summary.totalGrossRevenue,
        'summaryCards.totalGrossRevenue'
      ),
      outstandingUncollectedCash: finiteNumber(
        summary.outstandingUncollectedCash,
        'summaryCards.outstandingUncollectedCash'
      ),
      waterLossPercentage: finiteNumber(
        summary.waterLossPercentage,
        'summaryCards.waterLossPercentage'
      ),
    },
    socialAssistanceChart: {
      subsidizedVolumeLiters: finiteNumber(
        chart.subsidizedVolumeLiters,
        'socialAssistanceChart.subsidizedVolumeLiters'
      ),
      commercialSalesVolumeLiters: finiteNumber(
        chart.commercialSalesVolumeLiters,
        'socialAssistanceChart.commercialSalesVolumeLiters'
      ),
    },
  };
}

/** Monthly stakeholder analytics for one `YYYY-MM` month. */
export async function fetchStakeholderAnalytics(
  month: string,
  signal?: AbortSignal
): Promise<StakeholderAnalytics> {
  if (!isMonthKey(month)) {
    throw new Error('Choose a month in YYYY-MM format.');
  }
  const body = await getJson<unknown>(buildStakeholderAnalyticsUrl(month), signal);
  return parseStakeholderAnalytics(body);
}

/** Shares of a pair's total; zero values and a zero total stay at 0. */
export function comparisonShares(values: number[]): number[] {
  const total = values.reduce(
    (sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0),
    0
  );
  return values.map((value) =>
    total > 0 && Number.isFinite(value) && value > 0 ? value / total : 0
  );
}

/** Subsidized vs commercial dispensed volume for the Social Assistance tab. */
export function buildSocialAssistanceComparison(
  chart: SocialAssistanceChartData
): StakeholderComparisonDatum[] {
  const values = [chart.subsidizedVolumeLiters, chart.commercialSalesVolumeLiters];
  const shares = comparisonShares(values);

  return [
    {
      key: 'subsidized',
      label: 'Subsidized',
      value: values[0],
      share: shares[0],
      tone: 'aqua',
    },
    {
      key: 'commercial',
      label: 'Commercial',
      value: values[1],
      share: shares[1],
      tone: 'spring',
    },
  ];
}

/** Gross revenue vs outstanding uncollected cash for the Overview tab. */
export function buildCashComparison(
  summary: StakeholderSummary
): StakeholderComparisonDatum[] {
  const values = [summary.totalGrossRevenue, summary.outstandingUncollectedCash];
  const shares = comparisonShares(values);

  return [
    {
      key: 'gross-revenue',
      label: 'Gross revenue',
      value: values[0],
      share: shares[0],
      tone: 'spring',
    },
    {
      key: 'uncollected-cash',
      label: 'Uncollected cash',
      value: values[1],
      share: shares[1],
      tone: 'amber',
    },
  ];
}

/** Largest value in a comparison, for chart scaling (never negative). */
export function comparisonMax(
  data: StakeholderComparisonDatum[]
): number {
  return data.reduce(
    (max, datum) =>
      Number.isFinite(datum.value) ? Math.max(max, datum.value) : max,
    0
  );
}
