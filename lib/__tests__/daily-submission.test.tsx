import { afterEach, describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import OperatorConsole from '../../app/page';
import ProofReceipt from '../../app/proof-receipt';
import {
  parseSignedReceipt,
  submitTransactionLog,
  type SignedReceipt,
  type TransactionPayload,
} from '../api';
import {
  MAX_EVIDENCE_BYTES,
  SUBMISSION_MESSAGES,
  isAcceptableEvidence,
  receiptMatchesSubmission,
  validateDailySubmission,
} from '../submission';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const baseInput = {
  volume: '12.5',
  cash: '950',
  operatorId: 'OP-104',
  kioskId: 'KIOSK-001',
  transactionId: 'TXN-2026-11-06',
  recordedAt: '2026-11-06T10:00:00.000Z',
};

function validRecord(): TransactionPayload {
  const result = validateDailySubmission(baseInput);
  if (!result.ok) throw new Error(`expected a valid submission: ${result.error}`);
  return result.record;
}

function buildReceipt(overrides: Partial<SignedReceipt> = {}): SignedReceipt {
  const record = validRecord();
  return {
    receiptId: 'RCPT-2026-11-06',
    transactionId: record.transaction_id,
    kioskId: record.kiosk_id,
    operatorId: record.operator_id ?? '',
    meterVolume: record.meter_volume,
    reportedCash: record.reported_cash ?? 0,
    recordedAt: record.recorded_at,
    checksum: 'a'.repeat(64),
    hash: 'a'.repeat(64),
    signature: 'b'.repeat(64),
    algorithm: 'SHA-256',
    issuedAt: '2026-11-06T10:00:01.000Z',
    signedAt: '2026-11-06T10:00:01.000Z',
    ...overrides,
  };
}

function tagWithId(html: string, id: string): string {
  const match = html.match(new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`));
  if (!match) throw new Error(`no element with id="${id}" in the markup`);
  return match[0];
}

describe('Daily cash & liter submission form', () => {
  const html = renderToStaticMarkup(<OperatorConsole />);

  it('shows the operator a meter reading and cash field for the daily totals', () => {
    expect(html).toContain('Daily cash &amp; liter submission');

    const volume = tagWithId(html, 'volume');
    expect(volume).toContain('type="number"');
    expect(volume).toContain('min="0.01"');
    expect(volume).toContain('step="0.01"');
    expect(volume).toContain('required');

    const cash = tagWithId(html, 'reported-cash');
    expect(cash).toContain('type="number"');
    expect(cash).toContain('min="0"');
    expect(cash).toContain('step="0.01"');
    expect(cash).toContain('required');

    expect(html).toContain('Cash submitted');
    expect(html).toContain('Liters (L)');
  });

  it('requires the Field Operator ID that will be recorded on the receipt', () => {
    const operatorId = tagWithId(html, 'operator-id');
    expect(operatorId).toContain('type="text"');
    expect(operatorId).toContain('maxLength="64"');
    expect(operatorId).toContain('required');
    expect(html).toContain('Operator ID');
  });

  it('accepts an optional JPEG, PNG, or WebP evidence photo', () => {
    const evidence = tagWithId(html, 'evidence-photo');
    expect(evidence).toContain('type="file"');
    expect(evidence).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(evidence).toContain('capture="environment"');
    expect(html).toContain('Reading evidence photo');
    expect(html).toContain('Optional');
    expect(html).toContain('Offline photos stay on this device until sync.');
  });

  it('offers a submit action and states that a signed receipt follows', () => {
    expect(html).toContain('Submit daily totals');
    expect(html).toContain(
      'The server returns a signed SHA-256 proof receipt after saving your submission.'
    );
  });

  it('starts with an empty receipt list and an empty offline queue', () => {
    expect(html).not.toContain('Daily submission receipt');
    expect(html).toContain('All caught up');
    expect(html).toContain('Waiting to sync');
  });
});

describe('validateDailySubmission', () => {
  it.each([
    ['missing', ''],
    ['zero', '0'],
    ['negative', '-2'],
    ['not a number', 'abc'],
  ])('rejects a %s meter volume', (_label, volume) => {
    const result = validateDailySubmission({ ...baseInput, volume });
    expect(result).toEqual({ ok: false, error: SUBMISSION_MESSAGES.volume });
  });

  it('converts the meter reading to a number for the payload', () => {
    const result = validateDailySubmission({ ...baseInput, volume: '12.5' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.meter_volume).toBe(12.5);
    expect(typeof result.record.meter_volume).toBe('number');
  });

  it('requires a Field Operator ID and trims it before submitting', () => {
    expect(validateDailySubmission({ ...baseInput, operatorId: '   ' })).toEqual({
      ok: false,
      error: SUBMISSION_MESSAGES.operatorId,
    });

    const result = validateDailySubmission({ ...baseInput, operatorId: '  OP-9  ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.operator_id).toBe('OP-9');
  });

  it('requires cash, allows zero, and rejects negative or non-numeric amounts', () => {
    for (const cash of ['', '   ', '-1', 'abc']) {
      expect(validateDailySubmission({ ...baseInput, cash })).toEqual({
        ok: false,
        error: SUBMISSION_MESSAGES.cash,
      });
    }

    const zero = validateDailySubmission({ ...baseInput, cash: '0' });
    expect(zero.ok).toBe(true);
    if (!zero.ok) return;
    expect(zero.record.reported_cash).toBe(0);
  });

  it('builds the cumulative-meter payload tied to the kiosk and submission time', () => {
    const record = validRecord();
    expect(record).toEqual({
      transaction_id: 'TXN-2026-11-06',
      kiosk_id: 'KIOSK-001',
      reading_type: 'CUMULATIVE_METER',
      operator_id: 'OP-104',
      meter_volume: 12.5,
      reported_cash: 950,
      recorded_at: '2026-11-06T10:00:00.000Z',
    });
  });

  it('marks whether a photo was attached so the receipt can be checked for evidence', () => {
    const withoutPhoto = validateDailySubmission(baseInput);
    expect(withoutPhoto.ok && withoutPhoto.hasEvidence).toBe(false);

    const withPhoto = validateDailySubmission({
      ...baseInput,
      evidencePhoto: { type: 'image/jpeg', size: 4096 },
    });
    expect(withPhoto.ok && withPhoto.hasEvidence).toBe(true);
  });

  it('rejects an unsupported or oversized evidence photo', () => {
    for (const evidencePhoto of [
      { type: 'image/gif', size: 4096 },
      { type: 'application/pdf', size: 4096 },
      { type: 'image/jpeg', size: MAX_EVIDENCE_BYTES + 1 },
    ]) {
      expect(validateDailySubmission({ ...baseInput, evidencePhoto })).toEqual({
        ok: false,
        error: SUBMISSION_MESSAGES.evidence,
      });
    }
  });

  it('accepts a supported photo at the 5 MB limit', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(
        isAcceptableEvidence({ type, size: MAX_EVIDENCE_BYTES })
      ).toBe(true);
    }
    expect(validateDailySubmission({
      ...baseInput,
      evidencePhoto: { type: 'image/png', size: MAX_EVIDENCE_BYTES },
    }).ok).toBe(true);
  });
});

describe('receiptMatchesSubmission', () => {
  it('accepts the receipt issued for the submitted totals', () => {
    const record = validRecord();
    expect(receiptMatchesSubmission(buildReceipt(), record)).toBe(true);
  });

  it('rejects a receipt whose cash or volume belongs to another submission', () => {
    const record = validRecord();
    expect(
      receiptMatchesSubmission(buildReceipt({ reportedCash: 940 }), record)
    ).toBe(false);
    expect(
      receiptMatchesSubmission(buildReceipt({ meterVolume: 11 }), record)
    ).toBe(false);
  });

  it('requires stored evidence when the operator attached a photo', () => {
    const record = validRecord();
    expect(
      receiptMatchesSubmission(buildReceipt(), record, true)
    ).toBe(false);
    expect(
      receiptMatchesSubmission(
        buildReceipt({ proofImageUrl: '/api/kiosk/logs/TXN-2026-11-06/evidence/a.jpg' }),
        record,
        true
      )
    ).toBe(true);
    expect(
      receiptMatchesSubmission(
        buildReceipt({ evidencePath: '/api/kiosk/logs/TXN-2026-11-06/evidence/a.jpg' }),
        record,
        true
      )
    ).toBe(true);
  });
});

describe('submission to proof receipt view', () => {
  it('shows the receipt issued for the totals the operator entered', async () => {
    const record = validRecord();
    const proofImageUrl = `/api/kiosk/logs/${record.transaction_id}/evidence/${'a'.repeat(64)}.jpg`;
    const receipt = buildReceipt({ proofImageUrl });
    let requestBody: Record<string, unknown> = {};

    globalThis.fetch = (async (_input, init) => {
      if (typeof init?.body === 'string') {
        requestBody = JSON.parse(init.body) as Record<string, unknown>;
      }
      return new Response(JSON.stringify({ ack: true, logId: 'log-1', receipt }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await submitTransactionLog(record, {
      serverUrl: 'http://localhost:3001/api/kiosk/logs',
      retryDelaysMs: [],
    });

    expect(requestBody).toMatchObject({
      operator_id: 'OP-104',
      reported_cash: 950,
      meter_volume: 12.5,
      reading_type: 'CUMULATIVE_METER',
    });

    const parsed = parseSignedReceipt(result.receipt);
    expect(parsed).toBeDefined();
    if (!parsed) return;
    expect(receiptMatchesSubmission(parsed, record, true)).toBe(true);

    const html = renderToStaticMarkup(<ProofReceipt receipt={parsed} />);
    expect(html).toContain('<details class="proof-receipt">');
    expect(html).toContain('Daily submission receipt');
    expect(html).toContain('Receipt RCPT-2026-11-06');
    expect(html).toContain('Signed');
    expect(html).toContain('OP-104');
    expect(html).toContain('Cash submitted');
    expect(html).toMatch(/12[.,]50 L/);
    expect(html).toMatch(/950[.,]00/);
    expect(html).toContain('SHA-256 checksum');
    expect(html).toContain('Server signature (HMAC-SHA256)');
    expect(html).toContain('View uploaded photo');
    expect(html).toContain(proofImageUrl);
    expect(html).toContain('Print / Save as PDF');
  });
});
