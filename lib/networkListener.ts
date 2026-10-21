export interface ReconnectListenerOptions {
  kioskId: string;
  /** Called once per reconnection, only after /api/heartbeat has answered successfully. */
  onReconnect: () => void | Promise<void>;
  serverUrl?: string;
  /** Max wait for a single heartbeat ping. Default 5000. */
  pingTimeoutMs?: number;
  /** Wait between ping attempts after an `online` event. Default 3000. */
  retryDelayMs?: number;
  /** Ping attempts per `online` event before giving up. Default 5. */
  maxAttempts?: number;
}

/**
 * Listens for the browser `online` event and confirms real connectivity with a
 * successful POST /api/heartbeat before reporting a reconnection.
 *
 * `online` only means a network interface is up (it can fire before cellular data
 * actually works, or behind a captive portal), so the ping is retried a few times.
 * A later `offline` event cancels any verification in progress.
 *
 * Returns a cleanup function that removes the listeners.
 */
export function listenForReconnection({
  kioskId,
  onReconnect,
  serverUrl = '/api/kiosk/heartbeat',
  pingTimeoutMs = 5000,
  retryDelayMs = 3000,
  maxAttempts = 5,
}: ReconnectListenerOptions): () => void {
  if (typeof window === 'undefined') return () => {};

  let verifying: AbortController | null = null;

  const ping = async (cancel: AbortController): Promise<boolean> => {
    const ctrl = new AbortController();
    const onCancel = () => ctrl.abort();
    cancel.signal.addEventListener('abort', onCancel);
    const timer = setTimeout(() => ctrl.abort(), pingTimeoutMs);
    try {
      const res = await fetch(serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kioskId,
          kiosk_id: kioskId,
          client_timestamp: new Date().toISOString(),
        }),
        signal: ctrl.signal,
        cache: 'no-store',
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
      cancel.signal.removeEventListener('abort', onCancel);
    }
  };

  const sleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal.addEventListener('abort', done);
    });

  const verify = async () => {
    if (verifying) return; // already confirming this reconnection
    const cancel = new AbortController();
    verifying = cancel;
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (cancel.signal.aborted || !window.navigator.onLine) return;
        if (await ping(cancel)) {
          if (cancel.signal.aborted) return;
          console.log('[NetworkListener] Heartbeat confirmed, connection restored.');
          try {
            await onReconnect();
          } catch (err) {
            console.error('[NetworkListener] onReconnect failed:', err);
          }
          return;
        }
        if (attempt < maxAttempts) await sleep(retryDelayMs, cancel.signal);
      }
      console.warn('[NetworkListener] Browser reported online but heartbeat never succeeded.');
    } finally {
      if (verifying === cancel) verifying = null;
    }
  };

  const handleOnline = () => {
    void verify();
  };
  const handleOffline = () => {
    verifying?.abort();
    verifying = null;
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    verifying?.abort();
    verifying = null;
  };
}
