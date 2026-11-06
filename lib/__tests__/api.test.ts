import { afterEach, describe, expect, it } from 'bun:test';
import {
  CorruptedPayloadError,
  DuplicateTransactionError,
  EvidenceStorageUnavailableError,
  submitTransactionLog,
  type TransactionPayload,
} from '../api';

const originalFetch = globalThis.fetch;
const payload: TransactionPayload = {
  transaction_id: 'test-transaction',
  kiosk_id: 'KIOSK-001',
  meter_volume: 12.5,
  recorded_at: '2026-10-19T00:00:00.000Z',
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('transaction server acknowledgements', () => {
  it('accepts an explicit server acknowledgement', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ack: true, logId: 'log-1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    await expect(
      submitTransactionLog(payload, { serverUrl: 'http://localhost:3001/api/kiosk/logs', retryDelaysMs: [] })
    ).resolves.toMatchObject({ ack: true, logId: 'log-1' });
  });

  it('sends operator totals and returns the signed proof receipt', async () => {
    const submission = {
      ...payload,
      reading_type: 'CUMULATIVE_METER' as const,
      operator_id: 'OP-104',
      reported_cash: 950,
    };
    const receipt = {
      receiptId: 'RCPT-test',
      transactionId: submission.transaction_id,
      kioskId: submission.kiosk_id,
      operatorId: submission.operator_id,
      meterVolume: submission.meter_volume,
      reportedCash: submission.reported_cash,
      recordedAt: submission.recorded_at,
      checksum: 'a'.repeat(64),
      hash: 'a'.repeat(64),
      signature: 'b'.repeat(64),
      algorithm: 'SHA-256',
      issuedAt: '2026-10-19T00:00:01.000Z',
      signedAt: '2026-10-19T00:00:01.000Z',
    };
    let requestBody = '';
    globalThis.fetch = (async (_input, init) => {
      if (typeof init?.body === 'string') requestBody = init.body;
      return new Response(JSON.stringify({ ack: true, logId: 'log-3', receipt }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await expect(
      submitTransactionLog(submission, {
        serverUrl: 'http://localhost:3001/api/kiosk/logs',
        retryDelaysMs: [],
      })
    ).resolves.toMatchObject({ ack: true, logId: 'log-3', receipt });

    expect(JSON.parse(requestBody)).toMatchObject({
      operatorId: 'OP-104',
      reportedCash: 950,
      readingType: 'CUMULATIVE_METER',
    });
  });

  it('uploads reading evidence before posting the log and links it in the receipt', async () => {
    const proofImageUrl = `/api/kiosk/logs/${payload.transaction_id}/evidence/${'a'.repeat(64)}.jpg`;
    const receipt = {
      receiptId: 'RCPT-evidence',
      transactionId: payload.transaction_id,
      kioskId: payload.kiosk_id,
      operatorId: 'OP-104',
      meterVolume: payload.meter_volume,
      reportedCash: 950,
      recordedAt: payload.recorded_at,
      checksum: 'a'.repeat(64),
      hash: 'a'.repeat(64),
      signature: 'b'.repeat(64),
      algorithm: 'SHA-256',
      issuedAt: '2026-10-19T00:00:01.000Z',
      signedAt: '2026-10-19T00:00:01.000Z',
    };
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input, init) => {
      calls.push({ url: String(input), init });
      if (calls.length === 1) {
        return new Response(JSON.stringify({ proofImageUrl }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        ack: true,
        logId: 'log-evidence',
        proofImageUrl,
        receipt,
      }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], {
      type: 'image/jpeg',
    });
    const result = await submitTransactionLog(
      {
        ...payload,
        reading_type: 'CUMULATIVE_METER',
        operator_id: 'OP-104',
        reported_cash: 950,
      },
      {
        serverUrl: 'http://localhost:3001/api/kiosk/logs',
        retryDelaysMs: [],
        evidenceFile: photo,
        evidenceFileName: 'meter-reading.jpg',
      }
    );

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(
      `http://localhost:3001/api/kiosk/logs/${payload.transaction_id}/evidence`
    );
    expect(calls[0].init?.body).toBeInstanceOf(FormData);
    expect(calls[1].url).toBe('http://localhost:3001/api/kiosk/logs');
    expect(JSON.parse(String(calls[1].init?.body))).toMatchObject({
      readingType: 'CUMULATIVE_METER',
      proofImageUrl,
      proof_image_url: proofImageUrl,
    });
    expect(result).toMatchObject({
      ack: true,
      logId: 'log-evidence',
      proofImageUrl,
      receipt: { proofImageUrl },
    });
  });

  it('surfaces evidence-storage server failures without treating them as a dropped connection', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'Evidence database table is not ready. Apply the server Prisma schema.',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch;

    await expect(
      submitTransactionLog(payload, {
        serverUrl: 'http://localhost:3001/api/kiosk/logs',
        retryDelaysMs: [],
        evidenceFile: new Blob([new Uint8Array([0xff, 0xd8, 0xff])], {
          type: 'image/jpeg',
        }),
      })
    ).rejects.toThrow(EvidenceStorageUnavailableError);
  });

  it('accepts the NestJS server success response for the matching transaction', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          success: true,
          logId: 'log-2',
          transactionId: payload.transaction_id,
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }
      )) as typeof fetch;

    await expect(
      submitTransactionLog(payload, { serverUrl: 'http://localhost:3001/api/kiosk/logs', retryDelaysMs: [] })
    ).resolves.toMatchObject({ ack: true, status: 'saved', logId: 'log-2' });
  });

  it('does not acknowledge a server success for a different transaction', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ success: true, transactionId: 'another-transaction' }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }
      )) as typeof fetch;

    await expect(
      submitTransactionLog(payload, { serverUrl: 'http://localhost:3001/api/kiosk/logs', retryDelaysMs: [] })
    ).rejects.toThrow('Server response did not acknowledge the transaction.');
  });

  it('recognizes the server duplicate response for this transaction', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          statusCode: 409,
          message: `A log with transactionId "${payload.transaction_id}" already exists.`,
          error: 'Conflict',
        }),
        {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }
      )) as typeof fetch;

    await expect(
      submitTransactionLog(payload, { serverUrl: 'http://localhost:3001/api/kiosk/logs', retryDelaysMs: [] })
    ).rejects.toBeInstanceOf(DuplicateTransactionError);
  });

  it('does not mistake a server state conflict for an idempotent duplicate', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          statusCode: 409,
          ack: false,
          error: 'STATE_CONFLICT',
          reason: 'Reading is older than the latest server reading.',
          message: 'Meter reading 50 at 2026-10-17T11:00:00.000Z is lower than older server reading 100 at 2026-10-17T10:00:00.000Z (txn: TXN-OLDER) for kiosk "KIOSK-001".',
          conflictingRecord: {
            transactionId: 'TXN-OLDER',
            kioskId: 'KIOSK-001',
            meterVolume: 100,
            recordedAt: '2026-10-17T10:00:00.000Z',
          },
        }),
        {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }
      )) as typeof fetch;

    let conflictError: unknown;
    try {
      await submitTransactionLog(payload, {
        serverUrl: 'http://localhost:3001/api/kiosk/logs',
        retryDelaysMs: [],
      });
    } catch (error) {
      conflictError = error;
    }

    expect(conflictError).toBeInstanceOf(CorruptedPayloadError);
    expect(conflictError).toMatchObject({
      message: expect.stringContaining('TXN-OLDER'),
    });
  });

  it('does not accept a successful HTTP response without a transaction acknowledgement', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ saved: true }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    await expect(
      submitTransactionLog(payload, { serverUrl: 'http://localhost:3001/api/kiosk/logs', retryDelaysMs: [] })
    ).rejects.toThrow('Server response did not acknowledge the transaction.');
  });
});
