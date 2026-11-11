import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DashboardCharts,
  DailyMetricsTable,
  RevenueTrendChart,
  VolumeTrendChart,
} from '../../app/manager/dashboard-metrics';
import { buildDashboardMetrics } from '../dashboardMetrics';
import type { ReconciliationRecord } from '../reconciliation';

function record(overrides: Partial<ReconciliationRecord> = {}): ReconciliationRecord {
  return {
    id: 'log-1',
    transactionId: 'TXN-001',
    kioskId: 'KIOSK-001',
    operatorId: 'OP-104',
    meterVolume: 850,
    reportedCash: 950,
    expectedRevenue: 1000,
    variance: -50,
    isAnomaly: false,
    waterType: 'COMMERCIAL',
    recordedAt: new Date(2026, 10, 7, 12).toISOString(),
    createdAt: new Date(2026, 10, 7, 12, 1).toISOString(),
    ...overrides,
  };
}

function metricsFor(records: ReconciliationRecord[]) {
  return buildDashboardMetrics(records);
}

const twoDays = metricsFor([
  record({ id: 'a' }),
  record({
    id: 'b',
    recordedAt: new Date(2026, 10, 8, 12).toISOString(),
    meterVolume: 100,
    reportedCash: 450,
    expectedRevenue: 500,
    variance: 50,
  }),
]);

describe('DashboardCharts', () => {
  it('renders nothing when the selected range has no records', () => {
    expect(renderToStaticMarkup(<DashboardCharts metrics={metricsFor([])} />)).toBe('');
  });

  it('renders both graphs for a filtered range', () => {
    const html = renderToStaticMarkup(<DashboardCharts metrics={twoDays} />);

    expect(html).toContain('Daily meter volume');
    expect(html).toContain('Expected revenue vs reported cash');
    expect(html.split('role="img"').length - 1).toBe(2);
  });
});

describe('VolumeTrendChart', () => {
  it('draws one bar per filtered day with its value', () => {
    const html = renderToStaticMarkup(<VolumeTrendChart metrics={twoDays} />);

    expect(html).toContain('data-day="2026-11-07"');
    expect(html).toContain('data-day="2026-11-08"');
    expect(html).toContain('data-value="850"');
    expect(html).toContain('data-value="100"');
    expect(html.split('chart-bar-volume').length - 1).toBe(2);
  });

  it('labels the local days and the rounded axis', () => {
    const html = renderToStaticMarkup(<VolumeTrendChart metrics={twoDays} />);

    expect(html).toContain('Nov 7');
    expect(html).toContain('Nov 8');
    expect(html).toContain('1k'); // chartAxisMax(850) = 1000
    expect(html).toContain('500');
  });

  it('is exposed as an image with a title and a description', () => {
    const html = renderToStaticMarkup(<VolumeTrendChart metrics={twoDays} />);

    expect(html).toContain('role="img"');
    expect(html).toContain('aria-labelledby="volume-chart-title"');
    expect(html).toContain('aria-describedby="volume-chart-desc"');
    expect(html).toContain('<title id="volume-chart-title">');
    expect(html).toContain('Peak');
  });
});

describe('RevenueTrendChart', () => {
  it('draws expected and reported bars for every day', () => {
    const html = renderToStaticMarkup(<RevenueTrendChart metrics={twoDays} />);

    expect(html.split('chart-bar-expected').length - 1).toBe(2);
    expect(html.split('chart-bar-reported').length - 1).toBe(2);
    expect(html).toContain('data-series="Expected revenue"');
    expect(html).toContain('data-series="Reported cash"');
    expect(html).toContain('data-value="1000"');
    expect(html).toContain('data-value="950"');
  });

  it('includes a legend and an accessible summary of the totals', () => {
    const html = renderToStaticMarkup(<RevenueTrendChart metrics={twoDays} />);

    expect(html).toContain('chart-legend');
    expect(html).toContain('Expected');
    expect(html).toContain('Reported');
    expect(html).toContain('aria-labelledby="revenue-chart-title"');
    expect(html).toContain('against reported cash');
  });
});

describe('DailyMetricsTable', () => {
  it('shows an empty message when nothing matched the date filter', () => {
    expect(renderToStaticMarkup(<DailyMetricsTable metrics={metricsFor([])} />)).toContain(
      'No records in the selected period.'
    );
  });

  it('renders one row per day plus a totals row', () => {
    const html = renderToStaticMarkup(<DailyMetricsTable metrics={twoDays} />);

    expect(html).toContain('<caption');
    expect(html).toContain('Daily totals for the selected date range');
    expect(html).toContain('Records');
    expect(html).toContain('Expected revenue');
    expect(html).toContain('Reported cash');
    expect(html).toContain('Anomalies');
    expect(html).toContain('<tfoot>');
    expect(html).toContain('Total');
    expect(html.split('<tr').length - 1).toBe(4); // header + 2 days + total
  });

  it('marks negative variance and counts anomalies', () => {
    const metrics = metricsFor([
      record({ id: 'a', isAnomaly: true }),
      record({ id: 'b', recordedAt: new Date(2026, 10, 8, 12).toISOString(), variance: 20 }),
    ]);
    const html = renderToStaticMarkup(<DailyMetricsTable metrics={metrics} />);

    expect(html).toContain('review-variance-negative');
    expect(html).toContain('review-variance-positive');
    expect(html).toContain('<tfoot>');
  });

  it('notes records whose timestamp could not be read', () => {
    const metrics = metricsFor([
      record({ id: 'valid' }),
      record({ id: 'broken', recordedAt: 'cannot-parse' }),
    ]);
    const html = renderToStaticMarkup(<DailyMetricsTable metrics={metrics} />);

    expect(html).toContain('unreadable timestamp');
  });
});
