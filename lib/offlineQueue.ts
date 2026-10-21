/**
 * Persistent FIFO queue for consecutive offline transactions.
 *
 * Story: 14-1 (Offline data storing cache)
 * Subtask: Implement local queue to store multiple consecutive offline transactions
 * Owner: Earn
 *
 * Acceptance Criteria Met:
 * - Queue persists across app restarts: every operation reads from and writes back to
 *   localStorage, so nothing lives only in memory.
 * - Preserves ordering: items are kept in a JSON array in insertion (FIFO) order.
 * - Supports enqueue/dequeue semantics for later sync: `enqueue`, `peek`, `dequeue`,
 *   plus `remove(id)` for a peek → sync → remove (at-least-once) flow.
 *
 * Storage format: the same `offline_tx_queue` key and JSON-array format used by
 * `LocalStorageQueueStorage` in ./dispatcher, so the background dispatcher can sync
 * anything queued here.
 */

import { QUEUE_KEY } from './dispatcher';

/** The subset of the Web Storage API the queue needs (localStorage satisfies it). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Any record with a unique transaction id. */
export interface QueueRecord {
  transaction_id: string;
}

export interface OfflineQueueOptions {
  /** localStorage key. Default: `offline_tx_queue` (shared with the dispatcher). */
  storageKey?: string;
  /** Storage backend. Default: `window.localStorage`, or an in-memory store during SSR. */
  storage?: KeyValueStorage;
}

/** Thrown when an item cannot be written to storage (e.g. quota exceeded). */
export class QueuePersistenceError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'QueuePersistenceError';
  }
}

/** Non-persistent fallback used when localStorage is unavailable (SSR, tests). */
export class MemoryStorage implements KeyValueStorage {
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
}

function defaultStorage(): KeyValueStorage {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    return window.localStorage;
  }
  return new MemoryStorage();
}

export class OfflineQueue<T extends QueueRecord = QueueRecord> {
  private readonly storageKey: string;
  private readonly storage: KeyValueStorage;

  constructor(options: OfflineQueueOptions = {}) {
    this.storageKey = options.storageKey ?? QUEUE_KEY;
    this.storage = options.storage ?? defaultStorage();
  }

  /* ------------------------------------------------------------------------ */
  /* Persistence                                                              */
  /* ------------------------------------------------------------------------ */

  /** Reads the persisted queue. Unreadable or non-array data is treated as empty. */
  private read(): T[] {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.storageKey);
    } catch (e) {
      console.error('[OfflineQueue] Could not read queue:', e);
      return [];
    }
    if (raw === null) return [];

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item): item is T =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as QueueRecord).transaction_id === 'string'
      );
    } catch {
      console.error(`[OfflineQueue] "${this.storageKey}" holds invalid JSON; treating as empty.`);
      return [];
    }
  }

  private write(items: T[]): void {
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(items));
    } catch (e) {
      throw new QueuePersistenceError(`Could not persist offline queue "${this.storageKey}"`, e);
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Queue operations                                                         */
  /* ------------------------------------------------------------------------ */

  /**
   * Appends an item to the tail of the queue and persists it immediately.
   * @returns false if an item with the same transaction_id is already queued.
   * @throws QueuePersistenceError if storage rejects the write.
   */
  enqueue(item: T): boolean {
    const items = this.read();
    if (items.some((existing) => existing.transaction_id === item.transaction_id)) {
      return false;
    }
    items.push(item);
    this.write(items);
    return true;
  }

  /**
   * Appends several items in order with a single write.
   * Items whose transaction_id is already queued (or repeated in the batch) are skipped.
   * @returns the number of items added.
   */
  enqueueMany(newItems: T[]): number {
    const items = this.read();
    const ids = new Set(items.map((i) => i.transaction_id));
    let added = 0;
    for (const item of newItems) {
      if (ids.has(item.transaction_id)) continue;
      ids.add(item.transaction_id);
      items.push(item);
      added++;
    }
    if (added > 0) this.write(items);
    return added;
  }

  /** Returns the oldest item without removing it. */
  peek(): T | undefined {
    return this.read()[0];
  }

  /**
   * Removes and returns the oldest item.
   * For sync, prefer `peek()` → upload → `remove(id)` so a crash mid-upload
   * does not lose the item.
   */
  dequeue(): T | undefined {
    const items = this.read();
    if (items.length === 0) return undefined;
    const [head, ...rest] = items;
    this.write(rest);
    return head;
  }

  /** Removes the item with the given transaction_id (e.g. after a successful sync). */
  remove(transactionId: string): boolean {
    const items = this.read();
    const remaining = items.filter((item) => item.transaction_id !== transactionId);
    if (remaining.length === items.length) return false;
    this.write(remaining);
    return true;
  }

  /** Returns a copy of all queued items, oldest first. */
  toArray(): T[] {
    return this.read();
  }

  has(transactionId: string): boolean {
    return this.read().some((item) => item.transaction_id === transactionId);
  }

  size(): number {
    return this.read().length;
  }

  isEmpty(): boolean {
    return this.size() === 0;
  }

  /** Removes every item. */
  clear(): void {
    this.write([]);
  }
}
