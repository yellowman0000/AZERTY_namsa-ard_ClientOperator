/**
 * ClientOperator mock datasets.
 *
 * One dataset per data surface of the app. Field keys are the production field
 * names (see `lib/reconciliation.ts`, `lib/logs.ts`, `lib/stakeholderAnalytics.ts`,
 * `lib/api.ts`) and the selectors cast rows back into those types, so the panel
 * can never silently drift from what the views expect.
 *
 * Seeds are plain functions of `now`: the store calls them from a click handler,
 * never during render, so the prerendered shell stays deterministic.
 */
import type { DatasetSchema, FieldSchema, FixtureRow } from './types';

/* ---------- small deterministic helpers ---------- */

const pad = (value: number) => String(value).padStart(2, '0');

/** Local `YYYY-MM-DDTHH:mm`, exactly what a `datetime-local` input round-trips. */
export function localStamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/** Local calendar day `YYYY-MM-DD`. */
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysAgo(now: Date, days: number, hour = 9, minute = 15): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, hour, minute, 0, 0);
}

/** Deterministic lowercase hex digest (demo checksums/signatures — 64 chars). */
export function demoDigest(seed: string): string {
  let hash = 0x811c9dc5;
  const blocks: string[] = [];
  for (let block = 0; block < 8; block += 1) {
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash = (hash ^ Math.imul(block + 1, 0x9e3779b1)) >>> 0;
    blocks.push(hash.toString(16).padStart(8, '0'));
  }
  return blocks.join('');
}

const HEX_64 = /^[a-f0-9]{64}$/i;

const UNIT_PRICE = 2;
const KIOSK_ID = 'KIOSK-001';

const RECONCILIATION_ID = (index: number) => `mock-log-${pad(index + 1)}`;
const RECONCILIATION_TXN = (index: number) => `TXN-MOCK-${pad(index + 1)}`;

const RECONCILIATION_COUNT = 14;

/* ---------- field helpers ---------- */

const text = (key: string, label: string, extra: Partial<FieldSchema> = {}): FieldSchema => ({
  key,
  label,
  type: 'text',
  width: 'half',
  ...extra,
});

const money = (key: string, label: string): FieldSchema => ({
  key,
  label,
  type: 'number',
  width: 'half',
  step: 0.01,
});

const liters = (key: string, label: string): FieldSchema => ({
  key,
  label,
  type: 'number',
  width: 'half',
  step: 0.01,
  min: 0,
});

const when = (key: string, label: string): FieldSchema => ({
  key,
  label,
  type: 'datetime',
  width: 'half',
});

const flag = (key: string, label: string): FieldSchema => ({
  key,
  label,
  type: 'boolean',
  width: 'half',
});

const choice = (
  key: string,
  label: string,
  options: { value: string; label: string }[]
): FieldSchema => ({ key, label, type: 'select', width: 'half', options });

const WATER_TYPES = [
  { value: 'COMMERCIAL', label: 'Commercial' },
  { value: 'SUBSIDIZED', label: 'Subsidized' },
];

/* ---------- datasets ---------- */

