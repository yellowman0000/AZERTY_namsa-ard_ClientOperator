import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import MockPanel from '../../app/mock-data/mock-panel';
import { MockBanner, MockOrb } from '../../app/mock-data/mock-orb';
import { MOCK_DATASETS } from '../mockData/datasets';
import { createMockDataStore } from '../mockData/store';
import type { FixtureRow, MockSnapshot } from '../mockData/types';

const NOW = new Date(2026, 10, 13, 20, 30);

function snapshots(): { active: MockSnapshot; inactive: MockSnapshot } {
  const store = createMockDataStore(MOCK_DATASETS);
  store.activate(NOW);
  return { active: store.getSnapshot(), inactive: store.getServerSnapshot() };
}

const noop = () => {};

function renderPanel(snapshot: MockSnapshot): string {
  return renderToStaticMarkup(
    <MockPanel
      snapshot={snapshot}
      datasets={MOCK_DATASETS}
      onToggle={noop}
      onSelectDataset={noop}
      onAddRow={noop}
      onRemoveRow={noop}
      onChangeField={noop}
      onResetDataset={noop}
      onResetAll={noop}
      onClose={noop}
    />
  );
}

function withReconciliationRow(row: FixtureRow): MockSnapshot {
  const { active } = snapshots();
  return {
    ...active,
    selectedDataset: 'reconciliation',
    datasets: { ...active.datasets, reconciliation: [row] },
  };
}

describe('mock orb', () => {
  it('renders an accessible button with the closed state', () => {
    const html = renderToStaticMarkup(<MockOrb active={false} expanded={false} onOpen={noop} />);

    expect(html).toContain('type="button"');
    expect(html).toContain('mock-orb');
    expect(html).not.toContain('mock-orb-active');
    expect(html).toContain('aria-label="Mock data"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('mock-orb-halo');
    expect(html).toContain('mock-orb-ball');
    expect(html).toContain('Mock data editor');
  });

  it('marks the "using" animation and the open dialog', () => {
    const html = renderToStaticMarkup(<MockOrb active expanded onOpen={noop} />);

    expect(html).toContain('mock-orb-active');
    expect(html).toContain('aria-expanded="true"');
  });
});

describe('mock banner', () => {
  it('stays hidden while mock data is off', () => {
    const html = renderToStaticMarkup(
      <MockBanner active={false} datasetCount={0} onOpen={noop} />
    );
    expect(html).toBe('');
  });

  it('warns and offers the editor while mock data is on', () => {
    const html = renderToStaticMarkup(<MockBanner active datasetCount={4} onOpen={noop} />);

    expect(html).toContain('mock-banner');
    expect(html).toContain('Mock data active');
    expect(html).toContain('4 datasets');
    expect(html).toContain('aria-label="Mock data is active. Open the mock data editor."');
  });
});

describe('mock panel', () => {
  it('lists every dataset with its row count and the master switch state', () => {
    const { active } = snapshots();
    const html = renderPanel(active);

    expect(html).toContain('id="mock-title"');
    expect(html).toContain('Mock data');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('Mock data on');
    expect(html).toContain('Fixtures are live');

    for (const dataset of MOCK_DATASETS) {
      expect(html).toContain(dataset.title);
    }

    expect(html).toContain('mock-nav-item mock-nav-item-active');
    expect(html).toContain('Add row');
    expect(html).toContain('Reset dataset');
    expect(html).toContain('Reset all');
    expect(html).toContain('Remove');
  });

  it('renders editable fields for the selected dataset', () => {
    const { active } = snapshots();
    const html = renderPanel(active);

    expect(html).toContain('Operations review records');
    expect(html).toContain('Meter volume (L)');
    expect(html).toContain('id="mock-reconciliation-0-meterVolume"');
    expect(html).toContain('type="number"');
    expect(html).toContain('Server anomaly flag');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('Water type');
    expect(html).toContain('Evidence photo URL');
    // Identity fields are shown but locked.
    expect(html).toContain('readOnly=""');
  });

  it('shows the empty state and the "off" copy for the server snapshot', () => {
    const { inactive } = snapshots();
    const html = renderPanel(inactive);

    expect(html).toContain('Mock data off');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('not shown yet');
    expect(html).toContain('No rows yet');
    expect(html).toContain('0 rows across 0 of 9 datasets');
  });

  it('surfaces a row validation message', () => {
    const html = renderPanel(
      withReconciliationRow({
        id: 'bad-row',
        transactionId: 'TXN-BAD',
        kioskId: 'KIOSK-001',
        recordedAt: '2026-11-13T09:00',
        meterVolume: 0,
        expectedRevenue: 100,
        reportedCash: 100,
        variance: 0,
        waterType: 'COMMERCIAL',
        isAnomaly: false,
        acceptedAt: '',
        isSynced: false,
        proofImageUrl: '',
      })
    );

    expect(html).toContain('Meter volume must be greater than 0.');
  });

  it('hides add/remove for a singleton dataset and shows its fields', () => {
    const { active } = snapshots();
    const html = renderPanel({ ...active, selectedDataset: 'stakeholder' });

    expect(html).toContain('Stakeholder analytics');
    expect(html).toContain('Total gross revenue');
    expect(html).toContain('Outstanding uncollected cash');
    expect(html).toContain('Water loss (%)');
    expect(html).not.toContain('Add row');
  });
});
