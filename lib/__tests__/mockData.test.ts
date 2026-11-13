import { describe, expect, it } from 'bun:test';
import { MOCK_DATASETS } from '../mockData/datasets';
import { createMockDataStore } from '../mockData/store';
import {
  buildMockInspection,
  readBoolean,
  readNumber,
  readText,
  rowsOf,
  selectKioskStatus,
  selectLogPage,
  selectNotice,
  selectQueuePayloads,
  selectReceipts,
  selectReconciliationRecords,
  selectStakeholderAnalytics,
} from '../mockData/selectors';
import type { FixtureRow, MockDataStore } from '../mockData/types';

const NOW = new Date(2026, 10, 13, 20, 30);

function newStore(): MockDataStore {
  return createMockDataStore(MOCK_DATASETS);
}

function datasetIds(store: MockDataStore): string[] {
  return Object.keys(store.getSnapshot().datasets).sort();
}

describe('mock data store', () => {
  it('starts (and stays) deterministic and empty on the server snapshot', () => {
    const store = newStore();
    const server = store.getServerSnapshot();

    expect(store.getServerSnapshot()).toBe(server);
    expect(server.active).toBe(false);
    expect(server.revision).toBe(0);
    expect(Object.isFrozen(server)).toBe(true);
    expect(datasetIds(store)).toEqual(MOCK_DATASETS.map((dataset) => dataset.id).sort());
    for (const id of datasetIds(store)) {
      expect(rowsOf(server, id)).toHaveLength(0);
    }
  });

  it('seeds every dataset on activate and notifies subscribers', () => {
    const store = newStore();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    store.activate(NOW);

    const snapshot = store.getSnapshot();
    expect(snapshot.active).toBe(true);
    expect(snapshot.revision).toBeGreaterThan(0);
    expect(rowsOf(snapshot, 'reconciliation')).toHaveLength(14);
    expect(rowsOf(snapshot, 'logs')).toHaveLength(26);
    expect(rowsOf(snapshot, 'inspection')).toHaveLength(3);
    expect(rowsOf(snapshot, 'receipts')).toHaveLength(2);
    expect(notifications).toBeGreaterThan(0);

    unsubscribe();
  });

  it('keeps edited rows across deactivate → activate', () => {
    const store = newStore();
    store.activate(NOW);
    store.updateField('reconciliation', 0, 'kioskId', 'KIOSK-999');

    store.deactivate();
    expect(store.getSnapshot().active).toBe(false);
    expect(store.getSnapshot().datasets.reconciliation[0]?.kioskId).toBe('KIOSK-999');

    store.activate(NOW);
    expect(store.getSnapshot().datasets.reconciliation[0]?.kioskId).toBe('KIOSK-999');
  });

  it('replaces references and bumps the revision on every mutation', () => {
    const store = newStore();
    store.activate(NOW);
    const before = store.getSnapshot();
    const rowsBefore = before.datasets.reconciliation;

    store.updateField('reconciliation', 0, 'meterVolume', 999);

    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.datasets.reconciliation).not.toBe(rowsBefore);
    expect(after.datasets.reconciliation[0]?.meterVolume).toBe(999);
    expect(after.datasets.inspection).toBe(before.datasets.inspection);
  });

  it('adds, removes and resets rows', () => {
    const store = newStore();
    store.activate(NOW);
    const initial = rowsOf(store.getSnapshot(), 'reconciliation').length;

    store.addRow('reconciliation', NOW);
    expect(rowsOf(store.getSnapshot(), 'reconciliation')).toHaveLength(initial + 1);

    store.removeRow('reconciliation', initial);
    expect(rowsOf(store.getSnapshot(), 'reconciliation')).toHaveLength(initial);

    store.updateField('reconciliation', 0, 'kioskId', 'MUTATED');
    store.resetDataset('reconciliation', NOW);
    expect(rowsOf(store.getSnapshot(), 'reconciliation')[0]?.kioskId).toBe('KIOSK-001');
  });

  it('keeps singleton datasets to exactly one row', () => {
    const store = newStore();
    store.activate(NOW);
    expect(rowsOf(store.getSnapshot(), 'stakeholder')).toHaveLength(1);

    store.addRow('stakeholder', NOW);
    expect(rowsOf(store.getSnapshot(), 'stakeholder')).toHaveLength(1);

    store.removeRow('stakeholder', 0);
    expect(rowsOf(store.getSnapshot(), 'stakeholder')).toHaveLength(1);
  });

  it('toggles, resets everything and switches the selected dataset', () => {
    const store = newStore();
    store.toggle(NOW);
    expect(store.getSnapshot().active).toBe(true);

    store.updateField('logs', 0, 'kioskId', 'CHANGED');
    store.resetAll(NOW);
    expect(store.getSnapshot().datasets.logs[0]?.kioskId).toBe('KIOSK-001');
    expect(store.getSnapshot().active).toBe(true);

    store.selectDataset('stakeholder');
    expect(store.getSnapshot().selectedDataset).toBe('stakeholder');
    store.selectDataset('not-a-dataset');
    expect(store.getSnapshot().selectedDataset).toBe('stakeholder');

    store.toggle(NOW);
    expect(store.getSnapshot().active).toBe(false);
  });
});

