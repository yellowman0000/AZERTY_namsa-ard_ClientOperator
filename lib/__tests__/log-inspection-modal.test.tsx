import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { InspectionBody } from '../../app/manager/log-inspection-modal';
import type { ChecksumVerification, InspectedLog, LogInspection } from '../logs';

const STORED = 'a'.repeat(64);
const RECOMPUTED = 'b'.repeat(64);

const log: InspectedLog = {
  id: 'log-1',
  transactionId: 'TXN-001',
  kioskId: 'KIOSK-001',
  meterVolume: 150.75,
  recordedAt: '2026-11-04T10:00:00.000Z',
  createdAt: '2026-11-04T10:00:01.000Z',
  operatorId: null,
  reportedCash: null,
  expectedRevenue: null,
  variance: null,
  isAnomaly: null,
};

const verification = (overrides: Partial<ChecksumVerification>): ChecksumVerification => ({
  status: 'VERIFIED',
  algorithm: 'SHA-256',
  format: 'v1',
  storedChecksum: STORED,
  recomputedChecksum: STORED,
  verifiedAt: '2026-11-06T08:00:00.000Z',
  ...overrides,
});

const render = (inspection: LogInspection) => renderToStaticMarkup(<InspectionBody inspection={inspection} />);

describe('InspectionBody', () => {
  it('shows a green "Verified (Tamper-Evident)" badge for a matching checksum', () => {
    const html = render({ log, verification: verification({}) });

    expect(html).toContain('verify-verified');
    expect(html).toContain('Verified (Tamper-Evident)');
    expect(html).not.toContain('Checksum Mismatch');
    expect(html).toContain('SHA-256 · v1 payload');
  });

  it('shows a red "Checksum Mismatch" badge and both hashes when the record changed', () => {
    const html = render({
      log,
      verification: verification({ status: 'CHECKSUM_MISMATCH', recomputedChecksum: RECOMPUTED }),
    });

    expect(html).toContain('verify-mismatch');
    expect(html).toContain('Checksum Mismatch');
    expect(html).not.toContain('Verified (Tamper-Evident)');
    expect(html).toContain(STORED);
    expect(html).toContain(RECOMPUTED);
  });

  it('says a log without a checksum cannot be verified, without a proof section', () => {
    const html = render({
      log,
      verification: verification({
        status: 'NO_CHECKSUM',
        format: null,
        storedChecksum: null,
        recomputedChecksum: null,
      }),
    });

    expect(html).toContain('verify-unverified');
    expect(html).toContain('No checksum on record');
    expect(html).not.toContain('Checksum proof');
  });

  it('shows the stored log details', () => {
    const html = render({ log, verification: verification({}) });

    for (const text of ['TXN-001', 'KIOSK-001', 'log-1', '150.75 L', 'dateTime="2026-11-04T10:00:00.000Z"']) {
      expect(html).toContain(text);
    }
  });

  it('shows reconciliation fields only when the server has them', () => {
    const without = render({ log, verification: verification({}) });
    const withThem = render({
      log: { ...log, operatorId: 'OP-7', reportedCash: 950, expectedRevenue: 1000, variance: -50, isAnomaly: true },
      verification: verification({}),
    });

    for (const label of ['Operator ID', 'Reported cash', 'Expected revenue', 'Variance', 'Volume anomaly']) {
      expect(without).not.toContain(label);
      expect(withThem).toContain(label);
    }
    expect(withThem).toContain('OP-7');
    expect(withThem).toContain('Flagged');
  });

  it('is read-only: renders no editable controls', () => {
    const html = render({ log, verification: verification({}) });

    expect(html).not.toMatch(/<(input|textarea|select)\b|contenteditable/i);
  });
});
