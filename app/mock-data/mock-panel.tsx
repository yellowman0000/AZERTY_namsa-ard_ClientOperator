'use client';

/**
 * The mock-data editor panel body.
 *
 * Presentational and schema-driven: everything it shows comes from the dataset
 * schemas plus the store snapshot, and every change is reported through a
 * callback. That keeps it renderable in isolation (SSR tests) and identical in
 * shape to the kiosk app's panel.
 */
import type {
  DatasetSchema,
  FieldSchema,
  FixtureRow,
  FixtureValue,
  MockSnapshot,
} from '../../lib/mockData/types';

export interface MockPanelProps {
  snapshot: MockSnapshot;
  datasets: readonly DatasetSchema[];
  onToggle: () => void;
  onSelectDataset: (datasetId: string) => void;
  onAddRow: (datasetId: string) => void;
  onRemoveRow: (datasetId: string, index: number) => void;
  onChangeField: (
    datasetId: string,
    index: number,
    key: string,
    value: FixtureValue
  ) => void;
  onResetDataset: (datasetId: string) => void;
  onResetAll: () => void;
  onClose: () => void;
}

function fieldInputValue(field: FieldSchema, row: FixtureRow): string {
  const value = row[field.key];
  if (value === null || value === undefined) return '';
  return String(value);
}

function MockField({
  datasetId,
  rowIndex,
  field,
  row,
  onChangeField,
}: {
  datasetId: string;
  rowIndex: number;
  field: FieldSchema;
  row: FixtureRow;
  onChangeField: MockPanelProps['onChangeField'];
}) {
  const inputId = `mock-${datasetId}-${rowIndex}-${field.key}`;
  const describeId = `${inputId}-help`;
  const className = `mock-field${field.width === 'full' ? ' mock-field-full' : ''}`;

  if (field.type === 'boolean') {
    return (
      <label className={`${className} mock-field-flag`} htmlFor={inputId}>
        <input
          id={inputId}
          type="checkbox"
          checked={row[field.key] === true}
          disabled={field.readOnly}
          onChange={(event) =>
            onChangeField(datasetId, rowIndex, field.key, event.target.checked)
          }
        />
        <span className="mock-field-label">{field.label}</span>
        {field.help && (
          <span className="mock-field-help" id={describeId}>
            {field.help}
          </span>
        )}
      </label>
    );
  }

  if (field.type === 'select') {
    return (
      <label className={className} htmlFor={inputId}>
        <span className="mock-field-label">{field.label}</span>
        <select
          id={inputId}
          value={fieldInputValue(field, row)}
          disabled={field.readOnly}
          aria-describedby={field.help ? describeId : undefined}
          onChange={(event) =>
            onChangeField(datasetId, rowIndex, field.key, event.target.value)
          }
        >
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {field.help && (
          <span className="mock-field-help" id={describeId}>
            {field.help}
          </span>
        )}
      </label>
    );
  }

  const inputType =
    field.type === 'number' ? 'number' : field.type === 'datetime' ? 'datetime-local' : 'text';

  return (
    <label className={className} htmlFor={inputId}>
      <span className="mock-field-label">{field.label}</span>
      <input
        id={inputId}
        type={inputType}
        value={fieldInputValue(field, row)}
        readOnly={field.readOnly}
        min={field.min}
        max={field.max}
        step={field.step}
        aria-describedby={field.help ? describeId : undefined}
        onChange={(event) => {
          const raw = event.target.value;
          if (field.type !== 'number') {
            onChangeField(datasetId, rowIndex, field.key, raw);
            return;
          }
          onChangeField(datasetId, rowIndex, field.key, raw === '' ? null : Number(raw));
        }}
      />
      {field.help && (
        <span className="mock-field-help" id={describeId}>
          {field.help}
        </span>
      )}
    </label>
  );
}

