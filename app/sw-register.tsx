'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      console.warn('[ServiceWorker] Offline app shell is not supported in this browser.');
      return;
    }

    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.error('[ServiceWorker] Registration failed:', error);
    });
  }, []);

  return null;
}
