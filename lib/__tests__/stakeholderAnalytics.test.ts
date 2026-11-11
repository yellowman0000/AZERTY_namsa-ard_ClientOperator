import { afterEach, describe, expect, it } from 'bun:test';
import {
  buildCashComparison,
  buildSocialAssistanceComparison,
  buildStakeholderAnalyticsUrl,
  comparisonMax,
  comparisonShares,
  currentMonthKey,
  fetchStakeholderAnalytics,
  formatMonthLabel,
  isMonthKey,
  parseStakeholderAnalytics,
  type StakeholderAnalytics,
} from '../stakeholderAnalytics';

const validBody = {
  month: '2026-10',
  summaryCards: {
    totalGrossRevenue: 45000,
    outstandingUncollectedCash: 1250,
    waterLossPercentage: 2.78,
  },
  socialAssistanceChart: {
    subsidizedVolumeLiters: 8500,
    commercialSalesVolumeLiters: 22500,
  },
};

const parsed: StakeholderAnalytics = {
  month: '2026-10',
  summaryCards: {
    totalGrossRevenue: 45000,
    outstandingUncollectedCash: 1250,
    waterLossPercentage: 2.78,
  },
  socialAssistanceChart: {
    subsidizedVolumeLiters: 8500,
    commercialSalesVolumeLiters: 22500,
  },
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('currentMonthKey', () => {
  it('formats the local month as YYYY-MM', () => {
    expect(currentMonthKey(new Date(2026, 9, 15))).toBe('2026-10');
    expect(currentMonthKey(new Date(2027, 0, 1))).toBe('2027-01');
  });
});

describe('isMonthKey', () => {
  it('accepts real months only', () => {
    expect(isMonthKey('2026-10')).toBe(true);
    expect(isMonthKey('2026-12')).toBe(true);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('2026-00')).toBe(false);
    expect(isMonthKey('2026-1')).toBe(false);
    expect(isMonthKey('2026-10-01')).toBe(false);
    expect(isMonthKey('October')).toBe(false);
  });
});

describe('formatMonthLabel', () => {
  it('names the month and year', () => {
    expect(formatMonthLabel('2026-10')).toBe('October 2026');
    expect(formatMonthLabel('2026-01')).toBe('January 2026');
  });

  it('leaves an unexpected value untouched', () => {
    expect(formatMonthLabel('2026-1')).toBe('2026-1');
  });
});

describe('buildStakeholderAnalyticsUrl', () => {
  it('requests the documented endpoint for the month', () => {
    expect(buildStakeholderAnalyticsUrl('2026-10')).toBe(
      '/api/kiosk/analytics/stakeholder?month=2026-10'
    );
  });

  it('trims the month', () => {
    expect(buildStakeholderAnalyticsUrl(' 2026-10 ')).toBe(
      '/api/kiosk/analytics/stakeholder?month=2026-10'
    );
  });
});

describe('parseStakeholderAnalytics', () => {
  it('accepts the documented payload', () => {
    expect(parseStakeholderAnalytics(validBody)).toEqual(parsed);
  });

  it('rejects a non-object payload', () => {
    for (const body of [null, undefined, 'oops', 42, []]) {
      expect(() => parseStakeholderAnalytics(body)).toThrow(
        'missing the root object'
      );
    }
  });

  it('rejects a missing or invalid month', () => {
    expect(() =>
      parseStakeholderAnalytics({ ...validBody, month: 'October' })
    ).toThrow('missing a valid month');
    expect(() => parseStakeholderAnalytics({ ...validBody, month: undefined })).toThrow(
      'missing a valid month'
    );
  });

  it('rejects missing nested objects', () => {
    expect(() =>
      parseStakeholderAnalytics({ month: '2026-10' })
    ).toThrow('missing the summaryCards object');
    expect(() =>
      parseStakeholderAnalytics({
        month: '2026-10',
        summaryCards: validBody.summaryCards,
      })
    ).toThrow('missing the socialAssistanceChart object');
  });

  it('rejects non-numeric and non-finite KPI values', () => {
    for (const value of ['45000', null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        parseStakeholderAnalytics({
          ...validBody,
          summaryCards: {
            ...validBody.summaryCards,
            totalGrossRevenue: value,
          },
        })
      ).toThrow('summaryCards.totalGrossRevenue');
    }
  });

  it('rejects invalid volume values', () => {
    expect(() =>
      parseStakeholderAnalytics({
        ...validBody,
        socialAssistanceChart: {
          subsidizedVolumeLiters: '8500',
          commercialSalesVolumeLiters: 22500,
        },
      })
    ).toThrow('socialAssistanceChart.subsidizedVolumeLiters');
  });
});

describe('fetchStakeholderAnalytics', () => {
  it('calls the documented URL and returns the parsed payload', async () => {
    let requested = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested = String(input);
      return jsonResponse(validBody);
    }) as typeof fetch;

    const analytics = await fetchStakeholderAnalytics('2026-10');

    expect(requested).toBe('/api/kiosk/analytics/stakeholder?month=2026-10');
    expect(analytics).toEqual(parsed);
  });

  it('surfaces the server message when the endpoint rejects the request', async () => {
    globalThis.fetch = (async () =>
      jsonResponse(
        { statusCode: 404, message: 'Cannot GET /api/kiosk/analytics/stakeholder' },
        404
      )) as typeof fetch;

    await expect(fetchStakeholderAnalytics('2026-10')).rejects.toThrow(
      'Cannot GET /api/kiosk/analytics/stakeholder'
    );
  });

  it('rejects an invalid month before calling the server', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return jsonResponse(validBody);
    }) as typeof fetch;

    await expect(fetchStakeholderAnalytics('October')).rejects.toThrow(
      'YYYY-MM'
    );
    expect(called).toBe(false);
  });

  it('throws a readable message when the server cannot be reached', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;

    await expect(fetchStakeholderAnalytics('2026-10')).rejects.toThrow(
      "Couldn't reach the server"
    );
  });
});

describe('comparisonShares', () => {
  it('splits the pair and sums to the whole', () => {
    const shares = comparisonShares([8500, 22500]);

    expect(shares[0]).toBe(8500 / 31000);
    expect(shares[1]).toBe(22500 / 31000);
    expect(shares[0] + shares[1]).toBeCloseTo(1, 10);
  });

  it('returns zeros when the total is zero', () => {
    expect(comparisonShares([0, 0])).toEqual([0, 0]);
  });

  it('ignores negative values', () => {
    expect(comparisonShares([-5, 10])).toEqual([0, 1]);
  });
});

describe('comparison data', () => {
  it('builds the Social Assistance pair from the chart payload', () => {
    const data = buildSocialAssistanceComparison(validBody.socialAssistanceChart);

    expect(data.map((datum) => datum.label)).toEqual(['Subsidized', 'Commercial']);
    expect(data.map((datum) => datum.tone)).toEqual(['aqua', 'spring']);
    expect(data[0].value).toBe(8500);
    expect(data[0].share).toBe(8500 / 31000);
  });

  it('builds the Overview cash pair from the summary cards', () => {
    const data = buildCashComparison(validBody.summaryCards);

    expect(data.map((datum) => datum.label)).toEqual([
      'Gross revenue',
      'Uncollected cash',
    ]);
    expect(data[1].value).toBe(1250);
    expect(data[1].tone).toBe('amber');
  });

  it('scales from the largest value', () => {
    expect(comparisonMax(buildSocialAssistanceComparison(validBody.socialAssistanceChart))).toBe(
      22500
    );
    expect(comparisonMax([])).toBe(0);
  });
});
