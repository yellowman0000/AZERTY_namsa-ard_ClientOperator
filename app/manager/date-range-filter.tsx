'use client';

import {
  EMPTY_RANGE,
  PRESET_LABELS,
  type DateRange,
  type PresetKey,
} from '../../lib/dateRange';

const PRESETS: Array<Exclude<PresetKey, 'custom'>> = [
  'all',
  'today',
  'last7',
  'thisMonth',
];

export interface DateRangeFilterProps {
  preset: PresetKey;
  range: DateRange;
  /** Inline validation message from `validateDateRange`, or null when valid. */
  error: string | null;
  disabled?: boolean;
  onPreset: (preset: Exclude<PresetKey, 'custom'>) => void;
  onRangeChange: (field: keyof DateRange, value: string) => void;
  onApply: () => void;
}

/**
 * Preset buttons plus custom start/end inputs for the manager metrics views.
 *
 * The component is presentational: the parent owns the range state and decides
 * whether an API call may run, so an invalid range can never be fetched. The
 * error is rendered inline and wired to both inputs through `aria-describedby`.
 */
export function DateRangeFilter({
  preset,
  range,
  error,
  disabled = false,
  onPreset,
  onRangeChange,
  onApply,
}: DateRangeFilterProps) {
  const errorId = 'date-range-error';

  return (
    <div className="review-date-filter">
      <div className="review-preset-group" role="group" aria-label="Preset intervals">
        {PRESETS.map((key) => (
          <button
            key={key}
            type="button"
            className={`review-preset${preset === key ? ' review-preset-active' : ''}`}
            aria-pressed={preset === key}
            disabled={disabled}
            onClick={() => onPreset(key)}
          >
            {PRESET_LABELS[key]}
          </button>
        ))}
      </div>

      <div className="review-date-fields">
        <label className="review-date-field" htmlFor="range-start">
          Start Date
          <input
            id="range-start"
            type="date"
            value={range.startDate}
            max={range.endDate || undefined}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => onRangeChange('startDate', event.target.value)}
          />
        </label>
        <label className="review-date-field" htmlFor="range-end">
          End Date
          <input
            id="range-end"
            type="date"
            value={range.endDate}
            min={range.startDate || undefined}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => onRangeChange('endDate', event.target.value)}
          />
        </label>
        <button
          type="button"
          className="button button-secondary review-apply"
          disabled={disabled || error !== null}
          onClick={onApply}
        >
          Apply
        </button>
      </div>

      {range.startDate === '' && range.endDate === '' && preset !== 'custom' && (
        <span className="review-date-hint">No date filter — showing every record.</span>
      )}

      {error && (
        <p className="review-range-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export { EMPTY_RANGE };
