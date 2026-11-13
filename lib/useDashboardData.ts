'use client';

/**
 * Dashboard data hook for the manager metrics views (Story 06).
 *
 * This is the binding point between the presentational `DateRangeFilter` and
 * the dashboard tables and graphs: the filter state here decides both what the
 * picker shows and which `appliedRange` the reconciliation request uses, so a
 * valid preset or custom range immediately reloads the metrics.
 *
 * Request lifecycle rules:
 *  - the effect never sets state synchronously; callbacks start the loading
 *    state before dispatching, so an effect only settles a request;
 *  - the previous page's request is aborted when the range changes, so a slow
 *    answer for an old range can never overwrite the latest one;
 *  - an invalid draft range is never applied, so it never reaches the API;
 *  - records stay on screen while a new range is loading, then are replaced.
 */
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import {
  presetRange,
  rangeToQuery,
  validateDateRange,
  type DateRange,
  type PresetKey,
} from './dateRange';
import {
  INITIAL_DATE_FILTER_STATE,
  dateFilterReducer,
  sameRange,
} from './dateFilterState';
import { buildDashboardMetrics, type DashboardMetrics } from './dashboardMetrics';
import { rowsOf, selectReconciliationRecords } from './mockData/selectors';
import { useMockData } from './mockData/useMockData';
import { fetchReconciliation, type ReconciliationRecord } from './reconciliation';

export interface DashboardData {
  /** Active preset button. */
  preset: PresetKey;
  /** Draft range shown by the picker. */
  range: DateRange;
  /** Range the request is bound to. */
  appliedRange: DateRange;
  /** Inline validation message for the draft range, or null when valid. */
  rangeError: string | null;
  /** Filtered reconciliation records. */
  records: ReconciliationRecord[];
  /** Daily buckets derived from `records`, shared by every table and chart. */
  metrics: DashboardMetrics;
  /** A request is running (initial load or range reload). */
  loading: boolean;
  /** A reload is running while older records are still on screen. */
  refreshing: boolean;
  /** Last request failure, or null. */
  error: string | null;
  onPreset: (preset: Exclude<PresetKey, 'custom'>) => void;
  onRangeChange: (field: keyof DateRange, value: string) => void;
  onApply: () => void;
  refresh: () => void;
}

export function useDashboardData(): DashboardData {
  const [filter, dispatch] = useReducer(
    dateFilterReducer,
    INITIAL_DATE_FILTER_STATE
  );
  const [fetchedRecords, setFetchedRecords] = useState<ReconciliationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const mock = useMockData();
  const mockActive = mock.active;

  const rangeError = useMemo(
    () => validateDateRange(filter.range),
    [filter.range]
  );

  // Primitive dependencies keep the effect from refetching on object identity
  // changes that describe the same dates.
  const applied = useMemo(
    () => rangeToQuery(filter.appliedRange),
    [filter.appliedRange]
  );
  const startDate = applied.startDate ?? '';
  const endDate = applied.endDate ?? '';

  // Demo fixtures are derived during render, not stored: toggling mock data or
  // editing a row re-reads the store, and the same range filter still applies.
  const fixtureRecords = useMemo(
    () =>
      mockActive
        ? selectReconciliationRecords(rowsOf(mock, 'reconciliation'), applied)
        : null,
    [mockActive, mock, applied]
  );
  const records = fixtureRecords ?? fetchedRecords;
  const effectiveLoading = mockActive ? false : loading;
  const effectiveError = mockActive ? null : error;

  useEffect(() => {
    if (mockActive) return;

    const controller = new AbortController();
    const query = {
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    };

    fetchReconciliation(query, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setFetchedRecords(page.records);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setFetchedRecords([]);
        setError(
          err instanceof Error
            ? err.message
            : 'Could not load reconciliation records.'
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [startDate, endDate, attempt, mockActive]);

  const onPreset = useCallback(
    (preset: Exclude<PresetKey, 'custom'>) => {
      const now = new Date();
      const next = presetRange(preset, now);
      if (!sameRange(next, filter.appliedRange)) setLoading(true);
      dispatch({ type: 'selectPreset', preset, now });
    },
    [filter.appliedRange]
  );

  const onRangeChange = useCallback(
    (field: keyof DateRange, value: string) => {
      dispatch({ type: 'changeRange', field, value });
    },
    []
  );

  const onApply = useCallback(() => {
    if (validateDateRange(filter.range) !== null) return;
    if (!sameRange(filter.range, filter.appliedRange)) setLoading(true);
    dispatch({ type: 'applyRange' });
  }, [filter.range, filter.appliedRange]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    setAttempt((current) => current + 1);
  }, []);

  const metrics = useMemo(() => buildDashboardMetrics(records), [records]);

  return {
    preset: filter.preset,
    range: filter.range,
    appliedRange: filter.appliedRange,
    rangeError,
    records,
    metrics,
    loading: effectiveLoading,
    refreshing: effectiveLoading && records.length > 0,
    error: effectiveError,
    onPreset,
    onRangeChange,
    onApply,
    refresh,
  };
}
