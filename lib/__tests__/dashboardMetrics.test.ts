import { describe, expect, it } from 'bun:test';
import type { ReconciliationRecord } from '../reconciliation';
import {
  barLayout,
  buildDashboardMetrics,
  chartAxisMax,
  formatCompactValue,
  formatDayLabel,
  groupedBarLayout,
  labelStep,
  localDayKey,
} from '../dashboardMetrics';

function record(overrides: Partial<ReconciliationRecord> = {}): ReconciliationRecord {
  return {
    id: 'log-1',
    transactionId: 'TXN-001',
    kioskId: 'KIOSK-001',
    operatorId: 'OP-104',
    meterVolume: 500,
    reportedCash: 950,
    expectedRevenue: 1000,
    variance: -50,
    isAnomaly: false,
    waterType: 'COMMERCIAL',
    recordedAt: '2026-10-31T10:00:00.000Z',
    createdAt: '2026-10-31T10:00:01.000Z',
    ...overrides,
  };
}

/** ISO string for a local calendar instant, so day keys are timezone-proof. */
function localIso(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month - 1, day, hour, 0, 0, 0).toISOString();
}

describe('localDayKey', () => {
  it('reads a timestamp as the viewer local calendar day', () => {
    expect(localDayKey(localIso(2026, 11, 7))).toBe('2026-11-07');
  });

  it('keeps a late-evening record on the same local day', () => {
    expect(localDayKey(localIso(2026, 11, 7, 23))).toBe('2026-11-07');
    expect(localDayKey(localIso(2026, 11, 8, 0))).toBe('2026-11-08');
  });

  it('returns null when the timestamp cannot be parsed', () => {
    expect(localDayKey('not-a-date')).toBeNull();
    expect(localDayKey('')).toBeNull();
  });
});

describe('buildDashboardMetrics', () => {
  it('returns empty buckets and zero axes for no records', () => {
    const metrics = buildDashboardMetrics([]);

    expect(metrics.days).toEqual([]);
    expect(metrics.totals).toEqual({
      recordCount: 0,
      anomalyCount: 0,
      shortfallCount: 0,
      meterVolume: 0,
      expectedRevenue: 0,
      reportedCash: 0,
      variance: 0,
    });
    expect(metrics.skippedRecords).toBe(0);
    expect(metrics.axisMaxMeterVolume).toBe(0);
    expect(metrics.axisMaxRevenue).toBe(0);
  });

  it('sums records that share a local day', () => {
    const metrics = buildDashboardMetrics([
      record({ id: 'a', recordedAt: localIso(2026, 11, 7, 9) }),
      record({
        id: 'b',
        recordedAt: localIso(2026, 11, 7, 18),
        meterVolume: 250,
        reportedCash: 400,
        expectedRevenue: 500,
        variance: -100,
        isAnomaly: true,
      }),
    ]);

    expect(metrics.days).toHaveLength(1);
    expect(metrics.days[0]).toMatchObject({
      date: '2026-11-07',
      recordCount: 2,
      meterVolume: 750,
      reportedCash: 1350,
      expectedRevenue: 1500,
      variance: -150,
      anomalyCount: 1,
      shortfallCount: 2,
    });
  });

  it('sorts days ascending regardless of the server order', () => {
    const metrics = buildDashboardMetrics([
      record({ id: 'late', recordedAt: localIso(2026, 11, 9) }),
      record({ id: 'early', recordedAt: localIso(2026, 11, 1) }),
      record({ id: 'middle', recordedAt: localIso(2026, 11, 5) }),
    ]);

    expect(metrics.days.map((day) => day.date)).toEqual([
      '2026-11-01',
      '2026-11-05',
      '2026-11-09',
    ]);
  });

  it('counts anomalies and revenue shortfalls independently', () => {
    const metrics = buildDashboardMetrics([
      record({ id: 'anomaly', recordedAt: localIso(2026, 11, 7), isAnomaly: true, variance: 10 }),
      record({ id: 'shortfall', recordedAt: localIso(2026, 11, 7), variance: -5 }),
      record({ id: 'clear', recordedAt: localIso(2026, 11, 7), variance: 0 }),
    ]);

    expect(metrics.totals.anomalyCount).toBe(1);
    expect(metrics.totals.shortfallCount).toBe(1);
    expect(metrics.totals.recordCount).toBe(3);
  });

  it('skips null metrics instead of producing NaN totals', () => {
    const metrics = buildDashboardMetrics([
      record({
        id: 'partial',
        recordedAt: localIso(2026, 11, 7),
        reportedCash: null,
        expectedRevenue: null,
        variance: null,
      }),
      record({ id: 'full', recordedAt: localIso(2026, 11, 7) }),
    ]);

    expect(metrics.days[0].meterVolume).toBe(1000);
    expect(metrics.days[0].expectedRevenue).toBe(1000);
    expect(metrics.days[0].reportedCash).toBe(950);
    expect(metrics.days[0].variance).toBe(-50);
    for (const value of Object.values(metrics.totals)) {
      expect(Number.isNaN(value)).toBe(false);
    }
  });

  it('reports records with an unreadable timestamp instead of dropping them', () => {
    const metrics = buildDashboardMetrics([
      record({ id: 'valid', recordedAt: localIso(2026, 11, 7) }),
      record({ id: 'broken', recordedAt: 'yesterday-ish' }),
    ]);

    expect(metrics.skippedRecords).toBe(1);
    expect(metrics.totals.recordCount).toBe(1);
    expect(metrics.days).toHaveLength(1);
  });

  it('makes totals equal the sum of the daily buckets', () => {
    const metrics = buildDashboardMetrics([
      record({ id: 'a', recordedAt: localIso(2026, 11, 1), meterVolume: 100 }),
      record({ id: 'b', recordedAt: localIso(2026, 11, 2), meterVolume: 200 }),
      record({ id: 'c', recordedAt: localIso(2026, 11, 2), meterVolume: 300, isAnomaly: true }),
    ]);

    const summed = metrics.days.reduce(
      (total, day) => total + day.meterVolume,
      0
    );
    expect(metrics.totals.meterVolume).toBe(summed);
    expect(metrics.totals.recordCount).toBe(3);
  });

  it('derives rounded axis maxima from the largest daily buckets', () => {
    const metrics = buildDashboardMetrics([
      record({
        id: 'big',
        recordedAt: localIso(2026, 11, 7),
        meterVolume: 850,
        expectedRevenue: 1200,
        reportedCash: 1100,
      }),
      record({
        id: 'small',
        recordedAt: localIso(2026, 11, 8),
        meterVolume: 100,
        expectedRevenue: 200,
        reportedCash: 190,
      }),
    ]);

    expect(metrics.axisMaxMeterVolume).toBe(1000);
    expect(metrics.axisMaxRevenue).toBe(1200);
  });
});