/** `/manager/operations-review`: cards, charts, daily table, records table, receipts. */
const reconciliation: DatasetSchema = {
  id: 'reconciliation',
  title: 'Operations review records',
  description:
    'Feeds the KPI cards, both charts, the daily metrics table and the records table — including anomaly/shortfall badges and the receipt column.',
  fields: [
    text('id', 'Record id', { readOnly: true }),
    text('transactionId', 'Transaction id'),
    text('kioskId', 'Kiosk'),
    text('operatorId', 'Operator id', { help: 'OP-001 format; empty shows “—”.' }),
    when('recordedAt', 'Recorded at'),
    liters('meterVolume', 'Meter volume (L)'),
    money('expectedRevenue', 'Expected revenue'),
    money('reportedCash', 'Reported cash'),
    money('variance', 'Variance'),
    choice('waterType', 'Water type', WATER_TYPES),
    flag('isAnomaly', 'Server anomaly flag'),
    when('acceptedAt', 'Accepted at', ),
    flag('isSynced', 'In Google Sheet'),
    text('proofImageUrl', 'Evidence photo URL', { width: 'full', help: 'Empty shows no photo.' }),
  ],
  seeds: (now) =>
    Array.from({ length: RECONCILIATION_COUNT }, (_, index) => {
      const dayOffset = Math.floor(index / 2);
      const recorded = daysAgo(now, dayOffset, 9 + (index % 2) * 3, 20);
      const meterVolume = 380 + index * 47;
      const expectedRevenue = meterVolume * UNIT_PRICE;
      const shortfall = index % 4 === 0 ? 0 : 15 + index * 6;
      const reportedCash = Number((expectedRevenue - shortfall).toFixed(2));
      const accepted = index < 4;
      return {
        id: RECONCILIATION_ID(index),
        transactionId: RECONCILIATION_TXN(index),
        kioskId: KIOSK_ID,
        operatorId: `OP-${pad((index % 3) + 1)}`,
        recordedAt: localStamp(recorded),
        meterVolume,
        expectedRevenue,
        reportedCash,
        variance: Number((reportedCash - expectedRevenue).toFixed(2)),
        waterType: index % 2 === 0 ? 'COMMERCIAL' : 'SUBSIDIZED',
        isAnomaly: index === 3 || index === 9 || index === 12,
        acceptedAt: accepted ? localStamp(daysAgo(now, dayOffset, 14, 5)) : '',
        isSynced: accepted,
        proofImageUrl: index % 5 === 1 ? 'https://example.com/mock-meter-reading.jpg' : '',
      } satisfies FixtureRow;
    }),
  makeRow: ({ now, index }) => {
    const recorded = daysAgo(now, 0, 10, 30);
    const meterVolume = 500;
    return {
      id: `mock-log-new-${index + 1}`,
      transactionId: `TXN-MOCK-NEW-${index + 1}`,
      kioskId: KIOSK_ID,
      operatorId: 'OP-001',
      recordedAt: localStamp(recorded),
      meterVolume,
      expectedRevenue: meterVolume * UNIT_PRICE,
      reportedCash: meterVolume * UNIT_PRICE,
      variance: 0,
      waterType: 'COMMERCIAL',
      isAnomaly: false,
      acceptedAt: '',
      isSynced: false,
      proofImageUrl: '',
    };
  },
  validate: (row) => {
    if (!row.transactionId) return 'Transaction id is required.';
    if (!row.recordedAt) return 'Recorded at is required.';
    if (typeof row.meterVolume !== 'number' || row.meterVolume <= 0) {
      return 'Meter volume must be greater than 0.';
    }
    if (typeof row.expectedRevenue !== 'number' || row.expectedRevenue <= 0) {
      return 'Expected revenue must be greater than 0.';
    }
    return null;
  },
};

/** `/manager`: the log table and its cursor pagination. */
const logs: DatasetSchema = {
  id: 'logs',
  title: 'Historical logs',
  description:
    'Feeds the submitted-logs table, the “N logs shown” counter and the “Load older logs” cursor (20 per page).',
  fields: [
    text('id', 'Log id', { readOnly: true }),
    text('transactionId', 'Transaction id'),
    text('kioskId', 'Kiosk'),
    when('recordedAt', 'Recorded at'),
    when('createdAt', 'Created at'),
    liters('meterVolume', 'Meter volume (L)'),
  ],
  seeds: (now) =>
    Array.from({ length: 26 }, (_, index) => {
      const recorded = daysAgo(now, index + 1, 8, 5 + (index % 50));
      return {
        id: RECONCILIATION_ID(index),
        transactionId: RECONCILIATION_TXN(index),
        kioskId: KIOSK_ID,
        recordedAt: localStamp(recorded),
        createdAt: localStamp(recorded),
        meterVolume: 380 + index * 47,
      } satisfies FixtureRow;
    }).reverse(),
  makeRow: ({ now, index }) => {
    const recorded = daysAgo(now, 0, 11, 10);
    return {
      id: `mock-log-new-${index + 1}`,
      transactionId: `TXN-MOCK-NEW-${index + 1}`,
      kioskId: KIOSK_ID,
      recordedAt: localStamp(recorded),
      createdAt: localStamp(recorded),
      meterVolume: 420,
    };
  },
  validate: (row) => {
    if (!row.transactionId) return 'Transaction id is required.';
    if (typeof row.meterVolume !== 'number' || row.meterVolume <= 0) {
      return 'Meter volume must be greater than 0.';
    }
    return null;
  },
};

