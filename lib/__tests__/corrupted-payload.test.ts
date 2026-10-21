import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  generatePayloadChecksum,
  verifyPayloadChecksum,
  attachChecksumToPayload,
  generatePayloadHash,
} from '../checksum';
import {
  submitTransactionLog,
  TransactionPayload,
  CorruptedPayloadError,
  DuplicateTransactionError,
} from '../api';
import {
  OfflineBackgroundDispatcher,
  LocalStorageQueueStorage,
  IQueueStorage,
  QUEUE_KEY,
  QUARANTINE_KEY,
  PROCESSED_KEY,
} from '../dispatcher';

/**
 * Story: 14-2 (Offline data corrupted checker)
 * Subtask: SCRUM-24. Write automated edge-case tests for corrupted JSON payloads
 *          and schema conflicts.
 *
 * Covers:
 * - Corrupted / truncated / non-JSON data in local storage.
 * - Field-level corruption that survives JSON parsing (bit flips, tampering).
 * - Schema conflicts: wrong types, missing fields, unknown/mismatched checksum versions.
 * - Server-side rejection (400 schema errors, 422 checksum mismatch, malformed responses).
 * - Dispatcher isolation: corrupted entries are quarantined without blocking the queue.
 *
 * Tests marked `it.failing` describe expected behaviour the current code does not meet
 * yet (see the KNOWN GAP comment above each). They pass while the gap exists; once the
 * code is fixed they start failing, as a reminder to switch them back to `it`.
 */

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

class InMemoryQueueStorage implements IQueueStorage<TransactionPayload> {
  public queue: TransactionPayload[] = [];
  public quarantine: TransactionPayload[] = [];
  public processed: string[] = [];

  getQueue(): TransactionPayload[] {
    return [...this.queue];
  }
  saveQueue(items: TransactionPayload[]): void {
    this.queue = [...items];
  }
  getQuarantine(): TransactionPayload[] {
    return [...this.quarantine];
  }
  saveQuarantine(items: TransactionPayload[]): void {
    this.quarantine = [...items];
  }
  getProcessed(): string[] {
    return [...this.processed];
  }
  saveProcessed(ids: string[]): void {
    this.processed = [...ids];
  }
}

/** Minimal Web Storage mock so LocalStorageQueueStorage can run outside a browser. */
class MemoryLocalStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
}

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const basePayload: TransactionPayload = {
  transaction_id: 'TXN-EDGE-001',
  kiosk_id: 'KIOSK-001',
  meter_volume: 42.5,
  recorded_at: '2026-10-17T12:00:00.000Z',
};

const createRecord = (id: string, vol = 10.0): TransactionPayload => ({
  transaction_id: id,
  kiosk_id: 'KIOSK-001',
  meter_volume: vol,
  recorded_at: '2026-10-17T12:00:00.000Z',
});

const originalFetch = globalThis.fetch;

