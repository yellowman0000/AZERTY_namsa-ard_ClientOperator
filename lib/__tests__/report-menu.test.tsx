import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportMenu } from '../../app/manager/report-menu';

const noop = () => {};

function render({
  open = false,
  disabled = false,
  disabledReason,
  exporting = null as 'csv' | 'pdf' | null,
} = {}) {
  return renderToStaticMarkup(
    <ReportMenu
      open={open}
      disabled={disabled}
      disabledReason={disabledReason}
      exporting={exporting}
      onToggle={noop}
      onExport={noop}
    />
  );
}

describe('ReportMenu', () => {
  it('renders a closed dropdown trigger', () => {
    const html = render();

    expect(html).toContain('Generate Report');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Export CSV');
    expect(html).not.toContain('Export PDF');
  });

  it('lists CSV and PDF options when open', () => {
    const html = render({ open: true });

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('role="menu"');
    expect(html).toContain('Export CSV');
    expect(html).toContain('Export PDF');
  });

  it('is disabled with a reason while the date range is invalid', () => {
    const html = render({
      disabled: true,
      disabledReason: 'Start date must be on or before the end date.',
    });

    expect(html).toMatch(/<button[^>]*report-trigger[^>]*disabled/);
    expect(html).toContain(
      'title="Start date must be on or before the end date."'
    );
  });

  it('does not render the options while disabled', () => {
    const html = render({ open: true, disabled: true });

    expect(html).not.toContain('Export CSV');
  });

  it('shows progress while an export is running', () => {
    const html = render({ exporting: 'pdf' });

    expect(html).toContain('Exporting PDF…');
    expect(html).toMatch(/<button[^>]*report-trigger[^>]*disabled/);
  });
});
