# Proxy ↔ Order flows — the coherent map

Single source of truth for what happens to an order and its proxies in every
scenario: the **statuses** assigned, the **admin signals** (dashboard / bell +
where they link + the filter they land on), the **client signals** (portal +
notifications), and the **next action**. Reflects the state after the
coherence fix (PR #104).

## State model (invariants)

**Order.status:** `NEW` → `PROVISIONING` → `ACTIVE` → `EXPIRED` / `CANCELLED` / `SUSPENDED`. `SUSPENDED` → `ACTIVE`/`PROVISIONING` (Resume), `EXPIRED` (End order now — past due only, §7) or `CANCELLED`.

**Proxy.status:** `AVAILABLE` · `ASSIGNED` · `RELEASED` · `FAULTY` · `MAINTENANCE`.
**Proxy.health:** `HEALTHY` · `DEGRADED` · `OFFLINE`.

Invariants (enforced by the transitions, repaired by migration 20260718100000):
- `AVAILABLE` or `ASSIGNED` ⟹ `HEALTHY`. A pooled/serving proxy is never OFFLINE.
- `OFFLINE` only ever coexists with `FAULTY`.
- Auto-fill / assign / replace only ever draw `AVAILABLE + HEALTHY` candidates.

**Deficit = the one proxy-shortage signal.** A PAID order in `ACTIVE` **or**
`PROVISIONING` whose *effectively-live* assignments (excluding FAULTY/OFFLINE
proxies) are below the bought `qty`. This is the authoritative "does it need
proxies" number — independent of the drift-prone `exception` field.
- Admin dashboard: **Exceptions → «Paid orders missing proxies»** → `/admin/orders?view=underprovisioned`.
- Admin bell: **«N paid orders missing proxies»** → same link. (Counter == the tab's rows.)

## Scenarios

### 1. New paid order · pool has proxies
Pay → auto-provision assigns `qty` proxies from the pool (pool-first: carrier+region+pool, then carrier+region).
- Order → `ACTIVE`; proxies → `ASSIGNED`; `exception` = none.
- Client: proxies appear in portal with credentials; "Order active" notification.
- Admin: nothing in Exceptions (no deficit).

### 2. New paid order · pool short/empty
Pay, but fewer than `qty` `AVAILABLE+HEALTHY` proxies exist.
- Order → `PROVISIONING`; `exception = PAID_NOT_PROVISIONED`; live < qty → **deficit**.
- Admin: dashboard/bell **«Paid orders missing proxies»** (+1); Orders **⚠ Missing proxies** tab lists it. Order badge = Paid, not provisioned.
- Client: order shows "provisioning"; the missing proxies simply aren't there yet.
- **Next action:** admin assigns manually (Order → Assign), or **auto-backfill** (Settings → Flags) tops it up from the pool on the next sweep. When live == qty → order `ACTIVE`, exception clears, deficit clears.

### 3. Proxy faulty · auto-replace ON, candidate available
Mark faulty with auto-replace, and an `AVAILABLE+HEALTHY` proxy exists in the pool.
- Old proxy → `RELEASED` (credentials rotated); new proxy → `ASSIGNED`; order stays `ACTIVE`; no deficit.
- Client: "a proxy was automatically replaced — no action needed" (bell + Telegram).

### 4. Proxy faulty · no candidate (or auto-replace OFF)
- Proxy → `FAULTY + OFFLINE`; its assignment stays **open** (heal-in-place); order `ACTIVE` but effectively-live < qty → **deficit**; `exception = REPLACEMENT_PENDING`.
- Admin: **«Paid orders missing proxies»**; the faulty proxy shows in **Proxies → ⚠ Health Issues** (status FAULTY). Order badge = Replacement pending.
- Client: "a proxy on your order was flagged faulty — a replacement is being arranged (K/M attached)" (bell + Telegram).
- **Next action:** **Replace** (swap for a fresh proxy), **Mark healthy** (if it recovered → back to ASSIGNED), or **Release** (drop it → order still deficit until refilled).

### 5. Proxy released manually
- Proxy → `RELEASED`; assignment closed; order `ACTIVE` but deficit.
- Admin: **«Paid orders missing proxies»**; the order surfaces on Missing proxies.
- Client: "a proxy on your order was released — a replacement is being arranged" (bell + Telegram).
- **Next action:** Replace on the order, or the released proxy → **Return to pool** (→ `AVAILABLE+HEALTHY`, rotates credentials) to make it assignable again.

### 6. Replace (the standalone action — Proxy / Proxies / Order surfaces)
- Old proxy → `RELEASED` (credentials rotated); a fresh `AVAILABLE+HEALTHY` proxy from the same pool → `ASSIGNED`; order's live count unchanged; deficit clears if it was the only gap.
- Client: "a proxy on your order was replaced — {new} is ready with fresh credentials" (bell + Telegram).
- Guard: if no healthy candidate exists, the action fails with a clear message (nothing is released).

### 7. Order expires
- Grace has two forms, both decided by the **clock** (`expiresAt` + the client's grace hours, `lib/grace.ts`): **(A) auto-renew ON** — the sweep tries the balance charge first and, when it fails, keeps the order `ACTIVE` (bucket `GRACE`) retrying every 24h until grace ends, then expires it; **(B) auto-renew OFF** — past `expiresAt` → `EXPIRED` at once. In both forms **proxies are kept through the grace window** (client keeps using them). After grace ends → assignments closed (reason `ORDER_EXPIRED`), proxies → `AVAILABLE + HEALTHY` (credentials rotated). Expiry never touches the auto-renew preference.
- Client: "expired — proxies keep working until {graceEnd}; renew to keep them" (or the auto-renew-failed variants), then "grace ended, proxies released".
- Renewal during grace = plain extension (keeps the proxies); renewal after release re-provisions fresh ones (a new term from the renewal).
- **Admin: End order now** (order page; owner ask 2026-09-05, ORD-21399) — for a **past-due** order in `ACTIVE` (form A), `EXPIRED` (form B, proxies still bound) or `SUSPENDED` (the rescue of the old Suspend → Cancel workaround): the grace-end outcome on the admin's clock — order → `EXPIRED`, all assignments closed (reason `ORDER_EXPIRED`, «Ended by admin · reason»), proxies → `AVAILABLE + HEALTHY` with the rotation markers stamped (the upstream rotation itself stays the manual step it is after any release; the suspended rescue carries the duty recorded at suspension into the log and the dialog). The auto-renew preference is kept (inert while expired, applies again after a renewal; the suspended rescue restores it like Resume would). No refund signal (the term ran out; an open refund case stays with finance). Provisioning duties (`PAID_NOT_PROVISIONED` / `REPLACEMENT_PENDING` / `RENEWAL_FAULTY_PROXY`) clear with the term; refused while `RENEWAL_NOT_EXTENDED` (apply the paid renewal first). Bucket = the sweep's own classification (`GRACE` while the clock is inside grace, `EXPIRED` past it), so the ended order sits on Renewals → *In grace* with the live «In grace» chip until grace ends — coherent with the clock; the next tick re-buckets nothing (it flips to `EXPIRED` at grace end like any expired order). Client: bell "expired on {date}[ — its proxies were released]; Renew / Start a new order to get fresh proxies"; form A additionally gets the sweep's own «term ended» email (the client held an emailed «proxies keep working until {graceEnd}» promise), the suspended rescue an incident email (if enabled), form B the bell only — like the sweep. Renew (re-provision) stays open while the grace clock runs, then Buy again. Not offered before expiry (that is a Cancel, with the refund question) nor on an expired order whose proxies are already released (already the end state).

### 8. Order cancelled
- Path: Cancel is offered directly on every non-terminal status, including `ACTIVE` and `PROVISIONING`-with-proxies (owner ask 2026-09-04: cancel at any moment); Suspend remains the reversible alternative for a live dispute. A **past-due** order is finished with **End order now** (§7) — never cancelled or suspended to end it. For a PAID order the cancel dialog asks how to handle the refund — **Queue for refund review** (raises `REFUND_PENDING`) or **No refund** (closes the case with no refund; same waiver as the *Close without refund* button on an order already in refund review).
- All assignments closed; proxies → `AVAILABLE + HEALTHY` (credentials rotated) — including a formerly FAULTY proxy (no AVAILABLE+OFFLINE leak).
- Order → `CANCELLED`; History tab (per-client) records the released assignments with reason.
- A **paid** cancel raises `exception = REFUND_PENDING` → see §12.

### 9. Proxy maintenance
- Proxy → `MAINTENANCE` (assignment preserved — the client keeps it "on paper").
- Client: portal shows a **«Maintenance»** chip on the proxy (list + detail) and a "under maintenance — service may be briefly interrupted" notification (bell + Telegram); a second one when it leaves maintenance.
- Admin: **Proxies → Maintenance** tab. Not counted as a deficit (still assigned).

### 10. Order suspended
- Order → `SUSPENDED`; proxies reserved (stay `ASSIGNED`), but **hidden from the client portal** (access withdrawn). Maintenance on such a proxy does not notify the client.
- Suspend is for **live disputes** (a reversible pause), **not for ending an expired order**: a suspended order is invisible to the sweep (it walks `ACTIVE`/`EXPIRED` only), so its proxy would stay bound forever with no security reset. A past-due suspended order gets **End order now** (§7: → `EXPIRED`, proxies released) — never Suspend → Cancel, which shows the client the wrong status.

### 11. Auto-backfill (Settings → Flags: "Auto-fill under-provisioned orders from pool")
- When ON, each sweep tops up every deficit order — `ACTIVE` **and** `PROVISIONING` — from `AVAILABLE+HEALTHY` pool proxies (pool-first). **Zero-proxy orders are served first** (a client with nothing beats topping 4/5 up), then oldest-first. FAULTY proxies are never auto-touched — a slot held by a faulty proxy stays with it for heal-in-place; that deficit resolves via **Replace / Mark healthy**, not backfill. When OFF (default), deficits wait for manual Assign/Replace.
- A `PROVISIONING` order that reaches full quota **activates**: status → `ACTIVE`, the term clock starts at activation (same contract as manual Assign), client gets «Order activated — N proxies ready».

### 12. Refund lifecycle (cancel of a paid order)
- Cancel of a paid order → `exception = REFUND_PENDING` («needs review»); a client refund request sets the same tag. Signals: bell/Exceptions «refund review pending» → Orders · Exceptions · Refund review, **and the cancelled order itself carries a Refund button** (resolves right where the link lands).
- Issuing the refund (order page button or Payments → payment detail) credits the client balance and **clears the exception** — the pending counter counts only unresolved reviews, never settled refunds.

## Signal coherence rules (why the above is trustworthy)

- **One event = one name = one link = one filter = one badge.** The proxy
  shortage has exactly one row (deficit); the exception field drives the order
  badge and the Exceptions sub-filters, not a second dashboard row.
- **A counter equals the count on the page its link lands on.** Verified for the
  deficit row (→ Missing proxies tab) and the health widget (→ ⚠ Health Issues).
- **Exception links carry `view=exceptions&exc=KEY`** so they land on the right
  filtered rows, never the unfiltered All tab.
