import { useState, useEffect } from 'react';
import {
  fetchWithRetry,
  connectionStatus,
  DEFAULT_RETRY_DELAYS_MS,
} from './http';

interface HeartbeatOptions {
  kioskId: string;
  intervalMs?: number;
  serverUrl?: string;
  onHeartbeat?: () => void;
}

/**
 * Sends a periodic heartbeat ping to POST /api/kiosk/heartbeat (fallback /api/heartbeat) every 10 seconds.
 *
 * The heartbeat is also what detects recovery: once the connection is marked
 * "dropped", each ping is a single cheap probe (no backoff). The first success
 * flips the shared status back to "connected", which triggers the queue flush.
 */
export function useKioskHeartbeat({
  kioskId,
  intervalMs = 10000,
  serverUrl = '/api/kiosk/heartbeat',
  onHeartbeat,
}: HeartbeatOptions) {
  const [lastPingTime, setLastPingTime] = useState<string | null>(null);
  const [pingStatus, setPingStatus] = useState<'idle' | 'ok' | 'failed'>('idle');

  useEffect(() => {
    if (!kioskId) return;

    const controller = new AbortController();
    let inFlight = false; // a full retry cycle (~34 s) outlasts the 10 s interval

    const sendHeartbeat = async () => {
      if (inFlight) return;

      if (typeof window !== 'undefined' && !window.navigator.onLine) {
        console.warn('[Heartbeat] Offline, skipping ping.');
        setPingStatus('failed');
        return;
      }

      inFlight = true;
      try {
        console.log(`[Heartbeat] Sending ping to ${serverUrl} (kiosk: ${kioskId})...`);

        const alreadyDropped = connectionStatus.get() === 'dropped';
        const res = await fetchWithRetry(
          serverUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              kioskId,
              kiosk_id: kioskId,
              client_timestamp: new Date().toISOString(),
            }),
            signal: controller.signal,
          },
          { retryDelaysMs: alreadyDropped ? [] : DEFAULT_RETRY_DELAYS_MS }
        );

        if (res.ok) {
          const data = await res.json().catch(() => null);
          console.log('[Heartbeat] Ping acknowledged by server:', data);
          setPingStatus('ok');
          setLastPingTime(new Date().toLocaleTimeString());
          onHeartbeat?.();
        } else {
          console.warn(`[Heartbeat] Ping returned status ${res.status}`);
          setPingStatus('failed');
        }
      } catch (err) {
        if (controller.signal.aborted) return; // unmounted
        console.warn('[Heartbeat] Ping failed:', err);
        setPingStatus('failed');
      } finally {
        inFlight = false;
      }
    };

    sendHeartbeat();
    const timer = setInterval(sendHeartbeat, intervalMs);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [kioskId, intervalMs, onHeartbeat, serverUrl]);

  return { lastPingTime, pingStatus };
}
