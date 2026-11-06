# Nam Sa-ard Client Operator

The operator app captures daily water-meter volumes and reported cash, and keeps transaction records available when the server cannot be reached. It uses the Nam Sa-ard UI Kit's Deep, Spring, Aqua, Mist, and Ground palette.

## Stories

- **14-1 — Offline data storing cache:** transaction records are saved in FIFO order in browser `localStorage` (`offline_tx_queue`) and remain available across page reloads. The UI shows current connectivity and the number of pending entries.
- **14-2 — Offline data corrupted checker:** queued payloads include a deterministic SHA-256 checksum (`v1`); records that fail local integrity or server validation are isolated in `quarantine_queue`. Duplicate transaction IDs are rejected, and server conflict responses are handled by the dispatcher.
- **14-3 — Offline data auto-sync:** an online transition is confirmed with a server heartbeat before the dispatcher retries pending entries sequentially. Entries are marked processed only after the server acknowledges them. Retry backoff and a circuit breaker prevent a failing server from blocking the UI.
- **05 — Daily cash and liter submission:** Field Operators submit their operator ID, meter volume, and reported cash. On a matching server acknowledgement, whether submitted online or synced later from the offline queue, the app displays the signed SHA-256 proof receipt, which can be printed or saved as PDF from the browser.
- **Reading evidence:** an optional JPEG, PNG, or WebP photo (up to 5 MB) can be attached to a submission. Online photos upload before the log; offline photos are stored as blobs in IndexedDB and uploaded before the queued log on reconnect. Local photo blobs are removed after the server acknowledges the entry.

## Historical logs (Operation Managers)

`/manager` (linked as **Historical logs** in the top bar) lists submitted daily logs, newest first (`GET /api/kiosk/logs`, 20 per page with **Load older logs**). **Inspect** opens a read-only modal that fetches `GET /api/kiosk/logs/:id/inspect`. The server recomputes the record's SHA-256 checksum on every open and on **Verify again**, and the modal shows:

- **Verified (Tamper-Evident)** (green): the stored record still matches the checksum saved at submission.
- **Checksum Mismatch** (red): the record changed after submission. The stored and recomputed hashes are shown side by side.
- **No checksum on record** (amber): the log was submitted without a checksum, so it can't be verified.

The modal has no edit controls, and both endpoints are GET-only. This view needs the server; it is not available offline.

Checksum format and dispatcher behavior are documented in [docs/CHECKSUM_AND_DISPATCHER.md](./docs/CHECKSUM_AND_DISPATCHER.md).

## Run locally

Set `API_BASE_URL` to the server origin (defaults to `http://localhost:3001`). Next.js proxies `/api/*` requests to the server, so the browser does not need direct cross-origin access. Optionally set `NEXT_PUBLIC_KIOSK_ID` (defaults to `KIOSK-001`) and `NEXT_PUBLIC_OPERATOR_ID` (prefills the operator ID field; operators can still edit it).

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The operator posts heartbeats to `/api/kiosk/heartbeat`, evidence photos to `/api/kiosk/logs/:transactionId/evidence`, and transaction logs to `/api/kiosk/logs`. Configure the server's private Supabase Storage bucket and `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` before using photo uploads; the service-role key belongs only in the server environment.

## Offline check

1. Start the app and open the browser's network tools.
2. Keep the operator page open, switch to offline mode, and submit multiple positive meter readings with an operator ID and cash amount.
3. Confirm the pending count and FIFO queue update. The records and app shell persist across reloads and browser restarts.
4. Restore connectivity. Once a server heartbeat succeeds, pending entries are sent sequentially and removed only after acknowledgement.
5. If a payload is rejected or fails its checksum, verify it appears in the isolated-entry count and that later valid entries can still sync.

When submitting while online, confirm the receipt displays the timestamp, operator ID, liter volume, cash submitted, checksum, and server signature. Use **Print / Save as PDF** to keep a copy.

The service worker caches the app shell and its same-origin Next.js static assets after the first online visit. Browser storage is subject to quota and user-clearing, so keep readings available for recovery if local storage cannot be written. Offline evidence uses IndexedDB separately from the localStorage transaction queue to avoid storing image blobs in localStorage.
