'use client';

/**
 * Reads the mock-data store through `useSyncExternalStore`.
 *
 * The third argument is the store's frozen empty snapshot, so the server render
 * and the hydration render agree; the live fixtures only appear after a click.
 */
import { useSyncExternalStore } from 'react';
import { mockDataStore } from './index';
import type { MockSnapshot } from './types';

export function useMockData(): MockSnapshot {
  return useSyncExternalStore(
    mockDataStore.subscribe,
    mockDataStore.getSnapshot,
    mockDataStore.getServerSnapshot
  );
}
