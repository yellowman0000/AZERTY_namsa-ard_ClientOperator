import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  OfflineQueue,
  MemoryStorage,
  QueuePersistenceError,
  KeyValueStorage,
} from '../offlineQueue';
import { OfflineBackgroundDispatcher, QUEUE_KEY } from '../dispatcher';
import { TransactionPayload } from '../api';

const createRecord = (id: string, vol = 10.0): TransactionPayload => ({
  transaction_id: id,
  kiosk_id: 'KIOSK-001',
  meter_volume: vol,
  recorded_at: '2026-10-17T12:00:00.000Z',
});

describe('Story 14-1: Local queue for consecutive offline transactions', () => {
  let storage: MemoryStorage;
  let queue: OfflineQueue<TransactionPayload>;

  beforeEach(() => {
    storage = new MemoryStorage();
    queue = new OfflineQueue<TransactionPayload>({ storage });
  });

  describe('Enqueue / dequeue semantics', () => {
    it('starts empty', () => {
      expect(queue.isEmpty()).toBe(true);
      expect(queue.size()).toBe(0);
      expect(queue.peek()).toBeUndefined();
      expect(queue.dequeue()).toBeUndefined();
    });

    it('enqueue adds to the tail and dequeue removes from the head', () => {
      queue.enqueue(createRecord('TXN-1'));
      queue.enqueue(createRecord('TXN-2'));

      expect(queue.size()).toBe(2);
      expect(queue.dequeue()?.transaction_id).toBe('TXN-1');
      expect(queue.dequeue()?.transaction_id).toBe('TXN-2');
      expect(queue.isEmpty()).toBe(true);
    });

    it('peek returns the head without removing it', () => {
      queue.enqueue(createRecord('TXN-1'));
      queue.enqueue(createRecord('TXN-2'));

      expect(queue.peek()?.transaction_id).toBe('TXN-1');
      expect(queue.peek()?.transaction_id).toBe('TXN-1');
      expect(queue.size()).toBe(2);
    });

    it('keeps payload fields intact through enqueue → dequeue', () => {
      const record = { ...createRecord('TXN-FULL', 42.5), checksum: 'abc', checksum_version: 'v1' };
      queue.enqueue(record);
      expect(queue.dequeue()).toEqual(record);
    });

    it('rejects a duplicate transaction_id', () => {
      expect(queue.enqueue(createRecord('TXN-DUP'))).toBe(true);
      expect(queue.enqueue(createRecord('TXN-DUP', 99))).toBe(false);
      expect(queue.size()).toBe(1);
      expect(queue.peek()?.meter_volume).toBe(10);
    });

    it('allows re-enqueueing an id after it was dequeued', () => {
      queue.enqueue(createRecord('TXN-AGAIN'));
      queue.dequeue();
      expect(queue.enqueue(createRecord('TXN-AGAIN'))).toBe(true);
    });

    it('enqueueMany adds in order and skips duplicates', () => {
      queue.enqueue(createRecord('TXN-1'));
      const added = queue.enqueueMany([
        createRecord('TXN-1'),
        createRecord('TXN-2'),
        createRecord('TXN-3'),
        createRecord('TXN-2'),
      ]);

      expect(added).toBe(2);
      expect(queue.toArray().map((r) => r.transaction_id)).toEqual(['TXN-1', 'TXN-2', 'TXN-3']);
    });

    it('supports peek → sync → remove (item survives until confirmed)', () => {
      queue.enqueue(createRecord('TXN-1'));
      queue.enqueue(createRecord('TXN-2'));

      const head = queue.peek()!;
      // ...upload happens here; if the app crashes now, the item is still queued
      expect(new OfflineQueue<TransactionPayload>({ storage }).peek()?.transaction_id).toBe('TXN-1');

      expect(queue.remove(head.transaction_id)).toBe(true);
      expect(queue.peek()?.transaction_id).toBe('TXN-2');
    });

    it('remove returns false for an unknown id', () => {
      queue.enqueue(createRecord('TXN-1'));
      expect(queue.remove('TXN-NOPE')).toBe(false);
      expect(queue.size()).toBe(1);
    });

    it('has() and clear()', () => {
      queue.enqueue(createRecord('TXN-1'));
      expect(queue.has('TXN-1')).toBe(true);
      expect(queue.has('TXN-2')).toBe(false);

      queue.clear();
      expect(queue.isEmpty()).toBe(true);
    });

    it('toArray returns a copy that cannot mutate the queue', () => {
      queue.enqueue(createRecord('TXN-1'));
      const snapshot = queue.toArray();
      snapshot.pop();
      expect(queue.size()).toBe(1);
    });
  });

  describe('Preserves ordering', () => {
    it('keeps FIFO order for many consecutive offline transactions', () => {
      const ids = Array.from({ length: 100 }, (_, i) => `TXN-${String(i).padStart(3, '0')}`);
      ids.forEach((id, i) => queue.enqueue(createRecord(id, i + 1)));

      const drained: string[] = [];
      let item: TransactionPayload | undefined;
      while ((item = queue.dequeue())) drained.push(item.transaction_id);

      expect(drained).toEqual(ids);
    });

    it('keeps insertion order, not id or value order', () => {
      queue.enqueue(createRecord('TXN-Z', 3));
      queue.enqueue(createRecord('TXN-A', 1));
      queue.enqueue(createRecord('TXN-M', 2));

      expect(queue.toArray().map((r) => r.transaction_id)).toEqual(['TXN-Z', 'TXN-A', 'TXN-M']);
    });

    it('keeps order when enqueue and dequeue are interleaved', () => {
      queue.enqueue(createRecord('TXN-1'));
      queue.enqueue(createRecord('TXN-2'));
      expect(queue.dequeue()?.transaction_id).toBe('TXN-1');
      queue.enqueue(createRecord('TXN-3'));
      queue.enqueue(createRecord('TXN-4'));
      expect(queue.dequeue()?.transaction_id).toBe('TXN-2');

      expect(queue.toArray().map((r) => r.transaction_id)).toEqual(['TXN-3', 'TXN-4']);
    });

    it('removing a middle item keeps the order of the rest', () => {
      queue.enqueueMany([createRecord('TXN-1'), createRecord('TXN-2'), createRecord('TXN-3')]);
      queue.remove('TXN-2');
      expect(queue.toArray().map((r) => r.transaction_id)).toEqual(['TXN-1', 'TXN-3']);
    });
  });

  describe('Persists across app restarts', () => {
    it('a new queue instance (simulated restart) sees previously queued items in order', () => {
      queue.enqueue(createRecord('TXN-1'));
      queue.enqueue(createRecord('TXN-2'));
      queue.enqueue(createRecord('TXN-3'));

      const afterRestart = new OfflineQueue<TransactionPayload>({ storage });
      expect(afterRestart.size()).toBe(3);
      expect(afterRestart.toArray().map((r) => r.transaction_id)).toEqual(['TXN-1', 'TXN-2', 'TXN-3']);
    });

    it('dequeues are persisted too', () => {
      queue.enqueueMany([createRecord('TXN-1'), createRecord('TXN-2')]);
      queue.dequeue();

      const afterRestart = new OfflineQueue<TransactionPayload>({ storage });
      expect(afterRestart.toArray().map((r) => r.transaction_id)).toEqual(['TXN-2']);
    });

    it('stores the queue as a plain JSON array under offline_tx_queue', () => {
      queue.enqueue(createRecord('TXN-1'));
      const raw = storage.getItem(QUEUE_KEY);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toEqual([createRecord('TXN-1')]);
    });

    it('supports a custom storage key', () => {
      const custom = new OfflineQueue({ storage, storageKey: 'other_queue' });
      custom.enqueue({ transaction_id: 'TXN-X' });
      expect(storage.getItem('other_queue')).not.toBeNull();
      expect(storage.getItem(QUEUE_KEY)).toBeNull();
    });

    it('treats corrupted stored JSON as an empty queue and can recover', () => {
      storage.setItem(QUEUE_KEY, '[{"transaction_id":"TXN-1",');
      expect(queue.isEmpty()).toBe(true);

      expect(queue.enqueue(createRecord('TXN-NEW'))).toBe(true);
      expect(queue.toArray().map((r) => r.transaction_id)).toEqual(['TXN-NEW']);
    });

    it('treats non-array JSON as an empty queue', () => {
      for (const raw of ['null', '{}', '"text"', '42']) {
        storage.setItem(QUEUE_KEY, raw);
        expect(queue.toArray()).toEqual([]);
      }
    });

    it('skips entries without a string transaction_id', () => {
      storage.setItem(
        QUEUE_KEY,
        JSON.stringify([null, 5, { foo: 1 }, { transaction_id: 7 }, createRecord('TXN-OK')])
      );
      expect(queue.toArray().map((r) => r.transaction_id)).toEqual(['TXN-OK']);
    });

    it('throws QueuePersistenceError when storage is full, leaving the queue unchanged', () => {
      queue.enqueue(createRecord('TXN-1'));

      const full: KeyValueStorage = {
        getItem: (k) => storage.getItem(k),
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
        removeItem: (k) => storage.removeItem(k),
      };
      const fullQueue = new OfflineQueue<TransactionPayload>({ storage: full });

      expect(() => fullQueue.enqueue(createRecord('TXN-2'))).toThrow(QueuePersistenceError);
      expect(queue.toArray().map((r) => r.transaction_id)).toEqual(['TXN-1']);
    });
  });

  describe('Browser localStorage (default storage)', () => {
    const g = globalThis as unknown as Record<string, unknown>;
    let originalWindow: unknown;
    let originalLocalStorage: unknown;
    let browserStorage: MemoryStorage;

    beforeEach(() => {
      originalWindow = g.window;
      originalLocalStorage = g.localStorage;
      browserStorage = new MemoryStorage();
      g.localStorage = browserStorage;
      g.window = { localStorage: browserStorage };
    });

    afterEach(() => {
      g.window = originalWindow;
      g.localStorage = originalLocalStorage;
    });

    it('uses window.localStorage by default and persists across instances', () => {
      new OfflineQueue<TransactionPayload>().enqueue(createRecord('TXN-LS'));

      expect(browserStorage.getItem(QUEUE_KEY)).toContain('TXN-LS');
      expect(new OfflineQueue<TransactionPayload>().peek()?.transaction_id).toBe('TXN-LS');
    });

    it('items queued here are picked up by the background dispatcher for later sync', () => {
      const q = new OfflineQueue<TransactionPayload>();
      q.enqueue(createRecord('TXN-SYNC-1'));
      q.enqueue(createRecord('TXN-SYNC-2'));

      const dispatcher = new OfflineBackgroundDispatcher({ logLevel: 'silent' });
      expect(dispatcher.getQueue().map((r) => r.transaction_id)).toEqual(['TXN-SYNC-1', 'TXN-SYNC-2']);
    });
  });

  describe('Without localStorage (SSR)', () => {
    it('falls back to in-memory storage instead of crashing', () => {
      const g = globalThis as unknown as Record<string, unknown>;
      const originalWindow = g.window;
      g.window = undefined;
      try {
        const q = new OfflineQueue<TransactionPayload>();
        expect(q.enqueue(createRecord('TXN-SSR'))).toBe(true);
        expect(q.dequeue()?.transaction_id).toBe('TXN-SSR');
      } finally {
        g.window = originalWindow;
      }
    });
  });
});