describe('chartAxisMax', () => {
  it('returns 0 for missing or non-positive values', () => {
    expect(chartAxisMax(0)).toBe(0);
    expect(chartAxisMax(-50)).toBe(0);
    expect(chartAxisMax(Number.NaN)).toBe(0);
  });

  it('rounds up to a readable maximum', () => {
    expect(chartAxisMax(850)).toBe(1000);
    expect(chartAxisMax(1200)).toBe(1200);
    expect(chartAxisMax(1250)).toBe(1500);
    expect(chartAxisMax(5)).toBe(5);
  });
});

describe('barLayout', () => {
  it('scales bars from the baseline and keeps them inside the plot box', () => {
    const bars = barLayout([0, 50, 100], 100, 300, 100);

    expect(bars).toHaveLength(3);
    for (const bar of bars) {
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(300);
      expect(bar.y).toBeGreaterThanOrEqual(0);
      expect(bar.height).toBeLessThanOrEqual(100);
    }
    expect(bars[0].height).toBe(0);
    expect(bars[1].height).toBe(50);
    expect(bars[2].height).toBe(100);
    expect(bars[0].y).toBe(100);
  });

  it('renders zero-height bars when there is no axis maximum', () => {
    const bars = barLayout([5, 10], 0, 200, 100);

    expect(bars.map((bar) => bar.height)).toEqual([0, 0]);
  });

  it('returns nothing for an empty series', () => {
    expect(barLayout([], 100, 300, 100)).toEqual([]);
  });
});

describe('groupedBarLayout', () => {
  const groups = [
    [1000, 950],
    [500, 450],
  ];

  it('places one bar per value inside each day group', () => {
    const bars = groupedBarLayout(groups, 1000, 400, 100);

    expect(bars).toHaveLength(4);
    expect(bars.map((bar) => bar.groupIndex)).toEqual([0, 0, 1, 1]);
    expect(bars.map((bar) => bar.seriesIndex)).toEqual([0, 1, 0, 1]);
  });

  it('keeps the pair side by side and inside the group slot', () => {
    const bars = groupedBarLayout(groups, 1000, 400, 100);
    const [first, second] = bars;

    expect(first.x).toBeLessThan(second.x);
    for (const bar of bars) {
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(400);
    }
    expect(first.height).toBe(100);
    expect(second.height).toBe(95);
  });

  it('returns nothing for empty groups', () => {
    expect(groupedBarLayout([], 1000, 400, 100)).toEqual([]);
  });
});

describe('formatDayLabel', () => {
  it('formats a local day without shifting it', () => {
    expect(formatDayLabel('2026-11-07')).toBe('Nov 7');
    expect(formatDayLabel('2026-01-01')).toBe('Jan 1');
  });

  it('leaves an unexpected value untouched', () => {
    expect(formatDayLabel('2026-11')).toBe('2026-11');
  });
});

describe('labelStep', () => {
  it('shows every label while they fit', () => {
    expect(labelStep(0)).toBe(1);
    expect(labelStep(1)).toBe(1);
    expect(labelStep(8)).toBe(1);
  });

  it('thins dense ranges down to the label budget', () => {
    expect(labelStep(16)).toBe(2);
    expect(labelStep(32)).toBe(4);
  });
});

describe('formatCompactValue', () => {
  it('formats axis labels deterministically', () => {
    expect(formatCompactValue(0)).toBe('0');
    expect(formatCompactValue(500)).toBe('500');
    expect(formatCompactValue(950)).toBe('950');
    expect(formatCompactValue(1500)).toBe('1.5k');
    expect(formatCompactValue(2000000)).toBe('2M');
    expect(formatCompactValue(12.34)).toBe('12.3');
  });
});
