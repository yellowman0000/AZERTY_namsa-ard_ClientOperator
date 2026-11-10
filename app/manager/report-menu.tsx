'use client';

import type { ReportFormat } from '../../lib/reports';

export interface ReportMenuProps {
  open: boolean;
  disabled: boolean;
  /** Why the action is blocked, surfaced as a tooltip. */
  disabledReason?: string;
  exporting: ReportFormat | null;
  onToggle: () => void;
  onExport: (format: ReportFormat) => void;
}

/**
 * "Generate Report" dropdown for the manager metrics views (Story 07).
 *
 * The parent owns the open state and the request; this component only renders
 * the trigger and the CSV/PDF choices. It is disabled while the active date
 * range is invalid so an export can never be requested for a broken range.
 */
export function ReportMenu({
  open,
  disabled,
  disabledReason,
  exporting,
  onToggle,
  onExport,
}: ReportMenuProps) {
  const label = exporting ? `Exporting ${exporting.toUpperCase()}…` : 'Generate Report';

  return (
    <div className="report-menu">
      <button
        type="button"
        className="button button-secondary report-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || exporting !== null}
        title={disabled ? disabledReason : undefined}
        onClick={onToggle}
      >
        {label}
        <span className="report-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && !disabled && exporting === null && (
        <div className="report-options" role="menu" aria-label="Report format">
          <button
            type="button"
            role="menuitem"
            className="report-option"
            onClick={() => onExport('csv')}
          >
            Export CSV
          </button>
          <button
            type="button"
            role="menuitem"
            className="report-option"
            onClick={() => onExport('pdf')}
          >
            Export PDF
          </button>
        </div>
      )}
    </div>
  );
}
