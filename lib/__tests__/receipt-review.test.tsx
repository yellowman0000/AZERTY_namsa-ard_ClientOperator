import { afterEach, describe, expect, it, mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewTable } from '../../app/manager/manager-dashboard';
import { InspectionBody, ReceiptStatus } from '../../app/manager/log-inspection-modal';
import { acceptReceipt, type InspectedLog } from '../logs';
import type { ReconciliationRecord } from '../reconciliation';

const record = (overrides: Partial<ReconciliationRecord> = {}): ReconciliationRecord => ({
  id: 'log-1',
  transactionId: 'TXN-001',
  kioskId: 'KIOSK-001',
  operatorId: 'OP-104',
  meterVolume: 500,
  reportedCash: 1000,
  expectedRevenue: 1000,
  variance: 0,
  isAnomaly: false,
  recordedAt: '2026-11-12T10:00:00.000Z',
  ...overrides,
});

describe('Receipt status', () => {
  it('shows awaiting / accepted-pending / in-sheet states', () => {
    expect(renderToStaticMarkup(<ReceiptStatus acceptedAt={null} />)).toContain('Awaiting review');
    expect(renderToStaticMarkup(<ReceiptStatus acceptedAt="2026-11-12T11:00:00Z" isSynced={false} />)).toContain(
      'Accepted · sheet pending'
    );
    expect(renderToStaticMarkup(<ReceiptStatus acceptedAt="2026-11-12T11:00:00Z" isSynced />)).toContain(
      'Accepted · in Google Sheet'
    );
  });
});

describe('ReviewTable receipt column', () => {
  it('offers Review for a receipt awaiting acceptance and View once accepted', () => {
    const html = renderToStaticMarkup(
      <ReviewTable
        records={[
          record(),
          record({ id: 'log-2', transactionId: 'TXN-002', acceptedAt: '2026-11-12T11:00:00Z', isSynced: true }),
        ]}
        onReview={() => {}}
      />
    );

    expect(html).toContain('aria-label="Review receipt TXN-001"');
    expect(html).toContain('aria-label="View receipt TXN-002"');
    expect(html).toContain('Awaiting review');
    expect(html).toContain('Accepted · in Google Sheet');
  });

  it('has no action column without a review handler', () => {
    const html = renderToStaticMarkup(<ReviewTable records={[record()]} />);
    expect(html).not.toContain('Review receipt');
  });
});

describe('InspectionBody receipt details', () => {
  const log: InspectedLog = {
    id: 'log-1',
    transactionId: 'TXN-001',
    kioskId: 'KIOSK-001',
    meterVolume: 10,
    recordedAt: '2026-11-12T10:00:00.000Z',
    createdAt: '2026-11-12T10:00:01.000Z',
    operatorId: 'OP-104',
    reportedCash: 20,
    expectedRevenue: 20,
    variance: 0,
    isAnomaly: false,
    proofImageUrl: 'https://i.ibb.co/x/proof.jpg',
    acceptedAt: null,
    isSynced: false,
  };
  const verification = {
    status: 'VERIFIED' as const,
    algorithm: 'SHA-256' as const,
    format: 'v1' as const,
    storedChecksum: 'a'.repeat(64),
    recomputedChecksum: 'a'.repeat(64),
    verifiedAt: '2026-11-12T12:00:00.000Z',
  };

  it('shows the operator evidence photo and the review status', () => {
    const html = renderToStaticMarkup(<InspectionBody inspection={{ log, verification }} />);
    expect(html).toContain('src="https://i.ibb.co/x/proof.jpg"');
    expect(html).toContain('Awaiting review');
  });

  it('says when no photo was attached', () => {
    const html = renderToStaticMarkup(
      <InspectionBody inspection={{ log: { ...log, proofImageUrl: null }, verification }} />
    );
    expect(html).toContain('No photo was attached');
  });
});

describe('acceptReceipt', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('POSTs to the accept endpoint and returns the sheet result', async () => {
    const fetchMock = mock(async () =>
      Response.json({
        logId: 'log/1',
        transactionId: 'TXN-001',
        acceptedAt: '2026-11-12T11:00:00.000Z',
        acceptedBy: null,
        alreadyAccepted: false,
        sheet: { status: 'SYNCED', updatedRange: "'DailyLogs'!A2:O2" },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await acceptReceipt('log/1');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/kiosk/logs/log%2F1/accept');
    expect(init.method).toBe('POST');
    expect(result.sheet.status).toBe('SYNCED');
  });

  it('surfaces the server message on an error', async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ message: 'Log "x" not found.' }, { status: 404 })
    ) as unknown as typeof fetch;

    await expect(acceptReceipt('x')).rejects.toThrow('Log "x" not found.');
  });
});
