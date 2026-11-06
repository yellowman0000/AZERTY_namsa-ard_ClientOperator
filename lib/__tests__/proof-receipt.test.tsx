import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ProofReceipt from '../../app/proof-receipt';
import type { SignedReceipt } from '../api';

const receipt: SignedReceipt = {
  receiptId: 'RCPT-001',
  transactionId: 'TXN-001',
  kioskId: 'KIOSK-001',
  operatorId: 'OP-104',
  meterVolume: 12.5,
  reportedCash: 950,
  recordedAt: '2026-11-06T10:00:00.000Z',
  checksum: 'a'.repeat(64),
  hash: 'a'.repeat(64),
  signature: 'b'.repeat(64),
  algorithm: 'SHA-256',
  proofImageUrl: '/api/kiosk/logs/TXN-001/evidence/photo.jpg',
  issuedAt: '2026-11-06T10:00:01.000Z',
  signedAt: '2026-11-06T10:00:01.000Z',
};

describe('ProofReceipt', () => {
  it('starts collapsed with a compact summary while preserving receipt details', () => {
    const html = renderToStaticMarkup(<ProofReceipt receipt={receipt} />);

    expect(html).toContain('<details class="proof-receipt">');
    expect(html).not.toContain('<details class="proof-receipt" open');
    expect(html).toContain('Daily submission receipt');
    expect(html).toContain('Receipt RCPT-001');
    expect(html).toContain('Signed');
    expect(html).toContain('SHA-256 checksum');
    expect(html).toContain('View uploaded photo');
    expect(html).toContain('Print / Save as PDF');
  });
});
