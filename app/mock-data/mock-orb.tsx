'use client';

/**
 * The floating mock-data orb and its "mock data active" chip.
 *
 * Purely presentational: state and handlers arrive as props so the component can
 * be rendered in isolation by the SSR test harness.
 */

export interface MockOrbProps {
  /** Fixtures are currently applied — the orb switches to its "using" animation. */
  active: boolean;
  /** The editor dialog is open. */
  expanded: boolean;
  onOpen: () => void;
}

export function MockOrb({ active, expanded, onOpen }: MockOrbProps) {
  return (
    <button
      type="button"
      className={`mock-orb${active ? ' mock-orb-active' : ''}`}
      aria-label="Mock data"
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={onOpen}
    >
      <span className="mock-orb-halo" aria-hidden="true" />
      <span className="mock-orb-ball" aria-hidden="true">
        <span className="mock-orb-sheen" aria-hidden="true" />
      </span>
      <span className="visually-hidden">Mock data editor — temporary demo data</span>
    </button>
  );
}

export interface MockBannerProps {
  active: boolean;
  datasetCount: number;
  onOpen: () => void;
}

/** Fixed reminder that the figures on screen are fixtures, not real records. */
export function MockBanner({ active, datasetCount, onOpen }: MockBannerProps) {
  if (!active) return null;

  return (
    <button
      type="button"
      className="mock-banner"
      aria-label="Mock data is active. Open the mock data editor."
      onClick={onOpen}
    >
      <span className="mock-banner-dot" aria-hidden="true" />
      <span>
        Mock data active · {datasetCount} {datasetCount === 1 ? 'dataset' : 'datasets'}
      </span>
    </button>
  );
}

export default MockOrb;
