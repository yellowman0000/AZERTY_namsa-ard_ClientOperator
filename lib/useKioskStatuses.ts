'use client';

/**
 * Polling hook behind the manager dashboard's kiosk status cards (Story 01).
 *
 * It reads `GET /api/kiosk/status` every 10 seconds — the kiosk heartbeat
 * cadence — and exposes the latest fleet snapshot. Request lifecycle rules
 * match the rest of the manager views:
 *
 *  - state is only set after a request settles, never synchronously in the
 *    effect body (the React 19 lint rule the dashboard data hook already obeys);
 *  - the interval and the in-flight request are torn down when the range,
 *    route or mock-data switch changes;
 *  - a failed poll keeps the last good snapshot on screen and reports the
 *    failure, so a brief API blip never blanks the cards;
 *  - while the mock-data tool is on, fixtures are derived during render and no
 *    request or timer starts at all.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_HEARTBEAT_TIMEOUT_SECONDS,
  KIOSK_STATUS_POLL_MS,
  fetchKioskFleet,
  type KioskFleet,
  type KioskStatusRecord,
} from './kioskStatus';
import { rowsOf, selectKioskFleet } from './mockData/selectors';
import { useMockData } from './mockData/useMockData';

export interface KioskStatusState {
  kiosks: KioskStatusRecord[];
  onlineCount: number;
  staleAfterSeconds: number;
  /** Only until the first answer (success or failure). */
  loading: boolean;
  /** Last failure, while `kiosks` may still hold the last good snapshot. */
  error: string | null;
  /** `Date.now()` when the snapshot on screen arrived; `null` for fixtures. */
  updatedAt: number | null;
  refresh: () => void;
}

export function useKioskStatuses(): KioskStatusState {
  const [fetched, setFetched] = useState<KioskFleet | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const mock = useMockData();
  const mockActive = mock.active;

  // Demo fixtures are derived during render, like every other mocked surface.
  const fixtureFleet = useMemo(
    () => (mockActive ? selectKioskFleet(rowsOf(mock, 'kioskFleet')) : null),
    [mockActive, mock]
  );

  useEffect(() => {
    if (mockActive) return;

    const controller = new AbortController();
    let cancelled = false;

    const load = async () => {
      try {
        const fleet = await fetchKioskFleet(controller.signal);
        if (cancelled) return;
        setFetched(fleet);
        setUpdatedAt(Date.now());
        setError(null);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setError(
          err instanceof Error ? err.message : 'Could not load kiosk status.'
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const timer = setInterval(load, KIOSK_STATUS_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      controller.abort();
    };
  }, [mockActive, attempt]);

  const refresh = useCallback(() => {
    if (mockActive) return;
    setAttempt((current) => current + 1);
  }, [mockActive]);

  const fleet = fixtureFleet ?? fetched;

  return {
    kiosks: fleet?.kiosks ?? [],
    onlineCount: fleet?.onlineCount ?? 0,
    staleAfterSeconds: mockActive
      ? DEFAULT_HEARTBEAT_TIMEOUT_SECONDS
      : fetched?.staleAfterSeconds ?? DEFAULT_HEARTBEAT_TIMEOUT_SECONDS,
    loading: mockActive ? false : loading && fetched === null,
    error: mockActive ? null : error,
    updatedAt: mockActive ? null : updatedAt,
    refresh,
  };
}
