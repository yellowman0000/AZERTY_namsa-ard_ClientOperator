/**
 * Date-range presets and validation for the manager metrics views (Story 06).
 *
 * Dates are handled as local calendar days (`YYYY-MM-DD`) so a manager in
 * Asia/Bangkok filtering "Today" does not silently get yesterday's records.
 */

export type PresetKey = 'all' | 'today' | 'last7' | 'thisMonth' | 'custom';

export interface DateRange {
  startDate: string;
  endDate: string;
}

export const PRESET_LABELS: Record<Exclude<PresetKey, 'custom'>, string> = {
  all: 'All time',
  today: 'Today',
  last7: 'Last 7 Days',
  thisMonth: 'This Month',
};

export const EMPTY_RANGE: DateRange = { startDate: '', endDate: '' };

/** Local calendar day as `YYYY-MM-DD` (never shifted into the previous day). */
export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function presetRange(
  preset: Exclude<PresetKey, 'custom'>,
  now: Date = new Date()
): DateRange {
  const today = toDateInputValue(now);

  switch (preset) {
    case 'today':
      return { startDate: today, endDate: today };
    case 'last7': {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      return { startDate: toDateInputValue(start), endDate: today };
    }
    case 'thisMonth': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startDate: toDateInputValue(start), endDate: today };
    }
    default:
      return { ...EMPTY_RANGE };
  }
}

const DATE_INPUT = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDay(value: string): boolean {
  if (!DATE_INPUT.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/**
 * Returns the inline error for the current selection, or `null` when the range
 * is valid. An empty range means "no filter" and is valid.
 */
export function validateDateRange(range: DateRange): string | null {
  const start = range.startDate.trim();
  const end = range.endDate.trim();

  if (start === '' && end === '') return null;
  if (start === '' || end === '') return 'Choose both a start and end date.';
  if (!isCalendarDay(start) || !isCalendarDay(end)) {
    return 'Enter both dates as YYYY-MM-DD.';
  }
  if (start > end) return 'Start date must be on or before the end date.';
  return null;
}

/** Only the non-empty bounds are sent, so the API keeps its "optional" contract. */
export function rangeToQuery(range: DateRange): {
  startDate?: string;
  endDate?: string;
} {
  const start = range.startDate.trim();
  const end = range.endDate.trim();
  return {
    ...(start ? { startDate: start } : {}),
    ...(end ? { endDate: end } : {}),
  };
}

/** Human summary for the results header. */
export function describeRange(range: DateRange): string {
  const start = range.startDate.trim();
  const end = range.endDate.trim();
  if (!start && !end) return 'All time';
  if (start === end) return start;
  return `${start || '…'} → ${end || '…'}`;
}