/**
 * Inspection modal: three rows demonstrate the three checksum outcomes. Rows
 * whose id matches a reconciliation row override the synthesised VERIFIED view.
 */
const inspection: DatasetSchema = {
  id: 'inspection',
  title: 'Log inspection',
  description:
    'The read-only inspection modal. Rows here override the record with the same id; any other record is shown as VERIFIED.',
  fields: [
    text('id', 'Log id', { readOnly: true, help: 'Must match a record id to override it.' }),
    text('transactionId', 'Transaction id'),
    text('kioskId', 'Kiosk'),
    text('operatorId', 'Operator id'),
    when('recordedAt', 'Recorded at'),
    when('createdAt', 'Created at'),
    liters('meterVolume', 'Meter volume (L)'),
    money('expectedRevenue', 'Expected revenue'),
    money('reportedCash', 'Reported cash'),
    money('variance', 'Variance'),
    choice('waterType', 'Water type', WATER_TYPES),
    flag('isAnomaly', 'Anomaly'),
    text('proofImageUrl', 'Evidence photo URL', { width: 'full' }),
    when('acceptedAt', 'Accepted at'),
    flag('isSynced', 'In Google Sheet'),
    choice('verificationStatus', 'Checksum verdict', [
      { value: 'VERIFIED', label: 'Verified' },
      { value: 'CHECKSUM_MISMATCH', label: 'Checksum mismatch' },
      { value: 'NO_CHECKSUM', label: 'No checksum on record' },
    ]),
    choice('checksumFormat', 'Checksum format', [
      { value: 'v1', label: 'v1' },
      { value: 'legacy', label: 'legacy' },
      { value: 'receipt', label: 'receipt' },
      { value: '', label: 'None' },
    ]),
    text('storedChecksum', 'Stored checksum', { width: 'full', help: '64 hex characters.' }),
    text('recomputedChecksum', 'Recomputed checksum', { width: 'full', help: '64 hex characters.' }),
    text('algorithm', 'Algorithm', { readOnly: true }),
    when('verifiedAt', 'Verified at'),
  ],
  seeds: (now) => {
    const base = daysAgo(now, 1, 9, 20);
    const make = (
      index: number,
      status: 'VERIFIED' | 'CHECKSUM_MISMATCH' | 'NO_CHECKSUM',
      format: string,
      accepted: boolean
    ): FixtureRow => {
      const stored = status === 'NO_CHECKSUM' ? '' : demoDigest(`stored-${index}`);
      const recomputed =
        status === 'VERIFIED' ? stored : status === 'CHECKSUM_MISMATCH' ? demoDigest(`tampered-${index}`) : '';
      return {
        id: RECONCILIATION_ID(index),
        transactionId: RECONCILIATION_TXN(index),
        kioskId: KIOSK_ID,
        operatorId: 'OP-001',
        recordedAt: localStamp(base),
        createdAt: localStamp(base),
        meterVolume: 380 + index * 47,
        expectedRevenue: (380 + index * 47) * UNIT_PRICE,
        reportedCash: (380 + index * 47) * UNIT_PRICE - 20,
        variance: -20,
        waterType: 'COMMERCIAL',
        isAnomaly: false,
        proofImageUrl: index === 0 ? 'https://example.com/mock-meter-reading.jpg' : '',
        acceptedAt: accepted ? localStamp(daysAgo(now, 1, 15, 30)) : '',
        isSynced: accepted,
        verificationStatus: status,
        checksumFormat: format,
        storedChecksum: stored,
        recomputedChecksum: recomputed,
        algorithm: 'SHA-256',
        verifiedAt: localStamp(daysAgo(now, 0, 8, 45)),
      } satisfies FixtureRow;
    };
    return [
      make(0, 'VERIFIED', 'receipt', false),
      make(3, 'CHECKSUM_MISMATCH', 'v1', false),
      make(6, 'NO_CHECKSUM', '', true),
    ];
  },
  makeRow: ({ now, index }) => ({
    id: `mock-log-new-${index + 1}`,
    transactionId: `TXN-MOCK-NEW-${index + 1}`,
    kioskId: KIOSK_ID,
    operatorId: 'OP-001',
    recordedAt: localStamp(daysAgo(now, 0, 10, 0)),
    createdAt: localStamp(daysAgo(now, 0, 10, 0)),
    meterVolume: 500,
    expectedRevenue: 1000,
    reportedCash: 990,
    variance: -10,
    waterType: 'COMMERCIAL',
    isAnomaly: false,
    proofImageUrl: '',
    acceptedAt: '',
    isSynced: false,
    verificationStatus: 'VERIFIED',
    checksumFormat: 'v1',
    storedChecksum: demoDigest('new-stored'),
    recomputedChecksum: demoDigest('new-stored'),
    algorithm: 'SHA-256',
    verifiedAt: localStamp(daysAgo(now, 0, 10, 5)),
  }),
  validate: (row) => {
    const status = String(row.verificationStatus ?? '');
    if (status !== 'NO_CHECKSUM') {
      const stored = String(row.storedChecksum ?? '');
      if (!HEX_64.test(stored)) return 'Stored checksum must be 64 hex characters.';
      if (status === 'VERIFIED' && row.recomputedChecksum !== stored) {
        return 'A VERIFIED record needs an identical recomputed checksum.';
      }
      if (status === 'CHECKSUM_MISMATCH' && row.recomputedChecksum === stored) {
        return 'A mismatch needs two different checksums.';
      }
    }
    return null;
  },
};

