/**
 * Date-filter state transitions for the manager dashboard (Story 06).
 *
 * The reducer is pure, so the binding rules can be unit tested without a DOM:
 *
 *  - selecting a preset applies the new range immediately, which makes the
 *    dashboard re-fetch and re-render its tables and graphs;
 *  - editing the custom inputs only changes the draft range, so typing an
 *    invalid range can never reach the API;
 *  - applying a custom range moves it into `appliedRange` only when it is
 *    valid, and leaves the previous range (and its data) untouched otherwise.
 */
import {
  EMPTY_RANGE,
  presetRange,
  validateDateRange,
  type DateRange,
  type PresetKey,
} from './dateRange';

export interface DateFilterState {
  /** Which preset button is active; editing a date switches to `custom`. */
  preset: PresetKey;
  /** What the picker shows (may be invalid while the manager is editing). */
  range: DateRange;
  /** What the dashboard fetches for; always a valid or empty range. */
  appliedRange: DateRange;
}

export type DateFilterAction =
  | { type: 'selectPreset'; preset: Exclude<PresetKey, 'custom'>; now: Date }
  | { type: 'changeRange'; field: keyof DateRange; value: string }
  | { type: 'applyRange' };

export const INITIAL_DATE_FILTER_STATE: DateFilterState = {
  preset: 'all',
  range: EMPTY_RANGE,
  appliedRange: EMPTY_RANGE,
};

/** Bound comparison that ignores the whitespace `validateDateRange` also trims. */
export function sameRange(a: DateRange, b: DateRange): boolean {
  return (
    a.startDate.trim() === b.startDate.trim() &&
    a.endDate.trim() === b.endDate.trim()
  );
}

export function dateFilterReducer(
  state: DateFilterState,
  action: DateFilterAction
): DateFilterState {
  switch (action.type) {
    case 'selectPreset': {
      const range = presetRange(action.preset, action.now);
      if (sameRange(range, state.appliedRange)) {
        // Same dates, different preset label: refresh the picker without a
        // refetch just because a different button produced tonight's range.
        return { ...state, preset: action.preset, range };
      }
      return { preset: action.preset, range, appliedRange: range };
    }

    case 'changeRange':
      // Draft only: the dashboard keeps showing the last applied range.
      return {
        ...state,
        preset: 'custom',
        range: { ...state.range, [action.field]: action.value },
      };

    case 'applyRange': {
      if (validateDateRange(state.range) !== null) return state;
      if (sameRange(state.range, state.appliedRange)) return state;
      return { ...state, appliedRange: { ...state.range } };
    }

    default:
      return state;
  }
}
