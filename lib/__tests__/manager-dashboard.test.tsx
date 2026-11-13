import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewBadges, ReviewSummaryCards, ReviewTable } from '../../app/manager/manager-dashboard';
import { formatPercent, formatSignedAmount } from '../../app/manager/format';
import {
  summarizeReconciliation,
  type ReconciliationRecord,
} from '../reconciliation';

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

const renderTable = (records: ReconciliationRecord[], emptyMessage?: string) =>
  renderToStaticMarkup(
    emptyMessage === undefined ? (
      <ReviewTable records={records} />
    ) : (
      <ReviewTable records={records} emptyMessage={emptyMessage} />
    )
  );

describe('ReviewTable', () => {
  it('highlights and badges a revenue shortfall (variance < 0)', () => {
    const html = renderTable([record({ variance: -50 })]);

    expect(html).toContain('review-row-critical');
    expect(html).toContain('review-variance-negative');
    expect(html).toContain('Revenue shortfall');
    expect(html).not.toContain('Flagged anomaly');
  });

  it('highlights and badges a flagged volume anomaly', () => {
    const html = renderTable([record({ isAnomaly: true, variance: 120 })]);

    expect(html).toContain('review-row-warning');
    expect(html).toContain('review-variance-positive');
    expect(html).toContain('Flagged anomaly');
    expect(html).not.toContain('Revenue shortfall');
  });

  it('treats a record with both flags as critical and shows both badges', () => {
    const html = renderTable([record({ isAnomaly: true, variance: -50 })]);

    expect(html).toContain('review-row-critical');
    expect(html).toContain('Flagged anomaly');
    expect(html).toContain('Revenue shortfall');
  });

  it('leaves a clean record unhighlighted and marked Clear', () => {
    const html = renderTable([record({ isAnomaly: false, variance: 25 })]);

    expect(html).toContain('class="review-row"');
    expect(html).not.toContain('review-row-warning');
    expect(html).not.toContain('review-row-critical');
    expect(html).toContain('review-badge-clear');
    expect(html).toContain('Clear');
  });

  it('shows the variance as a percentage of the expected revenue', () => {
    const html = renderTable([record({ variance: -50, expectedRevenue: 1000 })]);

    expect(html).toContain('-5.0%');
  });

  it('renders missing metrics instead of NaN', () => {
    const html = renderTable([
      record({ reportedCash: null, expectedRevenue: null, variance: null }),
    ]);

    expect(html).toContain('Reported cash not recorded');
    expect(html).toContain('Expected revenue not recorded');
    expect(html).toContain('Variance not recorded');
    expect(html).not.toContain('NaN');
  });

  it('describes itself for assistive technology', () => {
    const html = renderTable([record()]);

    expect(html).toContain('<caption');
    expect(html).toContain('Reconciliation review');
    expect(html).toContain('scope="col"');
  });

  it('shows an empty message when there is nothing to review', () => {
    expect(renderTable([])).toContain('No reconciliation records to review.');
    expect(renderTable([], 'No records are flagged right now.')).toContain(
      'No records are flagged right now.'
    );
  });

  it('caps the rendered rows and says so when the endpoint returns everything', () => {
    const many = Array.from({ length: 205 }, (_, index) => record({ id: `log-${index}` }));
    const html = renderTable(many);

    expect(html).toContain('Showing the newest 200 of 205 matching records.');
    expect(html.split('<tr').length - 1).toBe(201); // one header row + 200 records
  });
});

describe('ReviewBadges', () => {
  it('renders one badge per flag', () => {
    expect(renderToStaticMarkup(<ReviewBadges record={record({ isAnomaly: true, variance: -50 })} />))
      .toContain('review-badge-anomaly');
    expect(renderToStaticMarkup(<ReviewBadges record={record({ isAnomaly: true, variance: -50 })} />))
      .toContain('review-badge-shortfall');
  });
});

describe('ReviewSummaryCards', () => {
  it('counts records, anomalies and revenue alerts', () => {
    const html = renderToStaticMarkup(
      <ReviewSummaryCards
        summary={summarizeReconciliation([
          record({ id: 'a', isAnomaly: true, variance: -50 }),
          record({ id: 'b', isAnomaly: false, variance: -25 }),
          record({ id: 'c', isAnomaly: false, variance: 0 }),
        ])}
      />
    );

    expect(html).toContain('Records reviewed');
    expect(html).toContain('<strong>3</strong>');
    expect(html).toContain('Flagged anomalies');
    expect(html).toContain('<strong>1</strong>');
    expect(html).toContain('Revenue variance alerts');
    expect(html).toContain('<strong>2</strong>');
    expect(html).toContain('review-summary-card-negative');
  });
});

describe('review formatting', () => {
  it('adds an explicit sign to variance amounts', () => {
    expect(formatSignedAmount(-50).startsWith('-')).toBe(true);
    expect(formatSignedAmount(1200).startsWith('+')).toBe(true);
    expect(formatSignedAmount(0).startsWith('-')).toBe(false);
    expect(formatSignedAmount(0).startsWith('+')).toBe(false);
  });

  it('formats a variance ratio as a percentage', () => {
    expect(formatPercent(-0.0512)).toBe('-5.1%');
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(0.3, 0)).toBe('30%');
  });
});