/** `/manager/stakeholder-analytics`: the month payload behind the KPI cards and both tabs. */
const stakeholder: DatasetSchema = {
  id: 'stakeholder',
  title: 'Stakeholder analytics',
  description:
    'The monthly payload: three KPI cards, the Overview comparison and the Social Assistance subsidized-vs-commercial chart.',
  singleton: true,
  fields: [
    text('month', 'Month', { help: 'YYYY-MM — matches the month picker.' }),
    money('totalGrossRevenue', 'Total gross revenue'),
    money('outstandingUncollectedCash', 'Outstanding uncollected cash'),
    { key: 'waterLossPercentage', label: 'Water loss (%)', type: 'number', width: 'half', step: 0.01, min: 0, max: 100 },
    liters('subsidizedVolumeLiters', 'Subsidized volume (L)'),
    liters('commercialSalesVolumeLiters', 'Commercial volume (L)'),
  ],
  seeds: (now) => [
    {
      month: `${now.getFullYear()}-${pad(now.getMonth() + 1)}`,
      totalGrossRevenue: 48250.5,
      outstandingUncollectedCash: 1260,
      waterLossPercentage: 2.78,
      subsidizedVolumeLiters: 8500,
      commercialSalesVolumeLiters: 22500,
    },
  ],
  makeRow: ({ now }) => ({
    month: `${now.getFullYear()}-${pad(now.getMonth() + 1)}`,
    totalGrossRevenue: 10000,
    outstandingUncollectedCash: 0,
    waterLossPercentage: 0,
    subsidizedVolumeLiters: 0,
    commercialSalesVolumeLiters: 0,
  }),
  validate: (row) => {
    const month = String(row.month ?? '');
    if (!/^\d{4}-\d{2}$/.test(month)) return 'Month must be YYYY-MM.';
    const loss = row.waterLossPercentage;
    if (typeof loss !== 'number' || loss < 0 || loss > 100) {
      return 'Water loss must be between 0 and 100.';
    }
    return null;
  },
};

