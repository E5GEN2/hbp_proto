# Phase 2 backlog

Deferred features surfaced during owner page-by-page review. Each open item is
**not started** — the UI either shows an honest placeholder (a dash, a removed
control) or is listed here until the backing functionality is built. Items that
shipped later are marked **Done** with their PRs.

## Proxy telemetry (live data)

The client Proxies table columns **Auto rotation · Uptime 30D · Speed** have no
live data source yet — they render `—` until real telemetry exists (owner
decision 2026-07-28). When telemetry lands:

- Auto rotation: per-proxy rotation interval (currently `Proxy.autoRotateMin`, not wired to anything real).
- Uptime 30D / Speed: require a monitoring pipeline (no collector today).

**Health is NOT dashed** — it is a live operator-set status (Mark faulty /
Maintenance / sweep), and the owner's rule is that any live status must be
shown. It stays a chip on the list and detail. (A future automated health
*probe* would only make the existing status more accurate, not add a new
column.)

## Proxy rotation + telemetry actions (no backend)

Removed from the UI until implemented (owner 2026-07-28) — all need a real
rotation call against the upstream rotation URL and/or a monitoring pipeline:

- **Rotate IP** — client Proxies bulk bar AND the proxy-detail header button (removed). `AutoRotationPicker` component is now unused, kept for when rotation lands.
- **Run health check** — client Proxies bulk bar (removed).
- **Auto rotation** — proxy-detail Info row (removed; `Proxy.autoRotateMin` not wired).
- **Last rotated** — proxy-detail Info row (removed; no rotation events recorded).
- **Uptime · Latency** — proxy-detail Info row (removed; no monitoring collector).

(`Copy credentials` stays — it works, and now copies the selected proxies' credentials **with** their rotation URLs.)

## Table column layout overhaul (both portals) — Done

Owner flagged the table column arrangement/sizing as inconsistent
(2026-07-28). Delivered:

- the P1 no-ellipsis rule generalized from `.dt-proxies` to every `table.dt` in
  both portals — text columns wrap, atomic columns clip without dots, mono
  credential / hardware columns keep ellipsis + tooltip (#122, 2026-07-29);
- the client table system (CTS) for the portal's two tables, Billing and
  Proxies — atomic columns (checkbox / id / status / numeric / date) sized from
  real content so they never truncate, one flexible text column, left
  alignment (#132, 2026-08-03);
- the admin table system (ATS) — the same rules across the admin tables; the
  widest ones (Orders, Plans, Proxies) keep every column (owner's call) and get
  a minimum width instead (#133, 2026-08-04).

## Additional table filters (both portals)

Add richer filtering to the data tables in both portals — e.g.:

- filter by **proxy status** (Available / Assigned / Faulty / Maintenance / …),
- sort/filter by **date added** (Newest / Oldest),
- and equivalent per-table dimensions where useful.

## "End order now" — row action on Renewals → In grace (Phase 2)

Phase 1 (2026-09-08) ships **End order now** on the admin order page only
(`endOrderNow` transition, gate in `src/lib/end-order.ts`). The Renewals board
has no per-row action column — its grace/expired views expose a single-select
**Revive** in the bulk bar (`RenewalsBulkTable.tsx`). Phase 2 = a matching
single-select **End order now** button there for `view === 'grace'` (and the
past-grace-held rows of `expired`), reusing `endOrderNowAction` + the same
modal; the server gate already refuses non-past-due rows with a readable
message. Not a multi-select bulk action (each end is a deliberate,
reason-audited call).

## Known peer-writer windows on the money paths (declined 2026-09-08, "rabbit hole B")

`markPaymentPaid` (renewal branch) and `settleAwaitingPayment` (crypto renewal
branch) read the order with a plain `findUnique` — no orders `FOR UPDATE` — and
then write a plain extension keyed on id. A concurrent `endOrderNow` / cancel
committed between that read and the write is overwritten as `ACTIVE` with 0
proxies (ms window, admin-triggered on one side). `extendOrder`, `suspendOrder`,
`resumeOrder` and `endOrderNow` take the order row lock first (family A) and
show the fix; the money paths keep their payment-first lock order and are left
as-is until the payment layer is revisited (marked in code at both reads).
