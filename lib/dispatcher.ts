/**
 * Automated Sequential Background Dispatcher for Offline Records.
 *
 * Story: 14-3 (Offline data auto-sync after reconnection)
 * Subtask: 2. Build automated sequential background dispatcher to push pending records
 * Owner: Ball
 *
 * Acceptance Criteria Met:
 * - Sequential dispatch with retry strategy (FIFO order, concurrency mutex, backoff retry).
 * - Stops/pauses on repeated failures (configurable circuit breaker on consecutive failures).
 * - Observability/logging included (structured logging, metrics telemetry, event subscriber pattern).
 *
 * Architecture Notes:
 * - Decoupled storage adapter (`IQueueStorage`) for seamless future migration to IndexedDB by Pun.
 * - Local checksum validation before dispatch to isolate corrupted items without blocking the queue.
 * - Idempotency and duplicate prevention at client and server boundary.
 */

import {
  submitTransactionLog,
  TransactionPayload,
  CorruptedPayloadError,
  DuplicateTransactionError,
} from './api';
import {
  attachChecksumToPayload,
  verifyPayloadChecksum,
  CURRENT_CHECKSUM_VERSION,
} from './checksum';

export type DispatcherStatus = 'idle' | 'syncing' | 'paused';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface DispatcherOptions {
  /** Maximum consecutive failures before pausing dispatch. Default: 3. */
  maxConsecutiveFailures?: number;
  /** Delays in ms between retries for a single record during dispatch. Default: [1000, 2000, 4000]. */
  recordRetryDelaysMs?: number[];
  /** Maximum items kept in processed idempotency cache. Default: 200. */
  maxProcessedHistory?: number;
  /** Storage backend. Defaults to LocalStorageQueueStorage. */
  storage?: IQueueStorage<TransactionPayload>;
  /** Logging verbosity. Default: 'info'. */
  logLevel?: LogLevel;
}

export interface DispatcherStats {
  status: DispatcherStatus;
  queueLength: number;
  quarantineLength: number;
  processedCount: number;
  totalDispatched: number;
  totalFailed: number;
  totalQuarantined: number;
  consecutiveFailures: number;
  maxConsecutiveFailures: number;
  lastSyncAttemptAt: string | null;
  lastSuccessfulSyncAt: string | null;
}

export interface DispatchSummary {
  processed: number;
  quarantined: number;
  failed: number;
  duplicates: number;
  paused: boolean;
}

export type DispatcherEventType =
  | 'status_change'
  | 'item_enqueued'
  | 'item_dispatching'
  | 'item_success'
  | 'item_retry'
  | 'item_failed'
  | 'item_quarantined'
  | 'dispatcher_paused'
  | 'dispatcher_resumed'
  | 'batch_complete';

export interface DispatcherEvent {
  type: DispatcherEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export type DispatcherEventListener = (event: DispatcherEvent) => void;

/**
 * Storage abstraction allowing Pun (14-1.1) to easily plug in IndexedDB schema
 * without changing dispatcher logic.
 */
export interface IQueueStorage<T = TransactionPayload> {
  getQueue(): T[];
  saveQueue(items: T[]): void;
  getQuarantine(): T[];
  saveQuarantine(items: T[]): void;
  getProcessed(): string[];
  saveProcessed(ids: string[]): void;
}

export const QUEUE_KEY = 'offline_tx_queue';
export const QUARANTINE_KEY = 'quarantine_queue';
export const PROCESSED_KEY = 'processed_tx_ids';

/**
 * Default LocalStorage implementation with SSR and quota safeguards.
 */
export class LocalStorageQueueStorage implements IQueueStorage<TransactionPayload> {
  private isAvailable(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  }

  getQueue(): TransactionPayload[] {
    if (!this.isAvailable()) return [];
    try {
      const data = localStorage.getItem(QUEUE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('[LocalStorageQueueStorage] Error reading queue:', e);
      return [];
    }
  }

  saveQueue(items: TransactionPayload[]): void {
    if (!this.isAvailable()) return;
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
    } catch (e) {
      console.error('[LocalStorageQueueStorage] Error saving queue:', e);
    }
  }

