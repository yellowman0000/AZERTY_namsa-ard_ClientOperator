# Nam Sa-ard Client Operator

The operator app captures water-meter volumes and keeps transaction records available when the server cannot be reached. It uses the Nam Sa-ard UI Kit's Deep, Spring, Aqua, Mist, and Ground palette.

## Stories

- **14-1 — Offline data storing cache:** transaction records are saved in FIFO order in browser `localStorage` (`offline_tx_queue`) and remain available across page reloads. The UI shows current connectivity and the number of pending entries.
- **14-2 — Offline data corrupted checker:** queued payloads include a deterministic SHA-256 checksum (`v1`); records that fail local integrity or server validation are isolated in `quarantine_queue`. Duplicate transaction IDs are rejected, and server conflict responses are handled by the dispatcher.
- **14-3 — Offline data auto-sync:** an online transition is confirmed with a server heartbeat before the dispatcher retries pending entries sequentially. Entries are marked processed only after the server acknowledges them. Retry backoff and a circuit breaker prevent a failing server from blocking the UI.

Checksum format and dispatcher behavior are documented in [docs/CHECKSUM_AND_DISPATCHER.md](./docs/CHECKSUM_AND_DISPATCHER.md).

## Run locally

Set `API_BASE_URL` to the server origin (defaults to `http://localhost:3001`). Next.js proxies `/api/*` requests to the server, so the browser does not need direct cross-origin access. Optionally set `NEXT_PUBLIC_KIOSK_ID` (defaults to `KIOSK-001`).

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The operator posts heartbeats to `/api/kiosk/heartbeat` and transaction logs to `/api/kiosk/logs`.

## Offline check

1. Start the app and open the browser's network tools.
2. Keep the operator page open, switch to offline mode, and submit multiple positive meter readings.
3. Confirm the pending count and FIFO queue update. The records and app shell persist across reloads and browser restarts.
4. Restore connectivity. Once a server heartbeat succeeds, pending entries are sent sequentially and removed only after acknowledgement.
5. If a payload is rejected or fails its checksum, verify it appears in the isolated-entry count and that later valid entries can still sync.

The service worker caches the app shell and its same-origin Next.js static assets after the first online visit. Browser storage is subject to quota and user-clearing, so keep readings available for recovery if local storage cannot be written.
