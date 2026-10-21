import { QUEUE_KEY } from './dispatcher';

/**
 * Initializes the `offline_tx_queue` localStorage key so it always exists and
 * holds a JSON array of pending transaction objects (`[]` when empty).
 *
 * Safe to call repeatedly: an existing valid array is never overwritten.
 * No-op on the server (no localStorage).
 */
export function initOfflineTxQueue(): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    if (raw !== null && Array.isArray(JSON.parse(raw))) return; // already valid
  } catch {
    // unreadable value: fall through and reset it
  }
  try {
    window.localStorage.setItem(QUEUE_KEY, '[]');
  } catch (e) {
    console.error('[offlineStore] Could not initialize offline_tx_queue:', e);
  }
}