  getQuarantine(): TransactionPayload[] {
    if (!this.isAvailable()) return [];
    try {
      const data = localStorage.getItem(QUARANTINE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('[LocalStorageQueueStorage] Error reading quarantine:', e);
      return [];
    }
  }

  saveQuarantine(items: TransactionPayload[]): void {
    if (!this.isAvailable()) return;
    try {
      localStorage.setItem(QUARANTINE_KEY, JSON.stringify(items));
    } catch (e) {
      console.error('[LocalStorageQueueStorage] Error saving quarantine:', e);
    }
  }

  getProcessed(): string[] {
    if (!this.isAvailable()) return [];
    try {
      const data = localStorage.getItem(PROCESSED_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('[LocalStorageQueueStorage] Error reading processed list:', e);
      return [];
    }
  }

  saveProcessed(ids: string[]): void {
    if (!this.isAvailable()) return;
    try {
      localStorage.setItem(PROCESSED_KEY, JSON.stringify(ids));
    } catch (e) {
      console.error('[LocalStorageQueueStorage] Error saving processed list:', e);
    }
  }
}

/**
 * Sequential Background Dispatcher that pushes pending records in FIFO order,
 * executes backoff retry, isolates corrupt payloads, and pauses on repeated failures.
 */
export class OfflineBackgroundDispatcher {
  private status: DispatcherStatus = 'idle';
  private consecutiveFailures = 0;
  private readonly maxConsecutiveFailures: number;
  private readonly recordRetryDelaysMs: number[];
  private readonly maxProcessedHistory: number;
  private readonly storage: IQueueStorage<TransactionPayload>;
  private readonly logLevel: LogLevel;

  // Telemetry metrics
  private totalDispatched = 0;
  private totalFailed = 0;
  private totalQuarantined = 0;
  private lastSyncAttemptAt: string | null = null;
  private lastSuccessfulSyncAt: string | null = null;

  // Listeners
  private listeners = new Set<DispatcherEventListener>();

  constructor(options: DispatcherOptions = {}) {
    this.maxConsecutiveFailures = options.maxConsecutiveFailures ?? 3;
    this.recordRetryDelaysMs = options.recordRetryDelaysMs ?? [1000, 2000, 4000];
    this.maxProcessedHistory = options.maxProcessedHistory ?? 200;
    this.storage = options.storage ?? new LocalStorageQueueStorage();
    this.logLevel = options.logLevel ?? 'info';
  }

  /* -------------------------------------------------------------------------- */
  /* Logging & Observability                                                    */
  /* -------------------------------------------------------------------------- */

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
      silent: 4,
    };
    if (levels[level] < levels[this.logLevel]) return;

    const timestamp = new Date().toISOString();
    const prefix = `[OfflineDispatcher][${timestamp}][${level.toUpperCase()}]`;

    switch (level) {
      case 'debug':
        console.debug(prefix, message, ...args);
        break;
      case 'info':
        console.info(prefix, message, ...args);
        break;
      case 'warn':
        console.warn(prefix, message, ...args);
        break;
      case 'error':
        console.error(prefix, message, ...args);
        break;
    }
  }

