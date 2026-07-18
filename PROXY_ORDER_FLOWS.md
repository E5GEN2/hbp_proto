# Proxy ↔ Order flows — the coherent map

Single source of truth for what happens to an order and its proxies in every
scenario: the **statuses** assigned, the **admin signals** (dashboard / bell +
where they link + the filter they land on), the **client signals** (portal +
notifications), and the **next action**. Reflects the state after the
coherence fix (PR #104).

## State model (invariants)

**Order.status:** `NEW` → `PROVISIONING` → `ACTIVE` → `EXPIRED` / `CANCELLED` / `SUSPENDED`.

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
- Sweep: past `expiresAt` → `EXPIRED`; **proxies kept through the grace window** (client keeps using them). After grace ends → assignments closed (reason `ORDER_EXPIRED`), proxies → `AVAILABLE + HEALTHY` (credentials rotated).
- Client: "expired — proxies keep working until {graceEnd}; renew to keep them", then "grace ended, proxies released".
- Renewal during grace = plain extension (keeps the proxies); renewal after release re-provisions fresh ones.

### 8. Order cancelled
- All assignments closed; proxies → `AVAILABLE + HEALTHY` (credentials rotated) — including a formerly FAULTY proxy (no AVAILABLE+OFFLINE leak).
- Order → `CANCELLED`; History tab (per-client) records the released assignments with reason.

### 9. Proxy maintenance
- Proxy → `MAINTENANCE` (assignment preserved — the client keeps it "on paper").
- Client: portal shows a **«Maintenance»** chip on the proxy (list + detail) and a "under maintenance — service may be briefly interrupted" notification (bell + Telegram); a second one when it leaves maintenance.
- Admin: **Proxies → Maintenance** tab. Not counted as a deficit (still assigned).

### 10. Order suspended
- Order → `SUSPENDED`; proxies reserved (stay `ASSIGNED`), but **hidden from the client portal** (access withdrawn). Maintenance on such a proxy does not notify the client.

### 11. Auto-backfill (Settings → Flags: "Auto-fill under-provisioned orders from pool")
- When ON, each sweep tops up every deficit order from `AVAILABLE+HEALTHY` pool proxies (pool-first), closing the deficit without manual assignment. FAULTY proxies are never auto-touched (heal or Replace them explicitly). When OFF (default), deficits wait for manual Assign/Replace.

## Signal coherence rules (why the above is trustworthy)

- **One event = one name = one link = one filter = one badge.** The proxy
  shortage has exactly one row (deficit); the exception field drives the order
  badge and the Exceptions sub-filters, not a second dashboard row.
- **A counter equals the count on the page its link lands on.** Verified for the
  deficit row (→ Missing proxies tab) and the health widget (→ ⚠ Health Issues).
- **Exception links carry `view=exceptions&exc=KEY`** so they land on the right
  filtered rows, never the unfiltered All tab.
