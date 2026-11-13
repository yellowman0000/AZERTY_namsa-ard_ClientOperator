/**
 * The single mock-data store instance for this app, plus the React binding.
 *
 * Keep the store import inside client components only: it is created at module
 * scope with an empty, frozen snapshot, so importing it from a server component
 * would gain nothing and risks evaluating it during prerender.
 */
import { MOCK_DATASETS } from './datasets';
import { createMockDataStore } from './store';
import type { MockDataStore, MockSnapshot } from './types';

export const mockDataStore: MockDataStore = createMockDataStore(MOCK_DATASETS);

export { createMockDataStore } from './store';
export { MOCK_DATASETS } from './datasets';
export type {
  DatasetSchema,
  FieldSchema,
  FixtureRow,
  FixtureValue,
  MockDataStore,
  MockSnapshot,
} from './types';
export type { MockSnapshot as MockDataSnapshot };

/** Convenience for components that only need the switch. */
export function isMockActive(snapshot: MockSnapshot): boolean {
  return snapshot.active;
}
