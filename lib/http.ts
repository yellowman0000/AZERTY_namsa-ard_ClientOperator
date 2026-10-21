/**
 * HTTP helpers for the kiosk client.
 *
 * - Every request times out after 5 s (AbortController).
 * - On a network error, timeout, or 5xx response, retry with exponential
 *   backoff: wait 2 s, 4 s, then 8 s (4 attempts total).
 * - If every attempt fails, the connection is marked "dropped" and a
 *   ConnectionDroppedError is thrown so the caller can fall back to the
 *   offline queue.
 *
 * 4xx responses (e.g. 409 duplicate) are NOT retried: they are returned to the
 * caller, because retrying cannot change the outcome.
 */

export type ConnectionStatus = 'connected' | 'retrying' | 'dropped';

export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_RETRY_DELAYS_MS = [2000, 4000, 8000];

export class ConnectionDroppedError extends Error {
  readonly attempts: number;
  readonly lastError: unknown;

  constructor(attempts: number, lastError?: unknown) {
    super(`Connection dropped after ${attempts} attempts`);
    this.name = 'ConnectionDroppedError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

/* ---------- Tiny shared store so the UI can react to connection state ---------- */

let currentStatus: ConnectionStatus = 'connected';
const listeners = new Set<() => void>();

function setStatus(next: ConnectionStatus) {
  if (currentStatus === next) return;
  currentStatus = next;
  listeners.forEach((listener) => listener());
}

/** Compatible with React's useSyncExternalStore. */
export const connectionStatus = {
  get: (): ConnectionStatus => currentStatus,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/* ---------- Core helpers ---------- */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A single fetch that is aborted if no response headers arrive within timeoutMs. */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Respect a caller-supplied AbortSignal as well.
  const external = init.signal;
  const onExternalAbort = () => controller.abort();
  if (external?.aborted) controller.abort();
  external?.addEventListener('abort', onExternalAbort);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onExternalAbort);
  }
}

export interface RetryOptions {
  timeoutMs?: number;
  /** Delays before each retry. Default [2000, 4000, 8000]. */
  retryDelaysMs?: number[];
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

/** fetch with timeout + exponential backoff. Throws ConnectionDroppedError when exhausted. */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: RetryOptions = {}
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    onRetry,
  } = options;

  const maxAttempts = retryDelaysMs.length + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchWithTimeout(input, init, timeoutMs);
      if (res.status < 500) {
        setStatus('connected');
        return res; // success or a non-retryable 4xx: caller decides
      }
      lastError = new Error(`Server responded with ${res.status}`);
    } catch (err) {
      if (init.signal?.aborted) throw err; // caller cancelled on purpose: don't retry
      lastError = err;
    }

    if (attempt < maxAttempts) {
      const delay = retryDelaysMs[attempt - 1];
      setStatus('retrying');
      onRetry?.(attempt, delay, lastError);
      await sleep(delay);
    }
  }

  setStatus('dropped');
  throw new ConnectionDroppedError(maxAttempts, lastError);
}
