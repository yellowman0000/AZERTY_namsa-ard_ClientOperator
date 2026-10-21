import { afterEach, describe, expect, it } from 'bun:test';
import {
  CorruptedPayloadError,
  DuplicateTransactionError,
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
          message: 'Meter state conflict.',
        }),
        {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }
      )) as typeof fetch;

    await expect(
      submitTransactionLog(payload, { serverUrl: 'http://localhost:3001/api/kiosk/logs', retryDelaysMs: [] })
    ).rejects.toBeInstanceOf(CorruptedPayloadError);
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