describe('Story 14-2 SCRUM-24: Edge-case tests for corrupted JSON payloads & schema conflicts', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /* ------------------------------------------------------------------------ */
  describe('Corrupted JSON that still parses (field-level corruption)', () => {
    it('detects a single-digit bit flip inside the serialized JSON', async () => {
      const cached = await attachChecksumToPayload(basePayload);
      const raw = JSON.stringify(cached).replace('"meter_volume":42.5', '"meter_volume":42.6');
      const corrupted = JSON.parse(raw);

      const result = await verifyPayloadChecksum(corrupted);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Checksum mismatch');
    });

    it('detects a corrupted recorded_at timestamp', async () => {
      const cached = await attachChecksumToPayload(basePayload);
      const corrupted = { ...cached, recorded_at: '2026-10-17T12:00:01.000Z' };

      expect((await verifyPayloadChecksum(corrupted)).isValid).toBe(false);
    });

    it('detects a corrupted checksum string (one hex char changed)', async () => {
      const cached = await attachChecksumToPayload(basePayload);
      const flipped = (cached.checksum[0] === 'a' ? 'b' : 'a') + cached.checksum.slice(1);

      const result = await verifyPayloadChecksum({ ...cached, checksum: flipped });
      expect(result.isValid).toBe(false);
    });

    it('rejects a truncated checksum', async () => {
      const cached = await attachChecksumToPayload(basePayload);
      const result = await verifyPayloadChecksum({ ...cached, checksum: cached.checksum.slice(0, 32) });
      expect(result.isValid).toBe(false);
    });

    it('rejects a non-hex garbage checksum', async () => {
      const result = await verifyPayloadChecksum({ ...basePayload, checksum: '���\u0000garbage' });
      expect(result.isValid).toBe(false);
    });

    it('treats an empty-string checksum as missing', async () => {
      const result = await verifyPayloadChecksum({ ...basePayload, checksum: '' });
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Missing checksum for verification');
    });

    it('accepts an uppercase checksum (hex comparison is case-insensitive)', async () => {
      const cached = await attachChecksumToPayload(basePayload);
      const result = await verifyPayloadChecksum({ ...cached, checksum: cached.checksum.toUpperCase() });
      expect(result.isValid).toBe(true);
    });

    it('survives a JSON round-trip without false positives', async () => {
      const cached = await attachChecksumToPayload(basePayload);
      const roundTripped = JSON.parse(JSON.stringify(cached));
      expect((await verifyPayloadChecksum(roundTripped)).isValid).toBe(true);
    });

    it('ignores a __proto__ key injected into the JSON', async () => {
      const cached = await attachChecksumToPayload(basePayload);
      const raw = JSON.stringify(cached).replace('{', '{"__proto__":{"meter_volume":999},');
      const parsed = JSON.parse(raw);

      const result = await verifyPayloadChecksum(parsed);
      expect(result.isValid).toBe(true);
      expect(({} as Record<string, unknown>).meter_volume).toBeUndefined();
    });

    it('produces deterministic checksums for unicode identifiers', async () => {
      const p = { ...basePayload, kiosk_id: 'ตู้-น้ำ-01', transaction_id: 'TXN-😀-01' };
      const a = await generatePayloadChecksum(p);
      const b = await generatePayloadChecksum(JSON.parse(JSON.stringify(p)));
      expect(a.checksum).toBe(b.checksum);
      expect(a.checksum).toHaveLength(64);
    });
  });

  /* ------------------------------------------------------------------------ */
  describe('Schema conflicts in cached payloads', () => {
    it('meter_volume serialized as a numeric string hashes the same as the number', async () => {
      const asNumber = await generatePayloadChecksum(basePayload);
      const asString = await generatePayloadChecksum({
        ...basePayload,
        meter_volume: '42.5' as unknown as number,
      });
      expect(asString.checksum).toBe(asNumber.checksum);
    });

    it('meter_volume corrupted to a non-numeric string fails verification', async () => {
      const cached = await attachChecksumToPayload(basePayload);
      const corrupted = { ...cached, meter_volume: 'forty-two' as unknown as number };
      expect((await verifyPayloadChecksum(corrupted)).isValid).toBe(false);
    });

    it('meter_volume corrupted to null fails verification', async () => {
      const cached = await attachChecksumToPayload(basePayload);
      const corrupted = { ...cached, meter_volume: null as unknown as number };
      expect((await verifyPayloadChecksum(corrupted)).isValid).toBe(false);
    });

    it('NaN and Infinity meter volumes canonicalize to 0.0000', async () => {
      const nan = await generatePayloadChecksum({ ...basePayload, meter_volume: NaN });
      const inf = await generatePayloadChecksum({ ...basePayload, meter_volume: Infinity });
      expect(nan.canonicalString).toContain('meter:0.0000');
      expect(inf.canonicalString).toContain('meter:0.0000');
    });

    it('a missing transaction_id fails verification of a previously checksummed payload', async () => {
      const cached = await attachChecksumToPayload(basePayload);
      const withoutTxn = { ...cached, transaction_id: undefined };
      expect((await verifyPayloadChecksum(withoutTxn)).isValid).toBe(false);
    });

    it('an unparseable recorded_at is kept verbatim and hashed deterministically', async () => {
      const p = { ...basePayload, recorded_at: 'not-a-date' };
      const a = await generatePayloadChecksum(p);
      const b = await generatePayloadChecksum(p);
      expect(a.canonicalString).toContain('recorded:not-a-date');
      expect(a.checksum).toBe(b.checksum);
    });

    // KNOWN GAP: normalizePayloadFields() falls back to `new Date()` when recorded_at is
    // missing, so the checksum is not reproducible and verification fails later.
    it.failing('a payload with no recorded_at verifies after being cached', async () => {
      const noTimestamp = { ...basePayload, recorded_at: undefined };
      const cached = await attachChecksumToPayload(noTimestamp);
      await new Promise((r) => setTimeout(r, 5));
      expect((await verifyPayloadChecksum(cached)).isValid).toBe(true);
    });

    it('mixed snake_case and camelCase keys resolve to snake_case first', async () => {
      const mixed = {
        ...basePayload,
        transactionId: 'TXN-CAMEL-SHADOW',
        meterVolume: 1,
      };
      const a = await generatePayloadChecksum(mixed);
      const b = await generatePayloadChecksum(basePayload);
      expect(a.checksum).toBe(b.checksum);
    });

    it('extra unknown fields do not affect the checksum', async () => {
      const a = await generatePayloadChecksum(basePayload);
      const b = await generatePayloadChecksum({
        ...basePayload,
        operator_id: 'OP-9',
        nested: { deep: [1, 2, 3] },
      } as unknown as TransactionPayload);
      expect(a.checksum).toBe(b.checksum);
    });

    it('checksum_version pinned to legacy rejects a v1 checksum (no silent fallback)', async () => {
      const cached = await attachChecksumToPayload(basePayload);
      const conflicted = { ...cached, checksum_version: 'legacy' };
      const result = await verifyPayloadChecksum(conflicted);
      expect(result.isValid).toBe(false);
      expect(result.version).toBe('legacy');
    });

    it('checksum_version pinned to v1 rejects a legacy checksum', async () => {
      const legacy = await generatePayloadHash(
        basePayload.transaction_id,
        basePayload.kiosk_id,
        basePayload.meter_volume
      );
      const result = await verifyPayloadChecksum({ ...basePayload, checksum: legacy, checksum_version: 'v1' });
      expect(result.isValid).toBe(false);
    });

    it('a "v1:" prefix overrides a conflicting checksum_version field', async () => {
      const { checksum } = await generatePayloadChecksum(basePayload, { prefixVersion: true });
      const result = await verifyPayloadChecksum({ ...basePayload, checksum, checksum_version: 'legacy' });
      expect(result.isValid).toBe(true);
      expect(result.version).toBe('v1');
    });

    // KNOWN GAP: canonicalizePayload() treats any non-'legacy' version as v1.
    it.failing('an unknown checksum_version is rejected', async () => {
      const cached = await attachChecksumToPayload(basePayload);
      const result = await verifyPayloadChecksum({ ...cached, checksum_version: 'v99' });
      expect(result.isValid).toBe(false);
    });
  });

  /* ------------------------------------------------------------------------ */
  describe('Corrupted JSON in LocalStorage', () => {
    let store: MemoryLocalStorage;
    const g = globalThis as unknown as Record<string, unknown>;
    let originalWindow: unknown;
    let originalLocalStorage: unknown;
    let originalConsoleError: typeof console.error;

    beforeEach(() => {
      store = new MemoryLocalStorage();
      originalWindow = g.window;
      originalLocalStorage = g.localStorage;
      originalConsoleError = console.error;
      console.error = () => {};
      g.localStorage = store;
      g.window = { localStorage: store };
    });

    afterEach(() => {
      g.window = originalWindow;
      g.localStorage = originalLocalStorage;
      console.error = originalConsoleError;
    });

    it.each([
      ['truncated JSON', '[{"transaction_id":"TXN-1","kiosk_id":"K'],
      ['non-JSON garbage', '\u0000\u0001binary-garbage'],
      ['trailing comma', '[{"transaction_id":"TXN-1"},]'],
      ['single-quoted JSON', "[{'transaction_id':'TXN-1'}]"],
    ])('returns an empty queue for %s instead of throwing', (_label, raw) => {
      store.setItem(QUEUE_KEY, raw);
      store.setItem(QUARANTINE_KEY, raw);
      store.setItem(PROCESSED_KEY, raw);

      const storage = new LocalStorageQueueStorage();
      expect(storage.getQueue()).toEqual([]);
      expect(storage.getQuarantine()).toEqual([]);
      expect(storage.getProcessed()).toEqual([]);
    });

    // KNOWN GAP: LocalStorageQueueStorage returns whatever JSON.parse yields without
    // checking it is an array, so valid-but-wrong-shape JSON reaches the dispatcher.
    for (const [label, raw] of [
      ['an object', '{"transaction_id":"TXN-1"}'],
      ['a string', '"hello"'],
      ['a number', '42'],
      ['null', 'null'],
    ]) {
      it.failing(`returns an empty queue when the stored JSON is ${label} instead of an array`, () => {
        store.setItem(QUEUE_KEY, raw);
        const storage = new LocalStorageQueueStorage();
        expect(Array.isArray(storage.getQueue())).toBe(true);
      });
    }

    it('a dispatcher can still enqueue after the stored queue was corrupted', async () => {
      store.setItem(QUEUE_KEY, '[{"transaction_id":');
      const dispatcher = new OfflineBackgroundDispatcher({ logLevel: 'silent' });

      expect(await dispatcher.enqueue(createRecord('TXN-AFTER-CORRUPT'))).toBe(true);
      const persisted = JSON.parse(store.getItem(QUEUE_KEY) as string);
      expect(persisted).toHaveLength(1);
      expect(persisted[0].transaction_id).toBe('TXN-AFTER-CORRUPT');
    });

    it('a record corrupted on disk is quarantined on the next dispatch', async () => {
      const dispatcher = new OfflineBackgroundDispatcher({
        logLevel: 'silent',
        recordRetryDelaysMs: [],
      });
      await dispatcher.enqueue(createRecord('TXN-DISK-ROT', 10));

      // Simulate bit rot in the persisted JSON
      const raw = store.getItem(QUEUE_KEY) as string;
      store.setItem(QUEUE_KEY, raw.replace('"meter_volume":10', '"meter_volume":19'));

      const fetchMock = mock(async () => jsonResponse({ ack: true }, 201));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const summary = await dispatcher.processQueue();
      expect(summary.quarantined).toBe(1);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(dispatcher.getQuarantineQueue()[0].transaction_id).toBe('TXN-DISK-ROT');
    });
  });

  /* ------------------------------------------------------------------------ */
  describe('Server-side schema conflict & corruption responses', () => {
    it('maps HTTP 400 with a validation message array to CorruptedPayloadError', async () => {
      globalThis.fetch = mock(async () =>
        jsonResponse({ message: ['meterVolume must be a number', 'kioskId should not be empty'] }, 400)
      ) as unknown as typeof fetch;

      const err = await submitTransactionLog(basePayload, { retryDelaysMs: [] }).catch((e) => e);
      expect(err).toBeInstanceOf(CorruptedPayloadError);
      expect(err.message).toContain('meterVolume must be a number, kioskId should not be empty');
    });

    it('maps HTTP 400 with a string message to CorruptedPayloadError', async () => {
      globalThis.fetch = mock(async () =>
        jsonResponse({ message: 'Unknown checksum_version' }, 400)
      ) as unknown as typeof fetch;

      const err = await submitTransactionLog(basePayload, { retryDelaysMs: [] }).catch((e) => e);
      expect(err).toBeInstanceOf(CorruptedPayloadError);
      expect(err.message).toContain('Unknown checksum_version');
    });

    it('maps HTTP 400 with a non-JSON body to the default schema error', async () => {
      globalThis.fetch = mock(
        async () => new Response('<html>Bad Request</html>', { status: 400 })
      ) as unknown as typeof fetch;

      const err = await submitTransactionLog(basePayload, { retryDelaysMs: [] }).catch((e) => e);
      expect(err).toBeInstanceOf(CorruptedPayloadError);
      expect(err.message).toContain('Bad Request / Invalid payload schema');
    });

    it('maps HTTP 422 to CorruptedPayloadError', async () => {
      globalThis.fetch = mock(async () => jsonResponse({}, 422)) as unknown as typeof fetch;

      const err = await submitTransactionLog(basePayload, { retryDelaysMs: [] }).catch((e) => e);
      expect(err).toBeInstanceOf(CorruptedPayloadError);
    });

    it('maps HTTP 409 on the first attempt to DuplicateTransactionError', async () => {
      globalThis.fetch = mock(async () =>
        jsonResponse(
          {
            statusCode: 409,
            message: `A log with transactionId "${basePayload.transaction_id}" already exists.`,
            error: 'Conflict',
          },
          409
        )
      ) as unknown as typeof fetch;

      const err = await submitTransactionLog(basePayload, { retryDelaysMs: [] }).catch((e) => e);
      expect(err).toBeInstanceOf(DuplicateTransactionError);
    });

    it('sends the stored checksum unchanged so the server can detect local corruption', async () => {
      const cached = await attachChecksumToPayload(basePayload);
      const tampered = { ...cached, meter_volume: 999 };
      let sentBody: Record<string, unknown> = {};

      globalThis.fetch = mock(async (_url: unknown, init: RequestInit) => {
        sentBody = JSON.parse(init.body as string);
        return jsonResponse({ ack: true }, 201);
      }) as unknown as typeof fetch;

      await submitTransactionLog(tampered, { retryDelaysMs: [] });
      expect(sentBody.checksum).toBe(cached.checksum);
      expect(sentBody.meterVolume).toBe(999);
      expect(sentBody.checksum_version).toBe('v1');
    });

    it('sends both camelCase and snake_case fields with matching values', async () => {
      let sentBody: Record<string, unknown> = {};
      globalThis.fetch = mock(async (_url: unknown, init: RequestInit) => {
        sentBody = JSON.parse(init.body as string);
        return jsonResponse({ ack: true }, 201);
      }) as unknown as typeof fetch;

      await submitTransactionLog(basePayload, { retryDelaysMs: [] });
      expect(sentBody.transactionId).toBe(sentBody.transaction_id);
      expect(sentBody.kioskId).toBe(sentBody.kiosk_id);
      expect(sentBody.meterVolume).toBe(sentBody.meter_volume);
      expect(sentBody.recordedAt).toBe(sentBody.recorded_at);
    });

    it('rejects when a 2xx response body is malformed JSON', async () => {
      globalThis.fetch = mock(
        async () => new Response('{"ack": tru', { status: 201 })
      ) as unknown as typeof fetch;

      await expect(submitTransactionLog(basePayload, { retryDelaysMs: [] })).rejects.toThrow();
    });
  });

  /* ------------------------------------------------------------------------ */
  describe('Dispatcher isolation of corrupted & conflicting records', () => {
    let storage: InMemoryQueueStorage;
    let dispatcher: OfflineBackgroundDispatcher;

    beforeEach(() => {
      storage = new InMemoryQueueStorage();
      dispatcher = new OfflineBackgroundDispatcher({
        storage,
        maxConsecutiveFailures: 2,
        recordRetryDelaysMs: [5],
        logLevel: 'silent',
      });
    });

    it('quarantines a locally corrupted record without blocking the rest of the queue', async () => {
      const sent: string[] = [];
      globalThis.fetch = mock(async (_url: unknown, init: RequestInit) => {
        sent.push(JSON.parse(init.body as string).transaction_id);
        return jsonResponse({ ack: true }, 201);
      }) as unknown as typeof fetch;

      await dispatcher.enqueue(createRecord('TXN-A', 1));
      await dispatcher.enqueue(createRecord('TXN-B', 2));
      await dispatcher.enqueue(createRecord('TXN-C', 3));
      storage.queue[1] = { ...storage.queue[1], meter_volume: 2000 };

      const summary = await dispatcher.processQueue();
      expect(summary).toMatchObject({ processed: 2, quarantined: 1, failed: 0, paused: false });
      expect(sent).toEqual(['TXN-A', 'TXN-C']);
      expect(storage.quarantine[0].transaction_id).toBe('TXN-B');
      expect(storage.quarantine[0].quarantine_reason).toContain('Checksum mismatch');
      expect(storage.quarantine[0].quarantined_at).toBeDefined();
      expect(storage.queue).toHaveLength(0);
    });

    it('quarantines a record whose checksum_version conflicts with its checksum', async () => {
      globalThis.fetch = mock(async () => jsonResponse({ ack: true }, 201)) as unknown as typeof fetch;

      await dispatcher.enqueue(createRecord('TXN-VER'));
      storage.queue[0] = { ...storage.queue[0], checksum_version: 'legacy' };

      const summary = await dispatcher.processQueue();
      expect(summary.quarantined).toBe(1);
      expect(storage.quarantine[0].transaction_id).toBe('TXN-VER');
    });

    it('quarantines a schema-broken entry (empty object with checksum)', async () => {
      const fetchMock = mock(async () => jsonResponse({ ack: true }, 201));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      storage.queue = [{ checksum: 'deadbeef' } as unknown as TransactionPayload];

      const summary = await dispatcher.processQueue();
      expect(summary.quarantined).toBe(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('quarantines records the server rejects with 400 schema errors, keeping the server reason', async () => {
      globalThis.fetch = mock(async () =>
        jsonResponse({ message: ['recordedAt must be a valid ISO 8601 date string'] }, 400)
      ) as unknown as typeof fetch;

      await dispatcher.enqueue(createRecord('TXN-400'));
      const summary = await dispatcher.processQueue();

      expect(summary.quarantined).toBe(1);
      expect(storage.quarantine[0].quarantine_reason).toContain(
        'recordedAt must be a valid ISO 8601 date string'
      );
      expect(storage.queue).toHaveLength(0);
    });

    it('server corruption rejections do not trip the circuit breaker', async () => {
      globalThis.fetch = mock(async () => jsonResponse({}, 422)) as unknown as typeof fetch;

      for (let i = 0; i < 5; i++) await dispatcher.enqueue(createRecord(`TXN-422-${i}`));
      const summary = await dispatcher.processQueue();

      expect(summary.quarantined).toBe(5);
      expect(summary.paused).toBe(false);
      expect(dispatcher.getStatus()).toBe('idle');
      expect(dispatcher.getStats().consecutiveFailures).toBe(0);
    });

    it('does not retry a corrupted record (4xx is final)', async () => {
      const fetchMock = mock(async () => jsonResponse({}, 422));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await dispatcher.enqueue(createRecord('TXN-NO-RETRY'));
      await dispatcher.processQueue();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('refuses to re-enqueue a quarantined transaction', async () => {
      globalThis.fetch = mock(async () => jsonResponse({}, 422)) as unknown as typeof fetch;

      await dispatcher.enqueue(createRecord('TXN-Q'));
      await dispatcher.processQueue();
      expect(await dispatcher.enqueue(createRecord('TXN-Q'))).toBe(false);
      expect(storage.queue).toHaveLength(0);
    });

    it('drops a duplicate transaction_id that appears twice in a corrupted queue', async () => {
      const fetchMock = mock(async () => jsonResponse({ ack: true }, 201));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await dispatcher.enqueue(createRecord('TXN-TWICE'));
      storage.queue.push({ ...storage.queue[0] });

      const summary = await dispatcher.processQueue();
      expect(summary.processed).toBe(1);
      expect(summary.duplicates).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // KNOWN GAP: processQueue() reads record.transaction_id without a null guard; the
    // TypeError escapes and leaves the dispatcher stuck in 'syncing'.
    it.failing('does not crash when the queue contains a null entry', async () => {
      globalThis.fetch = mock(async () => jsonResponse({ ack: true }, 201)) as unknown as typeof fetch;

      await dispatcher.enqueue(createRecord('TXN-OK'));
      storage.queue.unshift(null as unknown as TransactionPayload);

      const summary = await dispatcher.processQueue();
      expect(summary.processed).toBe(1);
      expect(dispatcher.getStatus()).toBe('idle');
    });

    // KNOWN GAP: the pre-upload check only runs `if (record.checksum)`, so a record that
    // lost its checksum is uploaded without local verification.
    it.failing('verifies a record without a checksum locally instead of sending it unchecked', async () => {
      const fetchMock = mock(async () => jsonResponse({ ack: true }, 201));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      storage.queue = [createRecord('TXN-NO-CHECKSUM')];

      const summary = await dispatcher.processQueue();
      expect(summary.quarantined).toBe(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
