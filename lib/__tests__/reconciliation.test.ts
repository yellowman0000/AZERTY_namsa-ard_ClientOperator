import { afterEach, describe, expect, it, mock } from 'bun:test';
import {
  fetchReconciliation,
  getReviewFlags,
  getReviewTone,
  getVarianceRatio,
  summarizeReconciliation,
  type ReconciliationRecord,
} from '../reconciliation';

const realFetch = globalThis.fetch;

function stubFetch(respond: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return respond(String(input));
  }) as unknown as typeof fetch;
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  globalThis.fetch = realFetch;
});

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

describe('fetchReconciliation', () => {
  it('requests the reconciliation endpoint without query parameters by default', async () => {
    const calls = stubFetch(() => json({ count: 0, records: [] }));

    await expect(fetchReconciliation()).resolves.toEqual({ count: 0, records: [] });
    expect(calls).toEqual(['/api/kiosk/reconciliation']);
  });

  it('passes every supplied filter, keeping isAnomaly=false meaningful', async () => {
    const calls = stubFetch(() => json({ count: 0, records: [] }));

    await fetchReconciliation({
      kioskId: '  KIOSK-001  ',
      isAnomaly: false,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });

    expect(calls).toEqual([
      '/api/kiosk/reconciliation?kioskId=KIOSK-001&isAnomaly=false&startDate=2026-10-01&endDate=2026-10-31',
    ]);
  });

  it('returns the server records and its count', async () => {
    const stored = [record({ id: 'a' }), record({ id: 'b', isAnomaly: true })];
    stubFetch(() => json({ count: 2, records: stored }));

    const page = await fetchReconciliation();

    expect(page.count).toBe(2);
    expect(page.records.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('falls back to the list length when the server omits a count', async () => {
    stubFetch(() => json({ records: [record(), record()] }));

    await expect(fetchReconciliation()).resolves.toMatchObject({ count: 2 });
  });

  it('rejects a response that is not a record list', async () => {
    stubFetch(() => json({ count: 0 }));

    await expect(fetchReconciliation()).rejects.toThrow(
      'did not contain a list of records'
    );
  });

  it("surfaces the server's error message", async () => {
    stubFetch(() => json({ statusCode: 400, message: 'startDate must not be after endDate' }, 400));

    await expect(fetchReconciliation()).rejects.toThrow('startDate must not be after endDate');
  });

  it('explains a network failure', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });

    await expect(fetchReconciliation()).rejects.toThrow("Couldn't reach the server.");
  });
});

describe('review triage rules', () => {
  it('flags an anomalous volume and a negative variance independently', () => {
    expect(getReviewFlags(record({ isAnomaly: true, variance: -50 }))).toEqual([
      'anomaly',
      'shortfall',
    ]);
    expect(getReviewFlags(record({ isAnomaly: true, variance: 50 }))).toEqual(['anomaly']);
    expect(getReviewFlags(record({ isAnomaly: false, variance: -0.01 }))).toEqual(['shortfall']);
  });

  it('does not flag a variance of exactly zero or a missing variance', () => {
    expect(getReviewFlags(record({ isAnomaly: false, variance: 0 }))).toEqual([]);
    expect(getReviewFlags(record({ isAnomaly: false, variance: null }))).toEqual([]);
  });

  it('makes a revenue shortfall critical, alone or alongside an anomaly', () => {
    expect(getReviewTone(record({ isAnomaly: true, variance: -50 }))).toBe('critical');
    expect(getReviewTone(record({ isAnomaly: false, variance: -50 }))).toBe('critical');
    expect(getReviewTone(record({ isAnomaly: true, variance: 50 }))).toBe('warning');
    expect(getReviewTone(record({ isAnomaly: false, variance: 0 }))).toBe('clear');
  });

  it('expresses variance as a share of the expected revenue', () => {
    expect(getVarianceRatio(record({ variance: -50, expectedRevenue: 1000 }))).toBeCloseTo(-0.05);
    expect(getVarianceRatio(record({ variance: 250, expectedRevenue: 1000 }))).toBeCloseTo(0.25);
  });

  it('has no ratio without a usable expected revenue', () => {
    expect(getVarianceRatio(record({ expectedRevenue: 0 }))).toBeNull();
    expect(getVarianceRatio(record({ expectedRevenue: null }))).toBeNull();
    expect(getVarianceRatio(record({ expectedRevenue: 1000, variance: null }))).toBeNull();
  });

  it('summarises what needs triage and the net variance', () => {
    const summary = summarizeReconciliation([
      record({ id: 'a', isAnomaly: true, variance: -50 }),
      record({ id: 'b', isAnomaly: false, variance: -25 }),
      record({ id: 'c', isAnomaly: false, variance: 0 }),
      record({ id: 'd', isAnomaly: false, variance: null }),
    ]);

    expect(summary).toEqual({
      total: 4,
      anomalyCount: 1,
      shortfallCount: 2,
      flaggedCount: 2,
      netVariance: -75,
    });
  });
});
