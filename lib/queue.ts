/**
 * Offline Queue & Synchronization Dispatcher Module.
 *
 * Story: 14-3 (Offline data auto-sync after reconnection)
 * Subtask: 2. Build automated sequential background dispatcher to push pending records
 * Owner: Ball
 *
 * Re-exports the modular sequential background dispatcher and storage abstractions.
 */

export {
  OfflineBackgroundDispatcher,
  OfflineBackgroundDispatcher as OfflineSyncDispatcher,
  syncDispatcher,
  QUEUE_KEY,
  QUARANTINE_KEY,
  PROCESSED_KEY,
  LocalStorageQueueStorage,
} from './dispatcher';

export type {
  DispatcherStatus,
  DispatcherOptions,
  DispatcherStats,
  DispatchSummary,
  DispatcherEvent,
  DispatcherEventType,
  DispatcherEventListener,
  IQueueStorage,
  LogLevel,
} from './dispatcher';