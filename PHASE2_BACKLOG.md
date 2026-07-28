# Phase 2 backlog

Deferred features surfaced during owner page-by-page review. Each item is
**not started** — the UI either shows an honest placeholder (a dash, a removed
control) or is listed here until the backing functionality is built.

## Proxy telemetry (live data)

The client Proxies table columns **Auto rotation · Uptime 30D · Speed ·
Health** have no live data source yet — they render `—` until real telemetry
exists (owner decision 2026-07-28). When telemetry lands:

- Auto rotation: per-proxy rotation interval (currently `Proxy.autoRotateMin`, not wired to anything real).
- Uptime 30D / Speed: require a monitoring pipeline (no collector today).
- Health: today `Proxy.health` is admin/sweep-set, not from automated probing — a real health monitor is needed before the column shows a live value again.

## Proxy bulk actions (no backend)

Removed from the client Proxies bulk bar until implemented (owner 2026-07-28):

- **Rotate IP** — needs a rotation call against the upstream rotation URL.
- **Run health check** — needs the health-probe pipeline above.

(`Copy credentials` stays — it works, and now copies the selected proxies' credentials **with** their rotation URLs.)

## Table column layout overhaul (both portals)

Owner flagged the current table column arrangement/sizing as inconsistent
("бардак", 2026-07-28). A dedicated pass should standardise, across every table
in both portals:

- column order and which columns each table shows,
- fixed vs flexible widths (atomic columns — checkbox / status / id / numeric /
  date — sized to never truncate; text columns wrap),
- the P1 no-ellipsis rule applied uniformly (currently scoped to `.dt-proxies`).

## Additional table filters (both portals)

Add richer filtering to the data tables in both portals — e.g.:

- filter by **proxy status** (Available / Assigned / Faulty / Maintenance / …),
- sort/filter by **date added** (Newest / Oldest),
- and equivalent per-table dimensions where useful.