describe('fixture value readers', () => {
  it('reads text, numbers and booleans safely', () => {
    expect(readText(' OP-001 ')).toBe('OP-001');
    expect(readText(42)).toBe('42');
    expect(readText(null)).toBe('');
    expect(readNumber('12.5')).toBe(12.5);
    expect(readNumber('')).toBeNull();
    expect(readNumber(Number.NaN)).toBeNull();
    expect(readBoolean(true)).toBe(true);
    expect(readBoolean('true')).toBe(true);
    expect(readBoolean(1)).toBe(false);
  });
});

describe('operations review selector', () => {
  const rows: FixtureRow[] = [
    { id: 'old', recordedAt: '2026-11-04T09:00', meterVolume: 100, expectedRevenue: 200, reportedCash: 200, variance: 0 },
    { id: 'new', recordedAt: '2026-11-06T18:00', meterVolume: 100, expectedRevenue: 200, reportedCash: 180, variance: -20 },
    { id: 'mid', recordedAt: '2026-11-05T12:00', meterVolume: 100, expectedRevenue: 200, reportedCash: 210, variance: 10 },
    { id: 'broken', recordedAt: 'not-a-date', meterVolume: 100, expectedRevenue: 200, reportedCash: 200, variance: 0 },
  ];

  it('returns every row newest-first when no bounds are set', () => {
    const records = selectReconciliationRecords(rows);
    expect(records.map((record) => record.id)).toEqual(['new', 'mid', 'old', 'broken']);
    // An unreadable timestamp survives so the daily table can report it as skipped.
    expect(records.at(-1)?.recordedAt).toBe('');
  });

  it('keeps the bounds inclusive and drops unreadable timestamps when filtering', () => {
    const records = selectReconciliationRecords(rows, {
      startDate: '2026-11-05',
      endDate: '2026-11-05',
    });
    expect(records.map((record) => record.id)).toEqual(['mid']);

    const last7 = selectReconciliationRecords(rows, {
      startDate: '2026-11-04',
      endDate: '2026-11-06',
    });
    expect(last7.map((record) => record.id)).toEqual(['new', 'mid', 'old']);
  });

  it('maps missing values to the nullable production shape', () => {
    const [record] = selectReconciliationRecords([
      { id: 'a', transactionId: 'TXN', kioskId: 'KIOSK-001', recordedAt: '2026-11-05T09:00' },
    ]);
    expect(record).toBeDefined();
    expect(record?.operatorId).toBeNull();
    expect(record?.reportedCash).toBeNull();
    expect(record?.variance).toBeNull();
    expect(record?.isAnomaly).toBe(false);
    expect(record?.proofImageUrl).toBeNull();
  });
});

describe('historical log pagination', () => {
  const rows: FixtureRow[] = Array.from({ length: 45 }, (_, index) => ({
    id: `log-${index}`,
    transactionId: `TXN-${index}`,
    kioskId: 'KIOSK-001',
    recordedAt: `2026-11-${String(30 - index).padStart(2, '0')}T09:00`,
    createdAt: `2026-11-${String(30 - index).padStart(2, '0')}T09:00`,
    meterVolume: 100 + index,
  }));

  it('pages 20 at a time and ends with a null cursor', () => {
    const first = selectLogPage(rows, null);
    expect(first.data).toHaveLength(20);
    expect(first.nextCursor).toBe('20');

    const second = selectLogPage(rows, first.nextCursor);
    expect(second.data).toHaveLength(20);
    expect(second.nextCursor).toBe('40');

    const third = selectLogPage(rows, second.nextCursor);
    expect(third.data).toHaveLength(5);
    expect(third.nextCursor).toBeNull();
  });

  it('tolerates a malformed cursor', () => {
    const page = selectLogPage(rows, 'nonsense');
    expect(page.data).toHaveLength(20);
    expect(page.nextCursor).toBe('20');
  });
});

