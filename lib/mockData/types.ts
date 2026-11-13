/**
 * Mock-data tool types (demo only — never used by the server).
 *
 * The tool is a floating orb that opens a panel where temporary fixture rows can
 * be added, edited and removed. Rows live in a small module store and are read
 * by the page hooks *instead of* the network, so nothing here ever reaches the
 * API. See `store.ts` for the state machine and `datasets.ts` for the fixtures.
 */

/** One editable cell. Numbers stay numbers, booleans booleans, everything else text. */
export type FixtureValue = string | number | boolean | null;

/** A row is a flat record keyed exactly like the production type it stands in for. */
export type FixtureRow = Record<string, FixtureValue>;

/**
 * How the panel renders a field:
 * - `text` — single-line text
 * - `number` — numeric input, empty means `null`
 * - `boolean` — checkbox
 * - `select` — one of `options`
 * - `datetime` — `datetime-local` input stored as local `YYYY-MM-DDTHH:mm`
 */
export type FieldType = 'text' | 'number' | 'boolean' | 'select' | 'datetime';

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldSchema {
  /** Must match the production field name so adapters cannot drift. */
  key: string;
  label: string;
  type: FieldType;
  options?: FieldOption[];
  min?: number;
  max?: number;
  step?: number;
  /** Short hint rendered under the input. */
  help?: string;
  /** Row identity fields are shown but not edited. */
  readOnly?: boolean;
  /** Layout hint: half-width fields sit two per line on desktop. */
  width?: 'half' | 'full';
}

export interface DatasetSchema {
  id: string;
  title: string;
  description: string;
  /** Singleton datasets (a payload object rather than a list) edit exactly one row. */
  singleton?: boolean;
  fields: FieldSchema[];
  /** Fresh default rows. `now` is passed in by the caller so nothing reads a clock implicitly. */
  seeds: (now: Date) => FixtureRow[];
  /** A new editable row for "Add row". */
  makeRow: (context: { now: Date; index: number }) => FixtureRow;
  /** Human-readable problem with a row, or null when it is usable. */
  validate?: (row: FixtureRow) => string | null;
}

/** Immutable snapshot consumed through `useSyncExternalStore`. */
export interface MockSnapshot {
  /** Master switch: fixtures are only rendered while this is true. */
  readonly active: boolean;
  /** Bumped on every mutation so hooks can re-read fixtures in an effect. */
  readonly revision: number;
  /** Dataset currently shown in the panel. */
  readonly selectedDataset: string;
  readonly datasets: Readonly<Record<string, readonly FixtureRow[]>>;
}

/** The store surface both apps expose. */
export interface MockDataStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => MockSnapshot;
  /** Deterministic, empty, frozen — the third argument of every `useSyncExternalStore`. */
  getServerSnapshot: () => MockSnapshot;
  activate: (now: Date) => void;
  deactivate: () => void;
  toggle: (now: Date) => void;
  selectDataset: (datasetId: string) => void;
  addRow: (datasetId: string, now: Date) => void;
  updateField: (datasetId: string, index: number, key: string, value: FixtureValue) => void;
  removeRow: (datasetId: string, index: number) => void;
  resetDataset: (datasetId: string, now: Date) => void;
  resetAll: (now: Date) => void;
}
