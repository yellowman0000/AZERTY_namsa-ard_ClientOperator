import { describe, expect, it } from 'bun:test';
import {
  INITIAL_DATE_FILTER_STATE,
  dateFilterReducer,
  sameRange,
  type DateFilterState,
} from '../dateFilterState';
import { EMPTY_RANGE, presetRange } from '../dateRange';

const NOW = new Date(2026, 10, 7, 10, 30); // 7 Nov 2026, local time

function state(overrides: Partial<DateFilterState> = {}): DateFilterState {
  return { ...INITIAL_DATE_FILTER_STATE, ...overrides };
}

describe('dateFilterReducer', () => {
  it('starts unfiltered', () => {
    expect(INITIAL_DATE_FILTER_STATE.preset).toBe('all');
    expect(INITIAL_DATE_FILTER_STATE.range).toEqual(EMPTY_RANGE);
    expect(INITIAL_DATE_FILTER_STATE.appliedRange).toEqual(EMPTY_RANGE);
  });

  it('applies a preset range immediately so the dashboard reloads', () => {
    const next = dateFilterReducer(state(), {
      type: 'selectPreset',
      preset: 'last7',
      now: NOW,
    });

    expect(next.preset).toBe('last7');
    expect(next.range).toEqual(presetRange('last7', NOW));
    expect(next.appliedRange).toEqual(presetRange('last7', NOW));
  });

  it('applies All time as an empty range', () => {
    const filtered = state({
      preset: 'today',
      range: { startDate: '2026-11-07', endDate: '2026-11-07' },
      appliedRange: { startDate: '2026-11-07', endDate: '2026-11-07' },
    });
    const next = dateFilterReducer(filtered, {
      type: 'selectPreset',
      preset: 'all',
      now: NOW,
    });

    expect(next.preset).toBe('all');
    expect(next.appliedRange).toEqual(EMPTY_RANGE);
  });

  it('updates the active preset even when two presets share the same dates', () => {
    // 7 Nov 2026: Last 7 Days and This Month both start on 1 Nov.
    const last7 = dateFilterReducer(state(), {
      type: 'selectPreset',
      preset: 'last7',
      now: NOW,
    });
    const thisMonth = dateFilterReducer(last7, {
      type: 'selectPreset',
      preset: 'thisMonth',
      now: NOW,
    });

    expect(thisMonth.preset).toBe('thisMonth');
    expect(thisMonth.appliedRange).toEqual(last7.appliedRange);
  });

  it('keeps a draft edit out of the applied range until it is applied', () => {
    const filtered = state({
      preset: 'last7',
      range: { startDate: '2026-11-01', endDate: '2026-11-07' },
      appliedRange: { startDate: '2026-11-01', endDate: '2026-11-07' },
    });

    const drafting = dateFilterReducer(filtered, {
      type: 'changeRange',
      field: 'startDate',
      value: '2026-10-25',
    });

    expect(drafting.preset).toBe('custom');
    expect(drafting.range).toEqual({
      startDate: '2026-10-25',
      endDate: '2026-11-07',
    });
    // Editing alone must not change what is fetched.
    expect(drafting.appliedRange).toEqual(filtered.appliedRange);
  });

  it('applies a valid custom range to the request', () => {
    const drafting = state({
      preset: 'custom',
      range: { startDate: '2026-11-01', endDate: '2026-11-07' },
      appliedRange: EMPTY_RANGE,
    });

    const next = dateFilterReducer(drafting, { type: 'applyRange' });

    expect(next.appliedRange).toEqual({
      startDate: '2026-11-01',
      endDate: '2026-11-07',
    });
  });

  it('never applies an invalid custom range, so it cannot reach the API', () => {
    const invalid = state({
      preset: 'custom',
      range: { startDate: '2026-11-30', endDate: '2026-11-01' },
      appliedRange: { startDate: '2026-11-01', endDate: '2026-11-07' },
    });

    expect(dateFilterReducer(invalid, { type: 'applyRange' })).toBe(invalid);
  });

  it('never applies a half-filled range', () => {
    const halfFilled = state({
      preset: 'custom',
      range: { startDate: '2026-11-01', endDate: '' },
      appliedRange: EMPTY_RANGE,
    });

    expect(dateFilterReducer(halfFilled, { type: 'applyRange' })).toBe(halfFilled);
  });

  it('never applies a malformed range', () => {
    const malformed = state({
      preset: 'custom',
      range: { startDate: '01/11/2026', endDate: '2026-11-30' },
      appliedRange: EMPTY_RANGE,
    });

    expect(dateFilterReducer(malformed, { type: 'applyRange' })).toBe(malformed);
  });

  it('ignores an apply that would not change the range', () => {
    const applied = state({
      preset: 'custom',
      range: { startDate: '2026-11-01', endDate: '2026-11-07' },
      appliedRange: { startDate: '2026-11-01', endDate: '2026-11-07' },
    });

    expect(dateFilterReducer(applied, { type: 'applyRange' })).toBe(applied);
  });
});

describe('sameRange', () => {
  it('compares trimmed bounds', () => {
    expect(
      sameRange(
        { startDate: ' 2026-11-01 ', endDate: '2026-11-07' },
        { startDate: '2026-11-01', endDate: '2026-11-07 ' }
      )
    ).toBe(true);
    expect(
      sameRange(
        { startDate: '2026-11-01', endDate: '2026-11-07' },
        { startDate: '2026-11-02', endDate: '2026-11-07' }
      )
    ).toBe(false);
  });
});
