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

## Operations review (Operation Managers)

`/manager/operations-review` (linked as **Operations review** in the manager views) is the metric dashboard and triage table for the reconciliation engine. It reads `GET /api/kiosk/reconciliation`, which returns each daily log with its interpreted metrics: `expectedRevenue` (meter volume × unit price), `variance` (`reportedCash − expectedRevenue`), and `isAnomaly` (the server's anomaly classification flag for the record).

- Rows the server flagged as anomalous are highlighted amber.
- Rows with a **Revenue shortfall** (`variance < 0`) are highlighted red, because cash below the expected revenue is the most urgent case.
- A row that trips both carries both badges; a row with neither shows **Clear**.
- Summary cards show records reviewed, flagged anomalies, revenue variance alerts, and net variance. **Only flagged records** narrows the table for triage, and **Refresh** re-reads the server.
- The endpoint is unpaginated, so the table renders the newest 200 matching records and says so when there are more.

### Date filter binding (Story 06)

The date filter above the dashboard bounds **every** table and graph on the page: the summary cards, the daily metrics table, both charts and the records table all reload from the same filtered request.

- Presets **All time**, **Today**, **Last 7 Days** and **This Month** apply immediately (the presets use the manager's local calendar days).
- **Start Date** / **End Date** edit a draft range; **Apply** is enabled only for a valid range. A missing bound, a malformed date or a start date after the end date shows an inline error, and an invalid range is never sent to the server.
- `useDashboardData` (`lib/useDashboardData.ts`) owns the filter state and the request: selecting a valid interval changes `appliedRange`, which refetches `GET /api/kiosk/reconciliation?startDate=…&endDate=…`. Stale requests are aborted when the range changes quickly, and the last valid data stays on screen while the next range loads.
- The **Metrics over time** section aggregates the filtered records into local calendar days: a daily totals table, a daily meter-volume bar chart and an expected-vs-reported revenue chart. Both charts are dependency-free inline SVG with an accessible title/description (the daily table is the text alternative). Empty ranges render an empty state instead of empty charts.

The view is read-only and needs the server; it is not available offline.

The anomaly rule behind `isAnomaly` is computed on the server (Sprint 2 story 04, backend task). This view deliberately does not restate the rule in its copy, so the table stays accurate when the backend rule changes.

## Stakeholder analytics (Operation Managers / Stakeholders)

`/manager/stakeholder-analytics` (linked as **Stakeholder analytics** in the manager views) is the monthly stakeholder view for Sprint 2 story 09:

- A **month picker** (defaults to the current local month) reloads the monthly aggregation.
- Three **KPI summary cards**: total gross revenue, outstanding uncollected cash (highlighted when non-zero) and water loss percentage.
- Two tabs: **Overview** compares gross revenue against uncollected cash; **Social Assistance** renders the required side-by-side column chart comparing subsidized and commercial dispensed volume, including each tier's share of the total.
- The charts are dependency-free inline SVG with accessible titles/descriptions, and a zero-value month shows an empty state.

The view reads `GET /api/kiosk/analytics/stakeholder?month=YYYY-MM` from the Sprint 2 data contract (story 09 backend task, owned by the backend side of the team). `lib/stakeholderAnalytics.ts` validates the payload before rendering, so a malformed or as-yet-undeployed endpoint shows an inline error with **Try again** instead of empty or `NaN` cards. The view is read-only and needs the server.

## Run locally

Set `API_BASE_URL` to the server origin (defaults to `http://localhost:3001`). Next.js proxies `/api/*` requests to the server, so the browser does not need direct cross-origin access. Optionally set `NEXT_PUBLIC_KIOSK_ID` (defaults to `KIOSK-001`) and `NEXT_PUBLIC_OPERATOR_ID` (prefills the operator ID field; operators can still edit it).

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The operator posts heartbeats to `/api/kiosk/heartbeat`, evidence photos to `/api/kiosk/logs/:transactionId/evidence`, and transaction logs to `/api/kiosk/logs`. The evidence upload returns a public `proofImageUrl` (hosted on imgBB by the server), which is submitted with the daily log and can be opened from the receipt.

## Offline check

1. Start the app and open the browser's network tools.
2. Keep the operator page open, switch to offline mode, and submit multiple positive meter readings with an operator ID and cash amount.
3. Confirm the pending count and FIFO queue update. The records and app shell persist across reloads and browser restarts.
4. Restore connectivity. Once a server heartbeat succeeds, pending entries are sent sequentially and removed only after acknowledgement.
5. If a payload is rejected or fails its checksum, verify it appears in the isolated-entry count and that later valid entries can still sync.

When submitting while online, confirm the receipt displays the timestamp, operator ID, liter volume, cash submitted, checksum, and server signature. Use **Print / Save as PDF** to keep a copy.

The service worker caches the app shell and its same-origin Next.js static assets after the first online visit. Browser storage is subject to quota and user-clearing, so keep readings available for recovery if local storage cannot be written. Offline evidence uses IndexedDB separately from the localStorage transaction queue to avoid storing image blobs in localStorage.