export default function MockPanel({
  snapshot,
  datasets,
  onToggle,
  onSelectDataset,
  onAddRow,
  onRemoveRow,
  onChangeField,
  onResetDataset,
  onResetAll,
  onClose,
}: MockPanelProps) {
  const selected =
    datasets.find((dataset) => dataset.id === snapshot.selectedDataset) ?? datasets[0];
  const rows = selected ? (snapshot.datasets[selected.id] ?? []) : [];
  const totalRows = datasets.reduce(
    (total, dataset) => total + (snapshot.datasets[dataset.id]?.length ?? 0),
    0
  );
  const filledDatasetCount = datasets.filter(
    (dataset) => (snapshot.datasets[dataset.id]?.length ?? 0) > 0
  ).length;

  return (
    <div className="mock-panel">
      <header className="mock-header">
        <div>
          <p className="card-kicker">DEMO TOOL · TEMPORARY DATA</p>
          <h2 id="mock-title">Mock data</h2>
        </div>
        <div className="mock-header-actions">
          <button
            type="button"
            role="switch"
            aria-checked={snapshot.active}
            aria-label="Show mock data in this app"
            className={`mock-switch${snapshot.active ? ' mock-switch-on' : ''}`}
            onClick={onToggle}
          >
            <span className="mock-switch-track" aria-hidden="true">
              <span className="mock-switch-thumb" />
            </span>
            <span className="mock-switch-label">
              {snapshot.active ? 'Mock data on' : 'Mock data off'}
            </span>
          </button>
          <button className="inspect-close" type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
      </header>

      <p className={`mock-warning${snapshot.active ? ' mock-warning-on' : ''}`} role="status">
        {snapshot.active
          ? 'Fixtures are live: every view below is showing temporary rows and no request is sent for them.'
          : 'Fixtures can be edited here but are not shown yet. Turn mock data on to preview them.'}
      </p>

      <div className="mock-layout">
        <nav className="mock-nav" aria-label="Mock datasets">
          {datasets.map((dataset) => {
            const count = snapshot.datasets[dataset.id]?.length ?? 0;
            const isSelected = dataset.id === selected?.id;
            return (
              <button
                key={dataset.id}
                type="button"
                className={`mock-nav-item${isSelected ? ' mock-nav-item-active' : ''}`}
                aria-current={isSelected ? 'true' : undefined}
                onClick={() => onSelectDataset(dataset.id)}
              >
                <span className="mock-nav-title">{dataset.title}</span>
                <span className="mock-nav-count">{count}</span>
              </button>
            );
          })}
        </nav>

        <div className="mock-body">
          {selected && (
            <section className="mock-dataset" aria-labelledby="mock-dataset-title">
              <div className="mock-dataset-head">
                <div>
                  <h3 id="mock-dataset-title">{selected.title}</h3>
                  <p>{selected.description}</p>
                </div>
                <div className="mock-dataset-actions">
                  {!selected.singleton && (
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => onAddRow(selected.id)}
                    >
                      Add row
                    </button>
                  )}
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => onResetDataset(selected.id)}
                  >
                    Reset dataset
                  </button>
                </div>
              </div>

              {rows.length === 0 ? (
                <p className="mock-empty">
                  No rows yet — Add row to create one, or Reset dataset for the defaults.
                </p>
              ) : (
                <ol className="mock-rows">
                  {rows.map((row, rowIndex) => {
                    const rowError = selected.validate?.(row) ?? null;
                    return (
                      <li className="mock-row" key={`${selected.id}-${rowIndex}`}>
                        <div className="mock-row-head">
                          <span className="mock-row-index">Row {rowIndex + 1}</span>
                          {!selected.singleton && rows.length > 1 && (
                            <button
                              className="mock-row-remove"
                              type="button"
                              onClick={() => onRemoveRow(selected.id, rowIndex)}
                              aria-label={`Remove ${selected.title} row ${rowIndex + 1}`}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                        <div className="mock-fields">
                          {selected.fields.map((field) => (
                            <MockField
                              key={field.key}
                              datasetId={selected.id}
                              rowIndex={rowIndex}
                              field={field}
                              row={row}
                              onChangeField={onChangeField}
                            />
                          ))}
                        </div>
                        {rowError && (
                          <p className="mock-row-error" role="status">
                            {rowError}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          )}
        </div>
      </div>

      <footer className="mock-footer">
        <p className="mock-footer-note">
          {totalRows} rows across {filledDatasetCount} of {datasets.length} datasets · in memory only,
          cleared on reload
        </p>
        <div className="mock-footer-actions">
          <button className="button button-secondary" type="button" onClick={onResetAll}>
            Reset all
          </button>
          <button className="button button-primary" type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </footer>
    </div>
  );
}
