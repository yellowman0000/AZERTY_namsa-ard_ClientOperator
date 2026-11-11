'use client';

/**
 * Monthly stakeholder analytics data hook (Story 09 frontend).
 *
 * Owns the selected month and loads `GET /api/kiosk/analytics/stakeholder` for
 * it. The month picker only ever produces a valid `YYYY-MM`, and the request
 * for the previous month is aborted when the selection changes, so a slow
 * answer can never replace a newer month.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  currentMonthKey,
  fetchStakeholderAnalytics,
  isMonthKey,
  type StakeholderAnalytics,
} from './stakeholderAnalytics';

export interface StakeholderAnalyticsState {
  /** Selected month, `YYYY-MM`. */
  month: string;
  analytics: StakeholderAnalytics | null;
  loading: boolean;
  /** A reload is running while the current month's cards are still shown. */
  refreshing: boolean;
  error: string | null;
  selectMonth: (month: string) => void;
  refresh: () => void;
}

export function useStakeholderAnalytics(
  initialMonth?: string
): StakeholderAnalyticsState {
  const [month, setMonth] = useState(() =>
    initialMonth && isMonthKey(initialMonth) ? initialMonth : currentMonthKey()
  );
  const [analytics, setAnalytics] = useState<StakeholderAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    fetchStakeholderAnalytics(month, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setAnalytics(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setAnalytics(null);
        setError(
          err instanceof Error
            ? err.message
            : 'Could not load stakeholder analytics.'
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [month, attempt]);

  const selectMonth = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      if (!isMonthKey(trimmed) || trimmed === month) return;
      setLoading(true);
      setError(null);
      // Drop the previous month's cards so they are never mistaken for the
      // newly selected month while the request is running.
      setAnalytics(null);
      setMonth(trimmed);
    },
    [month]
  );

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    setAttempt((current) => current + 1);
  }, []);

  return {
    month,
    analytics,
    loading,
    refreshing: loading && analytics !== null,
    error,
    selectMonth,
    refresh,
  };
}
