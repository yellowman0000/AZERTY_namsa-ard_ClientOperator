import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DateRangeFilter } from '../../app/manager/date-range-filter';
import { EMPTY_RANGE, type DateRange, type PresetKey } from '../dateRange';

const noop = () => {};

function render({
  preset = 'all' as PresetKey,
  range = EMPTY_RANGE as DateRange,
  error = null as string | null,
  disabled = false,
} = {}) {
  return renderToStaticMarkup(
    <DateRangeFilter
      preset={preset}
      range={range}
      error={error}
      disabled={disabled}
      onPreset={noop}
      onRangeChange={noop}
      onApply={noop}
    />
  );
}

describe('DateRangeFilter', () => {
  it('renders the three presets plus All time', () => {
    const html = render();

    expect(html).toContain('Today');
    expect(html).toContain('Last 7 Days');
    expect(html).toContain('This Month');
    expect(html).toContain('All time');
  });

  it('marks the active preset with aria-pressed', () => {
    expect(render({ preset: 'last7' })).toContain('aria-pressed="true"');
    expect(render({ preset: 'last7' })).toContain('aria-pressed="false"');
  });

  it('renders both date inputs with the current values', () => {
    const html = render({
      preset: 'custom',
      range: { startDate: '2026-11-01', endDate: '2026-11-07' },
    });

    expect(html).toContain('id="range-start"');
    expect(html).toContain('id="range-end"');
    expect(html).toContain('value="2026-11-01"');
    expect(html).toContain('value="2026-11-07"');
    expect(html).toContain('Start Date');
    expect(html).toContain('End Date');
  });

  it('shows the inline error and blocks Apply for an invalid range', () => {
    const html = render({
      preset: 'custom',
      range: { startDate: '2026-11-30', endDate: '2026-11-01' },
      error: 'Start date must be on or before the end date.',
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain('Start date must be on or before the end date.');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="date-range-error"');
    // The Apply button is disabled while the error is present.
    expect(html).toMatch(/<button[^>]*class="button button-secondary review-apply"[^>]*disabled/);
  });

  it('enables Apply for a valid custom range', () => {
    const html = render({
      preset: 'custom',
      range: { startDate: '2026-11-01', endDate: '2026-11-07' },
    });

    const apply = html.match(/<button[^>]*review-apply[^>]*>/)?.[0] ?? '';
    expect(apply).not.toContain('disabled');
    expect(html).not.toContain('role="alert"');
  });

  it('disables every control while a fetch is running', () => {
    const html = render({ disabled: true });

    expect(html).toContain('disabled=""');
  });
});