/** Operator page queue: the "Waiting to sync" counter and the pending list. */
const queue: DatasetSchema = {
  id: 'queue',
  title: 'Offline queue',
  description:
    'Feeds “Waiting to sync”, the pending-entries list (newest four) and the “All caught up” empty state.',
  fields: [
    text('transaction_id', 'Transaction id'),
    text('kiosk_id', 'Kiosk'),
    liters('meter_volume', 'Meter volume (L)'),
    when('recorded_at', 'Recorded at'),
    text('operator_id', 'Operator id'),
    money('reported_cash', 'Reported cash'),
    flag('evidence_pending', 'Evidence pending'),
  ],
  seeds: (now) =>
    [0, 1, 2].map((index) => ({
      transaction_id: `TXN-QUEUED-${pad(index + 1)}`,
      kiosk_id: KIOSK_ID,
      meter_volume: 240 + index * 60,
      recorded_at: localStamp(daysAgo(now, 0, 8 + index, 10)),
      operator_id: 'OP-001',
      reported_cash: (240 + index * 60) * UNIT_PRICE,
      evidence_pending: index === 2,
    })),
  makeRow: ({ now, index }) => ({
    transaction_id: `TXN-QUEUED-NEW-${index + 1}`,
    kiosk_id: KIOSK_ID,
    meter_volume: 300,
    recorded_at: localStamp(daysAgo(now, 0, 12, 0)),
    operator_id: 'OP-001',
    reported_cash: 600,
    evidence_pending: false,
  }),
  validate: (row) => {
    if (!row.transaction_id) return 'Transaction id is required.';
    if (typeof row.meter_volume !== 'number' || row.meter_volume <= 0) {
      return 'Meter volume must be greater than 0.';
    }
    return null;
  },
};

/** Operator page quarantine counter ("Isolated for review"). */
const quarantine: DatasetSchema = {
  id: 'quarantine',
  title: 'Isolated entries',
  description:
    'Feeds the “Isolated for review” counter. Each row is one quarantined offline entry.',
  fields: [
    text('transaction_id', 'Transaction id'),
    text('reason', 'Reason', { width: 'full' }),
    when('quarantined_at', 'Quarantined at'),
  ],
  seeds: (now) => [
    {
      transaction_id: 'TXN-CORRUPT-01',
      reason: 'Checksum mismatch on local storage',
      quarantined_at: localStamp(daysAgo(now, 2, 17, 40)),
    },
  ],
  makeRow: ({ now, index }) => ({
    transaction_id: `TXN-CORRUPT-NEW-${index + 1}`,
    reason: 'Server rejected the payload',
    quarantined_at: localStamp(daysAgo(now, 0, 13, 0)),
  }),
  validate: (row) => (row.transaction_id ? null : 'Transaction id is required.'),
};

/** Operator page proof receipts. */
const receipts: DatasetSchema = {
  id: 'receipts',
  title: 'Proof receipts',
  description:
    'The signed SHA-256 receipt cards under the submission form. Checksum and signature must be 64 hex characters and the hash must match the checksum.',
  fields: [
    text('receiptId', 'Receipt id'),
    text('transactionId', 'Transaction id'),
    text('kioskId', 'Kiosk'),
    text('operatorId', 'Operator id'),
    liters('meterVolume', 'Meter volume (L)'),
    money('reportedCash', 'Reported cash'),
    when('recordedAt', 'Recorded at'),
    when('issuedAt', 'Issued at'),
    when('signedAt', 'Signed at'),
    text('checksum', 'Checksum', { width: 'full', help: '64 hex characters.' }),
    text('hash', 'Hash', { width: 'full', help: 'Must equal the checksum.' }),
    text('signature', 'Signature', { width: 'full', help: '64 hex characters.' }),
    text('algorithm', 'Algorithm', { readOnly: true }),
    text('proofImageUrl', 'Proof image URL', { width: 'full' }),
    text('evidencePath', 'Evidence path', { width: 'full' }),
  ],
  seeds: (now) =>
    [0, 1].map((index) => {
      const checksum = demoDigest(`receipt-checksum-${index}`);
      const recorded = daysAgo(now, index, 9, 25);
      return {
        receiptId: `RCPT-MOCK-${pad(index + 1)}`,
        transactionId: RECONCILIATION_TXN(index),
        kioskId: KIOSK_ID,
        operatorId: 'OP-001',
        meterVolume: 380 + index * 47,
        reportedCash: (380 + index * 47) * UNIT_PRICE,
        recordedAt: localStamp(recorded),
        issuedAt: localStamp(daysAgo(now, index, 9, 26)),
        signedAt: localStamp(daysAgo(now, index, 9, 26)),
        checksum,
        hash: checksum,
        signature: demoDigest(`receipt-signature-${index}`),
        algorithm: 'SHA-256',
        proofImageUrl: index === 0 ? 'https://example.com/mock-meter-reading.jpg' : '',
        evidencePath: '',
      } satisfies FixtureRow;
    }),
  makeRow: ({ now }) => {
    const checksum = demoDigest(`new-receipt-${now.getTime() % 100000}`);
    return {
      receiptId: 'RCPT-MOCK-NEW',
      transactionId: 'TXN-MOCK-NEW',
      kioskId: KIOSK_ID,
      operatorId: 'OP-001',
      meterVolume: 400,
      reportedCash: 800,
      recordedAt: localStamp(daysAgo(now, 0, 10, 0)),
      issuedAt: localStamp(daysAgo(now, 0, 10, 1)),
      signedAt: localStamp(daysAgo(now, 0, 10, 1)),
      checksum,
      hash: checksum,
      signature: demoDigest('new-receipt-signature'),
      algorithm: 'SHA-256',
      proofImageUrl: '',
      evidencePath: '',
    };
  },
  validate: (row) => {
    const checksum = String(row.checksum ?? '');
    const hash = String(row.hash ?? '');
    const signature = String(row.signature ?? '');
    if (!HEX_64.test(checksum)) return 'Checksum must be 64 hex characters.';
    if (hash !== checksum) return 'Hash must equal the checksum.';
    if (!HEX_64.test(signature)) return 'Signature must be 64 hex characters.';
    return null;
  },
};

