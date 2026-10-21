import { describe, it, expect, beforeEach, mock } from 'bun:test';
import {
  OfflineBackgroundDispatcher,
  IQueueStorage,
  DispatcherEvent,
} from '../dispatcher';
import { TransactionPayload } from '../api';
import { attachChecksumToPayload } from '../checksum';

/**
 * In-memory storage mock implementing IQueueStorage.
 */
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

describe('Story 14-3 Subtask 2: Automated Sequential Background Dispatcher (Ball)', () => {
  let storage: InMemoryQueueStorage;
  let dispatcher: OfflineBackgroundDispatcher;

  const createRecord = (id: string, vol = 10.0): TransactionPayload => ({
    transaction_id: id,
    kiosk_id: 'KIOSK-001',
    meter_volume: vol,
    recorded_at: new Date().toISOString(),
  });

  beforeEach(() => {
    storage = new InMemoryQueueStorage();
    dispatcher = new OfflineBackgroundDispatcher({
      storage,
      maxConsecutiveFailures: 3,
      recordRetryDelaysMs: [10, 20], // fast delays for unit tests
      logLevel: 'silent', // clean test output
    });
  });

  describe('Sequential Execution & Queue Order', () => {
    it('enqueues records and attaches checksum alongside payload', async () => {
      const rec = createRecord('TXN-SEQ-1', 25.5);
      const enqueued = await dispatcher.enqueue(rec);

      expect(enqueued).toBe(true);
      const queue = dispatcher.getQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0].transaction_id).toBe('TXN-SEQ-1');
      expect(queue[0].checksum).toBeDefined();
      expect(queue[0].checksum).toHaveLength(64);
      expect(queue[0].checksum_version).toBe('v1');
      expect(queue[0].cached_at).toBeDefined();
    });

    it('rejects duplicate transaction IDs at enqueue time (idempotency)', async () => {
      const rec = createRecord('TXN-DUP-1');
      expect(await dispatcher.enqueue(rec)).toBe(true);
      expect(await dispatcher.enqueue(rec)).toBe(false); // duplicate in queue
      expect(dispatcher.getQueue()).toHaveLength(1);

      dispatcher.markProcessed('TXN-DUP-1');
      expect(await dispatcher.enqueue(rec)).toBe(false); // already processed
    });

    it('dispatches items strictly sequentially in FIFO order', async () => {
      const executionOrder: string[] = [];

      // Mock global fetch to record call sequence
      globalThis.fetch = mock(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        executionOrder.push(body.transactionId || body.transaction_id);
        return new Response(JSON.stringify({ ack: true, logId: `log-${body.transactionId}` }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as unknown as typeof fetch;

      await dispatcher.enqueue(createRecord('TXN-FIFO-1', 10));
      await dispatcher.enqueue(createRecord('TXN-FIFO-2', 20));
      await dispatcher.enqueue(createRecord('TXN-FIFO-3', 30));

      const summary = await dispatcher.processQueue();

      expect(summary.processed).toBe(3);
      expect(summary.failed).toBe(0);
      expect(executionOrder).toEqual(['TXN-FIFO-1', 'TXN-FIFO-2', 'TXN-FIFO-3']);
      expect(dispatcher.getQueue()).toHaveLength(0);
      expect(dispatcher.isProcessed('TXN-FIFO-1')).toBe(true);
      expect(dispatcher.isProcessed('TXN-FIFO-2')).toBe(true);
      expect(dispatcher.isProcessed('TXN-FIFO-3')).toBe(true);
    });
  });

  describe('Retry Strategy on Transient Failures', () => {
    it('retries a transient failure with backoff before succeeding', async () => {
      let attempts = 0;

      globalThis.fetch = mock(async () => {
        attempts++;
        if (attempts < 2) {
          // Simulate 503 Service Unavailable on first attempt
          return new Response(JSON.stringify({ error: 'Service Unavailable' }), {
            status: 503,
          });
        }
        return new Response(JSON.stringify({ ack: true }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as unknown as typeof fetch;

      await dispatcher.enqueue(createRecord('TXN-RETRY-1'));

      const summary = await dispatcher.processQueue();

      expect(attempts).toBeGreaterThanOrEqual(2);
      expect(summary.processed).toBe(1);
      expect(summary.failed).toBe(0);
      expect(dispatcher.getQueue()).toHaveLength(0);
    });

    it('handles HTTP 409 conflict by marking record as processed and dropping from queue', async () => {
      globalThis.fetch = mock(async () => {
        return new Response(
          JSON.stringify({
            statusCode: 409,
            message: 'A log with transactionId "TXN-409" already exists.',
            error: 'Conflict',
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      }) as unknown as typeof fetch;

      await dispatcher.enqueue(createRecord('TXN-409'));

      const summary = await dispatcher.processQueue();

      expect(summary.duplicates).toBe(1);
      expect(dispatcher.getQueue()).toHaveLength(0);
      expect(dispatcher.isProcessed('TXN-409')).toBe(true);
    });

    it('quarantines a state conflict instead of marking it processed as a duplicate', async () => {
      globalThis.fetch = mock(async () =>
        new Response(
          JSON.stringify({
            statusCode: 409,
            ack: false,
            error: 'STATE_CONFLICT',
            reason: 'Reading conflicts with current server state.',
            message: 'Meter state conflict.',
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        )
      ) as unknown as typeof fetch;

      await dispatcher.enqueue(createRecord('TXN-STATE-CONFLICT'));

      const summary = await dispatcher.processQueue();

      expect(summary.quarantined).toBe(1);
      expect(dispatcher.getQueue()).toHaveLength(0);
      expect(dispatcher.isProcessed('TXN-STATE-CONFLICT')).toBe(false);
      expect(dispatcher.getQuarantineQueue()[0].quarantine_reason).toContain(
        'Reading conflicts with current server state.'
      );
    });
  });

  describe('Stops / Pauses on Repeated Failures (Circuit Breaker)', () => {
    it('automatically pauses dispatch when consecutive failures hit the threshold (3)', async () => {
      // Mock fetch that always fails (e.g. offline network or server down)
      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify({ error: 'Server Error' }), {
          status: 500,
        });
      }) as unknown as typeof fetch;

      // Enqueue 5 records
      for (let i = 1; i <= 5; i++) {
        await dispatcher.enqueue(createRecord(`TXN-FAIL-${i}`));
      }

      const events: DispatcherEvent[] = [];
      dispatcher.subscribe((e) => events.push(e));

      const summary = await dispatcher.processQueue();

      expect(summary.paused).toBe(true);
      expect(dispatcher.getStatus()).toBe('paused');

      const stats = dispatcher.getStats();
      expect(stats.consecutiveFailures).toBe(3);
      expect(stats.status).toBe('paused');

      // The remaining 2 items were NOT attempted and stay queued
      expect(dispatcher.getQueue()).toHaveLength(5);

      // Verify paused event was emitted
      const pausedEvent = events.find((e) => e.type === 'dispatcher_paused');
      expect(pausedEvent).toBeDefined();
      expect(pausedEvent?.data.consecutiveFailures).toBe(3);
    });

    it('skips dispatching while paused, and resumes upon resume() call', async () => {
      dispatcher.pause('Manual test pause');
      expect(dispatcher.getStatus()).toBe('paused');

      await dispatcher.enqueue(createRecord('TXN-PAUSED-1'));

      const skipSummary = await dispatcher.processQueue();
      expect(skipSummary.paused).toBe(true);
      expect(skipSummary.processed).toBe(0);

      // Resume dispatcher
      dispatcher.resume('Network reconnected');
      expect(dispatcher.getStatus()).toBe('idle');
      expect(dispatcher.getStats().consecutiveFailures).toBe(0);
    });
  });

  describe('Corrupted Payload Isolation (Story 14-2 Subtask 3 readiness)', () => {
    it('isolates corrupted local payloads to quarantine without blocking valid subsequent records', async () => {
      globalThis.fetch = mock(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ ack: true, id: body.transactionId }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as unknown as typeof fetch;

      // 1. Enqueue valid record
      await dispatcher.enqueue(createRecord('TXN-GOOD-1', 10.0));

      // 2. Enqueue record that will be corrupted in storage
      const corruptRecord = await attachChecksumToPayload(createRecord('TXN-CORRUPTED', 20.0));
      // Tamper with meter volume in storage without updating checksum
      corruptRecord.meter_volume = 99999.0;
      const currentQueue = dispatcher.getQueue();
      currentQueue.push(corruptRecord);
      storage.saveQueue(currentQueue);

      // 3. Enqueue another valid record
      await dispatcher.enqueue(createRecord('TXN-GOOD-2', 30.0));

      const events: DispatcherEvent[] = [];
      dispatcher.subscribe((e) => events.push(e));

      const summary = await dispatcher.processQueue();

      expect(summary.processed).toBe(2);
      expect(summary.quarantined).toBe(1);
      expect(summary.failed).toBe(0);

      // Corrupted record was removed from active queue and placed in quarantine
      expect(dispatcher.getQueue()).toHaveLength(0);
      const quarantine = dispatcher.getQuarantineQueue();
      expect(quarantine).toHaveLength(1);
      expect(quarantine[0].transaction_id).toBe('TXN-CORRUPTED');

      // Both good records were processed
      expect(dispatcher.isProcessed('TXN-GOOD-1')).toBe(true);
      expect(dispatcher.isProcessed('TXN-GOOD-2')).toBe(true);

      const quarantineEvent = events.find((e) => e.type === 'item_quarantined');
      expect(quarantineEvent).toBeDefined();
    });
  });

  describe('Observability & Logging', () => {
    it('provides accurate stats and telemetry', async () => {
      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify({ ack: true }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as unknown as typeof fetch;

      await dispatcher.enqueue(createRecord('TXN-STATS-1'));
      await dispatcher.enqueue(createRecord('TXN-STATS-2'));

      const beforeStats = dispatcher.getStats();
      expect(beforeStats.queueLength).toBe(2);
      expect(beforeStats.totalDispatched).toBe(0);

      await dispatcher.processQueue();

      const afterStats = dispatcher.getStats();
      expect(afterStats.queueLength).toBe(0);
      expect(afterStats.totalDispatched).toBe(2);
      expect(afterStats.lastSuccessfulSyncAt).toBeDefined();
      expect(afterStats.status).toBe('idle');
    });

    it('emits lifecycle events to subscribers', async () => {
      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify({ ack: true }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as unknown as typeof fetch;

      const eventTypes: string[] = [];
      const unsubscribe = dispatcher.subscribe((e) => eventTypes.push(e.type));

      await dispatcher.enqueue(createRecord('TXN-EVENTS-1'));
      await dispatcher.processQueue();

      expect(eventTypes).toContain('item_enqueued');
      expect(eventTypes).toContain('status_change');
      expect(eventTypes).toContain('item_dispatching');
      expect(eventTypes).toContain('item_success');
      expect(eventTypes).toContain('batch_complete');

      unsubscribe();
    });
  });
});