describe('inspection adapter', () => {
  const store = newStore();
  store.activate(NOW);
  const snapshot = store.getSnapshot();
  const sources = {
    reconciliation: rowsOf(snapshot, 'reconciliation'),
    logs: rowsOf(snapshot, 'logs'),
    inspection: rowsOf(snapshot, 'inspection'),
  };

  it('uses the matching inspection fixture for each verification state', () => {
    expect(buildMockInspection('mock-log-01', sources)?.verification.status).toBe('VERIFIED');
    expect(buildMockInspection('mock-log-04', sources)?.verification.status).toBe('CHECKSUM_MISMATCH');
    expect(buildMockInspection('mock-log-07', sources)?.verification.status).toBe('NO_CHECKSUM');
  });

  it('synthesises a VERIFIED inspection for any other record', () => {
    const inspection = buildMockInspection('mock-log-02', sources);
    expect(inspection?.verification.status).toBe('VERIFIED');
    expect(inspection?.verification.storedChecksum).toBe(
      inspection?.verification.recomputedChecksum
    );
    expect(inspection?.log.transactionId).toBe('TXN-MOCK-02');
  });

  it('returns null for an unknown id', () => {
    expect(buildMockInspection('missing', sources)).toBeNull();
  });
});

describe('operator page adapters', () => {
  const store = newStore();
  store.activate(NOW);
  const snapshot = store.getSnapshot();

  it('maps queued rows to transaction payloads', () => {
    const payloads = selectQueuePayloads(rowsOf(snapshot, 'queue'));
    expect(payloads).toHaveLength(3);
    expect(payloads[0]?.transaction_id).toBe('TXN-QUEUED-01');
    expect(payloads[0]?.meter_volume).toBe(240);
    expect(payloads[2]?.evidence_pending).toBe(true);
    expect(new Date(payloads[0]?.recorded_at ?? '').getTime()).not.toBeNaN();
  });

  it('maps receipt rows to valid signed receipts', () => {
    const receipts = selectReceipts(rowsOf(snapshot, 'receipts'));
    expect(receipts).toHaveLength(2);
    for (const receipt of receipts) {
      expect(receipt.algorithm).toBe('SHA-256');
      expect(receipt.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(receipt.hash).toBe(receipt.checksum);
      expect(receipt.signature).toMatch(/^[a-f0-9]{64}$/);
      expect(new Date(receipt.issuedAt).getTime()).not.toBeNaN();
    }
  });

  it('maps the kiosk status and notice singletons', () => {
    const status = selectKioskStatus(rowsOf(snapshot, 'kioskStatus')[0]);
    expect(status?.kioskId).toBe('KIOSK-001');
    expect(status?.connection).toBe('connected');
    expect(status?.pingStatus).toBe('ok');
    expect(selectKioskStatus(undefined)).toBeNull();

    const notice = selectNotice(rowsOf(snapshot, 'notice')[0]);
    expect(notice?.kind).toBe('success');
    expect(selectNotice({ kind: 'success', text: '' })).toBeNull();
  });

  it('maps the stakeholder payload', () => {
    const payload = selectStakeholderAnalytics(rowsOf(snapshot, 'stakeholder')[0], '2026-11');
    expect(payload?.summaryCards.totalGrossRevenue).toBe(48250.5);
    expect(payload?.summaryCards.waterLossPercentage).toBe(2.78);
    expect(payload?.socialAssistanceChart.subsidizedVolumeLiters).toBe(8500);
    expect(selectStakeholderAnalytics(undefined, '2026-11')).toBeNull();

    const fallback = selectStakeholderAnalytics({ month: '', totalGrossRevenue: 1 }, '2026-11');
    expect(fallback?.month).toBe('2026-11');
  });
});

describe('dataset validation messages', () => {
  const byId = new Map(MOCK_DATASETS.map((dataset) => [dataset.id, dataset]));

  it('rejects a receipt whose hash does not match its checksum', () => {
    const receipts = byId.get('receipts');
    const bad = receipts?.makeRow({ now: NOW, index: 0 }) ?? {};
    expect(receipts?.validate?.(bad)).toBeNull();
    expect(receipts?.validate?.({ ...bad, hash: 'deadbeef' })).toBe('Hash must equal the checksum.');
  });

  it('rejects a verified inspection with different checksums', () => {
    const inspection = byId.get('inspection');
    const row = inspection?.makeRow({ now: NOW, index: 0 }) ?? {};
    expect(inspection?.validate?.(row)).toBeNull();
    expect(
      inspection?.validate?.({ ...row, recomputedChecksum: 'a'.repeat(64) })
    ).toBe('A VERIFIED record needs an identical recomputed checksum.');
  });

  it('rejects a non-positive meter volume', () => {
    const reconciliation = byId.get('reconciliation');
    const row = reconciliation?.makeRow({ now: NOW, index: 0 }) ?? {};
    expect(reconciliation?.validate?.(row)).toBeNull();
    expect(reconciliation?.validate?.({ ...row, meterVolume: 0 })).toBe(
      'Meter volume must be greater than 0.'
    );
  });
});
