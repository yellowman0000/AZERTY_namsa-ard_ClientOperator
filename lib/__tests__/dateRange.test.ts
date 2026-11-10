import { describe, expect, it } from 'bun:test';
import {
  EMPTY_RANGE,
  describeRange,
  presetRange,
  rangeToQuery,
  validateDateRange,
} from '../dateRange';

describe('presetRange', () => {
  const now = new Date(2026, 10, 7, 10, 30); // 7 Nov 2026, local time

  it('covers a single local day for Today', () => {
    expect(presetRange('today', now)).toEqual({
      startDate: '2026-11-07',
      endDate: '2026-11-07',
    });
  });

  it('returns seven inclusive days for Last 7 Days', () => {
    expect(presetRange('last7', now)).toEqual({
      startDate: '2026-11-01',
      endDate: '2026-11-07',
    });
  });

  it('starts on the first of the month for This Month', () => {
    expect(presetRange('thisMonth', now)).toEqual({
      startDate: '2026-11-01',
      endDate: '2026-11-07',
    });
  });

  it('crosses month and year boundaries correctly', () => {
    expect(presetRange('last7', new Date(2026, 2, 3))).toEqual({
      startDate: '2026-02-25',
      endDate: '2026-03-03',
    });
    expect(presetRange('last7', new Date(2027, 0, 2))).toEqual({
      startDate: '2026-12-27',
      endDate: '2027-01-02',
    });
  });

  it('clears both bounds for All time', () => {
    expect(presetRange('all', now)).toEqual(EMPTY_RANGE);
  });
});

describe('validateDateRange', () => {
  it('accepts an empty range (no filter)', () => {
    expect(validateDateRange(EMPTY_RANGE)).toBeNull();
  });

  it('requires both bounds once one is chosen', () => {
    expect(validateDateRange({ startDate: '2026-11-01', endDate: '' })).toBe(
      'Choose both a start and end date.'
    );
    expect(validateDateRange({ startDate: '', endDate: '2026-11-01' })).toBe(
      'Choose both a start and end date.'
    );
  });

  it('rejects malformed or impossible dates', () => {
    for (const [startDate, endDate] of [
      ['01/11/2026', '2026-11-30'],
      ['2026-11-01', '2026-02-31'],
      ['2026-11-01', '2026-13-01'],
    ]) {
      expect(validateDateRange({ startDate, endDate })).toBe(
        'Enter both dates as YYYY-MM-DD.'
      );
    }
  });

  it('rejects a start date after the end date', () => {
    expect(
      validateDateRange({ startDate: '2026-11-30', endDate: '2026-11-01' })
    ).toBe('Start date must be on or before the end date.');
  });

  it('accepts the same day and a forward range', () => {
    expect(
      validateDateRange({ startDate: '2026-11-07', endDate: '2026-11-07' })
    ).toBeNull();
    expect(
      validateDateRange({ startDate: '2026-11-01', endDate: '2026-11-07' })
    ).toBeNull();
  });

  it('ignores surrounding whitespace', () => {
    expect(
      validateDateRange({ startDate: ' 2026-11-01 ', endDate: '2026-11-07 ' })
    ).toBeNull();
  });
});

describe('rangeToQuery', () => {
  it('omits empty bounds so the endpoint stays unfiltered', () => {
    expect(rangeToQuery(EMPTY_RANGE)).toEqual({});
  });

  it('passes both bounds when set', () => {
    expect(
      rangeToQuery({ startDate: '2026-11-01', endDate: '2026-11-07' })
    ).toEqual({ startDate: '2026-11-01', endDate: '2026-11-07' });
  });
});

describe('describeRange', () => {
  it('labels empty, single-day and multi-day ranges', () => {
    expect(describeRange(EMPTY_RANGE)).toBe('All time');
    expect(
      describeRange({ startDate: '2026-11-07', endDate: '2026-11-07' })
    ).toBe('2026-11-07');
    expect(
      describeRange({ startDate: '2026-11-01', endDate: '2026-11-07' })
    ).toBe('2026-11-01 → 2026-11-07');
  });
});