  public subscribe(listener: DispatcherEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(type: DispatcherEventType, data: Record<string, unknown> = {}): void {
    const event: DispatcherEvent = {
      type,
      timestamp: new Date().toISOString(),
      data,
    };
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        this.log('error', 'Error in dispatcher event listener:', err);
      }
    });
  }

  private setStatus(next: DispatcherStatus, reason?: string): void {
    if (this.status === next) return;
    const previous = this.status;
    this.status = next;
    this.log('info', `Status transition: ${previous} -> ${next}${reason ? ` (${reason})` : ''}`);
    this.emit('status_change', { status: next, previous, reason });
  }

  public getStatus(): DispatcherStatus {
    return this.status;
  }

  public getStats(): DispatcherStats {
    return {
      status: this.status,
      queueLength: this.storage.getQueue().length,
      quarantineLength: this.storage.getQuarantine().length,
      processedCount: this.storage.getProcessed().length,
      totalDispatched: this.totalDispatched,
      totalFailed: this.totalFailed,
      totalQuarantined: this.totalQuarantined,
      consecutiveFailures: this.consecutiveFailures,
      maxConsecutiveFailures: this.maxConsecutiveFailures,
      lastSyncAttemptAt: this.lastSyncAttemptAt,
      lastSuccessfulSyncAt: this.lastSuccessfulSyncAt,
    };
  }

  /* -------------------------------------------------------------------------- */
  /* Pause & Resume (Circuit Breaker Controls)                                  */
  /* -------------------------------------------------------------------------- */

  /**
   * Pauses the background dispatcher, preventing further outbound requests.
   */
  public pause(reason = 'Manual pause'): void {
    this.setStatus('paused', reason);
    this.emit('dispatcher_paused', { reason, consecutiveFailures: this.consecutiveFailures });
  }

  /**
   * Resumes the background dispatcher after being paused, resetting failure counters.
   */
  public resume(reason = 'Manual resume'): void {
    this.consecutiveFailures = 0;
    this.setStatus('idle', reason);
    this.emit('dispatcher_resumed', { reason });
    this.log('info', `Dispatcher resumed (${reason}). Consecutive failures reset.`);
  }

  /* -------------------------------------------------------------------------- */
  /* Idempotency & Queue Operations                                             */
  /* -------------------------------------------------------------------------- */

  public isProcessed(transactionId: string): boolean {
    const list = this.storage.getProcessed();
    return list.includes(transactionId);
  }

  public markProcessed(transactionId: string): void {
    const list = this.storage.getProcessed();
    if (!list.includes(transactionId)) {
      if (list.length >= this.maxProcessedHistory) {
        list.shift();
      }
      list.push(transactionId);
      this.storage.saveProcessed(list);
    }
  }

  public getQueue(): TransactionPayload[] {
    return this.storage.getQueue();
  }

  public getQuarantineQueue(): TransactionPayload[] {
    return this.storage.getQuarantine();
  }

  public quarantine(record: TransactionPayload, reason?: string): void {
    const list = this.storage.getQuarantine();
    const quarantinedRecord = {
      ...record,
      quarantined_at: new Date().toISOString(),
      quarantine_reason: reason || 'Payload invalid or corrupted',
    };
    list.push(quarantinedRecord);
    this.storage.saveQuarantine(list);
    this.totalQuarantined++;
    this.log('warn', `Quarantined transaction ${record.transaction_id}: ${reason}`);
    this.emit('item_quarantined', { record: quarantinedRecord, reason });
  }

  /**
   * Enqueues a transaction record.
   * Calculates deterministic checksum and stores it directly alongside the payload.
   * Performs idempotency checks against processed list, active queue, and quarantine.
   */
  public async enqueue(record: TransactionPayload): Promise<boolean> {
    // 1. Idempotency checks
    if (this.isProcessed(record.transaction_id)) {
      this.log('warn', `[Idempotency] Rejected: ${record.transaction_id} is already processed.`);
      return false;
    }

    const queue = this.getQueue();
    if (queue.some((item) => item.transaction_id === record.transaction_id)) {
      this.log('warn', `[Idempotency] Rejected: ${record.transaction_id} is already in queue.`);
      return false;
    }

    const quarantine = this.getQuarantineQueue();
    if (quarantine.some((item) => item.transaction_id === record.transaction_id)) {
      this.log('warn', `[Idempotency] Rejected: ${record.transaction_id} is quarantined.`);
      return false;
    }

    // 2. Acceptance: Stored alongside cached payload (Story 14-2 Subtask 1)
    const payloadWithChecksum = await attachChecksumToPayload(record, {
      version: CURRENT_CHECKSUM_VERSION,
    });

    queue.push(payloadWithChecksum);
    this.storage.saveQueue(queue);

    this.log(
      'info',
      `Enqueued record ${record.transaction_id} (Queue size: ${queue.length}, Checksum: ${payloadWithChecksum.checksum.slice(0, 8)}...)`
    );
    this.emit('item_enqueued', { record: payloadWithChecksum, queueLength: queue.length });

    return true;
  }

  /* -------------------------------------------------------------------------- */
  /* Sequential Background Dispatch Execution                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * Dispatches pending records sequentially (FIFO) with retry and circuit-breaker pause.
   */
  public async processQueue(): Promise<DispatchSummary> {
    if (this.status === 'syncing') {
      this.log('debug', 'processQueue called while already syncing. Skipping overlapping run.');
      return { processed: 0, quarantined: 0, failed: 0, duplicates: 0, paused: false };
    }

    if (this.status === 'paused') {
      this.log('warn', 'processQueue skipped: dispatcher is currently paused.');
      return { processed: 0, quarantined: 0, failed: 0, duplicates: 0, paused: true };
    }

    const queue = this.getQueue();
    if (queue.length === 0) {
      return { processed: 0, quarantined: 0, failed: 0, duplicates: 0, paused: false };
    }

    this.setStatus('syncing', 'Flushing queue sequentially');
    this.lastSyncAttemptAt = new Date().toISOString();

    const remainingQueue: TransactionPayload[] = [];
    const seenInBatch = new Set<string>();
    let processed = 0;
    let quarantined = 0;
    let failed = 0;
    let duplicates = 0;
    let paused = false;

    this.log('info', `Starting sequential dispatch of ${queue.length} pending record(s)...`);

    for (let i = 0; i < queue.length; i++) {
      const record = queue[i];

      // In-batch duplicate check
      if (seenInBatch.has(record.transaction_id) || this.isProcessed(record.transaction_id)) {
        this.log('warn', `[Idempotency] Dropping duplicate from queue: ${record.transaction_id}`);
        duplicates++;
        continue;
      }
      seenInBatch.add(record.transaction_id);

      // Pre-upload integrity check: Verify local checksum before upload (Story 14-2)
      if (record.checksum) {
        const verifyResult = await verifyPayloadChecksum(record);
        if (!verifyResult.isValid) {
          this.log(
            'error',
            `Local checksum verification failed for ${record.transaction_id}: ${verifyResult.error}`
          );
          this.quarantine(record, verifyResult.error);
          quarantined++;
          continue; // Do not block queue; continue to next sequential record
        }
      }

      this.emit('item_dispatching', { record, index: i, total: queue.length });

      // Execute sequential record dispatch with retry strategy
      const dispatchResult = await this.dispatchSingleRecord(record);

      if (dispatchResult.outcome === 'success') {
        this.markProcessed(record.transaction_id);
        processed++;
        this.totalDispatched++;
        this.consecutiveFailures = 0; // Reset consecutive failures on success
        this.lastSuccessfulSyncAt = new Date().toISOString();
        this.emit('item_success', { record, ack: dispatchResult.ack });
      } else if (dispatchResult.outcome === 'duplicate') {
        this.markProcessed(record.transaction_id);
        duplicates++;
        this.consecutiveFailures = 0;
        this.log('info', `Server ACK duplicate: ${record.transaction_id} dropped from queue.`);
      } else if (dispatchResult.outcome === 'corrupted') {
        this.quarantine(record, dispatchResult.errorMessage);
        quarantined++;
        // Corrupted payload does NOT count towards network failure circuit breaker
      } else {
        // Transient network failure
        failed++;
        this.totalFailed++;
        this.consecutiveFailures++;
        remainingQueue.push(record);

        this.log(
          'warn',
          `Record ${record.transaction_id} failed. Consecutive failures: ${this.consecutiveFailures}/${this.maxConsecutiveFailures}`
        );
        this.emit('item_failed', {
          record,
          error: dispatchResult.errorMessage,
          consecutiveFailures: this.consecutiveFailures,
        });

        // Check Circuit Breaker condition: repeated failures threshold
        if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
          this.pause(
            `Consecutive failure limit (${this.maxConsecutiveFailures}) reached. Halting dispatch.`
          );
          paused = true;
          // Keep all remaining items in the queue
          remainingQueue.push(...queue.slice(i + 1));
          failed += queue.length - (i + 1);
          break; // Stop immediately to protect client and server
        }
      }
    }

    this.storage.saveQueue(remainingQueue);

    if (!paused) {
      this.setStatus('idle', 'Sequential dispatch batch completed');
    }

    const summary: DispatchSummary = { processed, quarantined, failed, duplicates, paused };
    this.log(
      'info',
      `Dispatch batch finished: ${processed} synced, ${quarantined} quarantined, ${failed} failed, ${remainingQueue.length} remaining.`
    );
    this.emit('batch_complete', { ...summary, remainingQueueLength: remainingQueue.length });

    return summary;
  }

  /**
   * Dispatches a single record with local retry attempts before giving up.
   */
  private async dispatchSingleRecord(record: TransactionPayload): Promise<{
    outcome: 'success' | 'duplicate' | 'corrupted' | 'failed';
    ack?: unknown;
    errorMessage?: string;
  }> {
    const attempts = this.recordRetryDelaysMs.length + 1;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = await submitTransactionLog(record, {
          retryDelaysMs: [], // Dispatcher controls the sequential record retry timing
        });
        return { outcome: 'success', ack: result };
      } catch (err: unknown) {
        if (err instanceof DuplicateTransactionError) {
          return { outcome: 'duplicate' };
        }
        if (err instanceof CorruptedPayloadError) {
          return { outcome: 'corrupted', errorMessage: (err as Error).message };
        }

        const isLastAttempt = attempt === attempts;
        const errorMessage = (err as Error)?.message || String(err);

        if (!isLastAttempt) {
          const delayMs = this.recordRetryDelaysMs[attempt - 1];
          this.log(
            'warn',
            `Attempt ${attempt}/${attempts} for ${record.transaction_id} failed (${errorMessage}). Retrying in ${delayMs}ms...`
          );
          this.emit('item_retry', { record, attempt, delayMs, error: errorMessage });
          await new Promise((res) => setTimeout(res, delayMs));
        } else {
          return { outcome: 'failed', errorMessage };
        }
      }
    }

    return { outcome: 'failed', errorMessage: 'Retries exhausted' };
  }
}

/**
 * Singleton instance for app-wide sequential offline dispatching.
 */
export const syncDispatcher = new OfflineBackgroundDispatcher();