/** Operator page status pill + heartbeat widget + kiosk id. */
const kioskStatus: DatasetSchema = {
  id: 'kioskStatus',
  title: 'Kiosk status',
  description:
    'Drives the status pill (Online / Offline / Checking), the heartbeat widget and the kiosk id in the heading.',
  singleton: true,
  fields: [
    text('kioskId', 'Kiosk id'),
    flag('isOnline', 'Browser online'),
    choice('connection', 'Connection', [
      { value: 'connected', label: 'connected' },
      { value: 'retrying', label: 'retrying' },
      { value: 'dropped', label: 'dropped' },
    ]),
    choice('pingStatus', 'Heartbeat', [
      { value: 'idle', label: 'idle (waiting)' },
      { value: 'ok', label: 'ok' },
      { value: 'failed', label: 'failed' },
    ]),
    text('lastPingTime', 'Last response', { help: 'Shown after “Heartbeat”.' }),
  ],
  seeds: (now) => [
    {
      kioskId: KIOSK_ID,
      isOnline: true,
      connection: 'connected',
      pingStatus: 'ok',
      lastPingTime: localStamp(daysAgo(now, 0, 20, 12)).slice(11),
    },
  ],
  makeRow: ({ now }) => ({
    kioskId: KIOSK_ID,
    isOnline: true,
    connection: 'connected',
    pingStatus: 'ok',
    lastPingTime: localStamp(daysAgo(now, 0, 12, 0)).slice(11),
  }),
};

/** Operator page inline notice (success / warning / error). */
const notice: DatasetSchema = {
  id: 'notice',
  title: 'Operator notice',
  description:
    'The inline banner under the submission form. Empty text hides the banner.',
  singleton: true,
  fields: [
    choice('kind', 'Kind', [
      { value: 'success', label: 'success' },
      { value: 'warning', label: 'warning' },
      { value: 'error', label: 'error' },
    ]),
    text('text', 'Message', { width: 'full' }),
  ],
  seeds: () => [
    {
      kind: 'success',
      text: 'Receipt signed and stored on the server. Mock receipt shown for the demo.',
    },
  ],
  makeRow: () => ({ kind: 'warning', text: 'Connection was lost. Entry saved on this device.' }),
};

export const MOCK_DATASETS: readonly DatasetSchema[] = [
  reconciliation,
  logs,
  inspection,
  stakeholder,
  queue,
  quarantine,
  receipts,
  kioskStatus,
  notice,
];
