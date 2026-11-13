/**
 * The mock-data store: a tiny `useSyncExternalStore`-compatible singleton.
 *
 * Rules that keep it safe in a prerendered Next app:
 *  - the initial (and server) snapshot is empty and frozen, so server and client
 *    render the same markup on hydration;
 *  - every mutation produces new objects/arrays (never an in-place edit) and
 *    bumps `revision`, which is the primitive the data hooks depend on;
 *  - nothing here reads a clock, storage or the DOM. Callers pass `now`.
 */
import type {
  DatasetSchema,
  FixtureRow,
  MockDataStore,
  MockSnapshot,
} from './types';

export function createMockDataStore(schemas: readonly DatasetSchema[]): MockDataStore {
  const firstDataset = schemas[0]?.id ?? '';
  const emptyDatasets = Object.freeze(
    schemas.reduce<Record<string, readonly FixtureRow[]>>((accumulator, schema) => {
      accumulator[schema.id] = Object.freeze([]);
      return accumulator;
    }, {})
  );

  const serverSnapshot: MockSnapshot = Object.freeze({
    active: false,
    revision: 0,
    selectedDataset: firstDataset,
    datasets: emptyDatasets,
  });

  const listeners = new Set<() => void>();
  let snapshot: MockSnapshot = serverSnapshot;

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const commit = (
    next: Pick<MockSnapshot, 'active' | 'selectedDataset' | 'datasets'>
  ): void => {
    snapshot = Object.freeze({
      active: next.active,
      selectedDataset: next.selectedDataset,
      revision: snapshot.revision + 1,
      datasets: Object.freeze(next.datasets),
    });
    notify();
  };

  const schemaFor = (datasetId: string): DatasetSchema | undefined =>
    schemas.find((schema) => schema.id === datasetId);

  const rowsOf = (datasetId: string): readonly FixtureRow[] =>
    snapshot.datasets[datasetId] ?? [];

  const replaceRows = (datasetId: string, rows: FixtureRow[]): void => {
    commit({
      active: snapshot.active,
      selectedDataset: snapshot.selectedDataset,
      datasets: { ...snapshot.datasets, [datasetId]: Object.freeze(rows) },
    });
  };

  /** Fill every dataset that has no rows yet; existing edits are preserved. */
  const seedEmptyDatasets = (now: Date): void => {
    const datasets: Record<string, readonly FixtureRow[]> = { ...snapshot.datasets };
    let changed = false;

    for (const schema of schemas) {
      const current = datasets[schema.id];
      if (current && current.length > 0) continue;
      datasets[schema.id] = Object.freeze(schema.seeds(now).map((row) => ({ ...row })));
      changed = true;
    }

    if (changed) {
      commit({
        active: snapshot.active,
        selectedDataset: snapshot.selectedDataset,
        datasets,
      });
    }
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot: () => snapshot,

    getServerSnapshot: () => serverSnapshot,

    activate: (now) => {
      seedEmptyDatasets(now);
      if (snapshot.active) return;
      commit({
        active: true,
        selectedDataset: snapshot.selectedDataset,
        datasets: snapshot.datasets,
      });
    },

    deactivate: () => {
      if (!snapshot.active) return;
      commit({
        active: false,
        selectedDataset: snapshot.selectedDataset,
        datasets: snapshot.datasets,
      });
    },

    toggle: (now) => {
      if (snapshot.active) {
        commit({
          active: false,
          selectedDataset: snapshot.selectedDataset,
          datasets: snapshot.datasets,
        });
        return;
      }
      seedEmptyDatasets(now);
      commit({
        active: true,
        selectedDataset: snapshot.selectedDataset,
        datasets: snapshot.datasets,
      });
    },

    selectDataset: (datasetId) => {
      if (!schemaFor(datasetId) || snapshot.selectedDataset === datasetId) return;
      commit({
        active: snapshot.active,
        selectedDataset: datasetId,
        datasets: snapshot.datasets,
      });
    },

    addRow: (datasetId, now) => {
      const schema = schemaFor(datasetId);
      if (!schema) return;
      const current = [...rowsOf(datasetId)];
      if (schema.singleton && current.length > 0) return;
      current.push({ ...schema.makeRow({ now, index: current.length }) });
      replaceRows(datasetId, current);
    },

    updateField: (datasetId, index, key, value) => {
      const current = [...rowsOf(datasetId)];
      const existing = current[index];
      if (!existing) return;
      current[index] = { ...existing, [key]: value };
      replaceRows(datasetId, current);
    },

    removeRow: (datasetId, index) => {
      const schema = schemaFor(datasetId);
      if (!schema) return;
      const current = rowsOf(datasetId).filter((_, rowIndex) => rowIndex !== index);
      // A singleton dataset keeps an editable row so the panel never goes blank.
      if (schema.singleton && current.length === 0) return;
      replaceRows(datasetId, [...current]);
    },

    resetDataset: (datasetId, now) => {
      const schema = schemaFor(datasetId);
      if (!schema) return;
      replaceRows(datasetId, schema.seeds(now).map((row) => ({ ...row })));
    },

    resetAll: (now) => {
      const datasets: Record<string, readonly FixtureRow[]> = {};
      for (const schema of schemas) {
        datasets[schema.id] = Object.freeze(schema.seeds(now).map((row) => ({ ...row })));
      }
      commit({
        active: snapshot.active,
        selectedDataset: snapshot.selectedDataset,
        datasets,
      });
    },
  };
}
