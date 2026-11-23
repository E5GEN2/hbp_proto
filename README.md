# HBP Proto

Production-shaped prototype of a mobile-proxy reseller platform — single Next.js + PostgreSQL + Prisma codebase serving **both** the client portal and the operator admin panel on shared data.

Historical handoff: [`Gooeex/proxy-handoff`](https://github.com/Gooeex/proxy-handoff) — the original May-2026 handoff package (static HTML prototypes + spec docs). Current behaviour is described by the code and [`PROXY_ORDER_FLOWS.md`](PROXY_ORDER_FLOWS.md).

---

## Stack

- **Next.js 15** (App Router) + **React 19** + TypeScript
- **NextAuth 4** (Credentials provider, bcrypt-hashed passwords, JWT sessions, role-gated routes)
- **Prisma 7** (`prisma-client` generator, `@prisma/adapter-pg` driver adapter over `pg`) + **PostgreSQL 16**
- Integrations, all optional in local dev (see [Environment variables](#environment-variables)): NOWPayments (crypto payments + IPN webhook), Resend (transactional email), Telegram Bot API (admin alerts)
- Two surfaces in one app, plus the public pages:
  - `/` — **public landing** (signed-in users are sent to their panel; the legacy `/marketing` path redirects here)
  - `/login`, `/register`, `/forgot`, `/reset`, `/verify` — **auth**
  - `/dashboard`, `/orders`, `/proxies`, `/billing`, `/catalog`, `/checkout`, `/settings`, `/support` — **client portal**
  - `/admin`, `/admin/orders`, `/admin/clients`, `/admin/plans` (+ `/new`), `/admin/proxies` (+ `/new`), `/admin/payments`, `/admin/renewals`, `/admin/logs`, `/admin/settings` — **operator panel**
  - API: `/api/auth/*`, `/api/checkout/*`, `/api/notifications`, `/api/webhooks/nowpayments`, `/api/cron/sweep`, `/api/admin/*`

---

## Local dev

### Prerequisites
- Node.js ≥ 20.19 (`engines.node`; CI uses Node 22 — e.g. `nvm install 22`)
- pnpm (`npm i -g pnpm`; CI uses pnpm 9)
- Postgres 14+ running locally (any flavor: Homebrew, Docker, etc.)

### Setup
```bash
git clone https://github.com/E5GEN2/hbp_proto.git
cd hbp_proto

# .env comes first: `pnpm install` runs `prisma generate` (postinstall), and
# prisma.config.ts requires DATABASE_URL even for that step.
cp .env.example .env
# Edit .env — set DATABASE_URL and NEXTAUTH_SECRET

pnpm install         # postinstall: prisma generate → src/generated/prisma

# Create the database and apply the schema
createdb hbp_proto   # or use your psql tool
pnpm db:deploy       # runs migrations

# Seed with demo data (admins, clients, plans, orders, proxies, payments)
pnpm db:seed

pnpm dev
```

App is at http://localhost:3000.

- The Prisma client is generated into `src/generated/prisma` (git-ignored). Import `@/generated/prisma/client` or `@/generated/prisma/enums`, never `@prisma/client`. After editing `prisma/schema.prisma`, `pnpm db:migrate` creates a migration and regenerates the client.
- Two partial unique indexes exist only in hand-written migrations: never run `pnpm db:push` (`prisma db push`) against a real database — it would drop them — and check `migrate dev` diffs for a generated `DROP INDEX` (see the comments in `prisma/schema.prisma`).
- Checks — the same gates CI runs (`.github/workflows/quality.yml`): `pnpm typecheck` · `pnpm lint` · `pnpm test`.

### Demo accounts

The seed creates these accounts. Passwords are **not** hardcoded: set
`SEED_ADMIN_PASSWORD` and `SEED_CLIENT_PASSWORD` before seeding, or let the seed
generate strong random ones and print them once when it runs.

| Role | Email |
|---|---|
| Client | `demo@example.com` (plus a few more `@example.com` demo clients with the same password) |
| Super admin | `admin@hbp.local` |
| Ops admin | `ops@hbp.local` |
| Support admin | `support@hbp.local` |
| System actor (`ADM-SYS`; not a person — the actor of automated actions) | `system@hbp.local` |

---

## Deploy to Railway

1. **Create a Railway project** → New Project → "Deploy from GitHub repo" → pick `E5GEN2/hbp_proto`.

2. **Add a PostgreSQL service** → in your Railway project → New → Database → PostgreSQL. Railway provisions one with a `DATABASE_URL` variable.

3. **Wire env vars** on the Next.js service. Click the service → Variables tab → add the minimum to boot (the build needs `DATABASE_URL` too — it runs `prisma generate`):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway reference syntax — pulls from the Postgres service) |
   | `NEXTAUTH_URL` | `https://YOUR-DOMAIN.up.railway.app` (or your custom domain) |
   | `NEXTAUTH_SECRET` | a 32-byte random string. Generate with: `openssl rand -base64 32` |

   Add the integrations you use from [Environment variables](#environment-variables).

4. **Deploy** — Railway auto-builds with Nixpacks. The build runs:
   - `pnpm install` → `postinstall` runs `prisma generate` → writes the client to `src/generated/prisma` (git-ignored; import `@/generated/prisma/client` or `@/generated/prisma/enums`, never `@prisma/client`)
   - `pnpm build` → `prisma generate && next build`
   - On start: `prisma migrate deploy && next start -p $PORT`
   - Migrations run automatically every deploy.

5. **Seed the DB once** after the first deploy:
   ```bash
   # From your machine, with Railway CLI installed
   railway login
   railway link   # pick the project
   railway run pnpm db:seed
   ```
   ⚠️ The seed script wipes & re-creates data. Don't run it on production after real data lands.

6. **Verify** — open the Railway URL, log in as `admin@hbp.local` (password from the seed step above).

### Notes for deploy
- `package.json` has `engines.node: >=20.19.0`. Railway respects this when it picks the Node version.
- `railway.json` declares the start command (`pnpm start` which chains `prisma migrate deploy` then `next start`).
- The seed assumes fresh tables. To re-seed without the wipe, edit `prisma/seed.ts` first.
- The lifecycle sweep runs inside the web process (see [Lifecycle sweep](#lifecycle-sweep)); no separate worker or cron service is required.

---

## Environment variables

Names and purpose only — values live in your local `.env` or on the service, never in the repo. [`.env.example`](.env.example) lists every variable below except `CONFIRM`.

| Variable | Needed for | Purpose |
|---|---|---|
| `DATABASE_URL` | always (build + runtime) | Postgres connection string — read by the app's client (`src/lib/prisma.ts`, pg adapter) and by the Prisma CLI through `prisma.config.ts` (strictly, even for `prisma generate`) |
| `NEXTAUTH_URL` | always | Public base URL of the app for NextAuth; also the fallback base for absolute links |
| `NEXTAUTH_SECRET` | always | Signs the session JWT (NextAuth and `src/middleware.ts`) |
| `APP_URL` | optional | Base URL for links that leave the app (emails, payment redirects, IPN callback); wins over `NEXTAUTH_URL` |
| `NEXT_PUBLIC_BRAND_NAME` | optional | Brand name in the UI, emails and invoices (read at build time; unset = the default in `src/lib/brand.ts`) |
| `NOWPAYMENTS_API_KEY` | crypto payments | Creates crypto charges and checks IPNs / reconciles payments against the NOWPayments API; unset = crypto checkout is unavailable (unless the dev mock is allowed) |
| `NOWPAYMENTS_IPN_SECRET` | crypto payments | HMAC secret of the IPN webhook (`/api/webhooks/nowpayments`); unset = the webhook answers 503 |
| `NOWPAYMENTS_SANDBOX` | testing only | `true` = use the NOWPayments sandbox API |
| `RESEND_API_KEY` | email | Resend API key; unset = emails are skipped (logged), password reset is unavailable and sign-ups skip email verification |
| `EMAIL_FROM` | optional | Sender of transactional email (unset = the default in `src/lib/email.ts`) |
| `TELEGRAM_BOT_TOKEN` | Telegram | Bot token; unset = every Telegram send is a no-op |
| `TELEGRAM_ADMIN_CHAT_ID` | Telegram | Ops chat for admin alerts (new paid orders, admin sign-ins, crypto payments that need attention) |
| `CRON_SECRET` | optional | Lets an external scheduler trigger `/api/cron/sweep` with the `x-cron-secret` header (a signed-in admin can trigger it without one) |
| `ALLOW_MOCK_PAYMENTS` | local testing only | `true` enables the mock card / mock crypto payment paths; always off when `NODE_ENV=production` |
| `SEED_ADMIN_PASSWORD`, `SEED_CLIENT_PASSWORD` | seed scripts | Passwords for the seeded accounts (≥ 8 characters); unset = random, printed once |
| `CONFIRM` | maintenance scripts | Must be `YES` to run the destructive `prisma/clean.ts` / `prisma/wipe-orders.ts` |

`NODE_ENV`, `NEXT_RUNTIME` and `NEXT_PHASE` are read too, but Node.js / Next.js set them. The local `scripts/visual-diff/run.py` tool reads its own `BASE_URL`, `BASELINE_DIR`, `CHROME`, `DEMO_EMAIL` and `DEMO_PASSWORD`.

---

## Architecture

### Cross-surface transition layer
Every admin mutation that affects the client portal goes through `src/lib/transitions.ts`. Each transition is a Prisma `$transaction` that:
1. Validates state
2. Performs the change + cascades (proxies, invoices, ledger entries)
3. Writes an audit `Log` entry
4. Creates a `Notification` for the affected client

Email and Telegram messages are queued inside the transaction and sent only after it commits.

Available transitions (non-exhaustive — see the exports of `src/lib/transitions.ts`):
`markPaymentPaid` · `initiateRefund` · `completeRefund` · `cancelOrder` · `closeWithoutRefund` · `declineRefundRequest` · `suspendOrder` · `resumeOrder` · `endOrderNow` · `extendOrder` · `assignProxyManually` · `markCredentialsDelivered` · `markProxyFaulty` · `releaseProxy` · `togglePlanActive` · `adjustBalance` · `blockClient` · `unblockClient`

### Lifecycle sweep
`src/instrumentation.ts` starts an in-process loop (`src/lib/sweep.ts`; first tick ~15 s after boot, then every 5 min). Among other steps, each run reconciles crypto payments with NOWPayments, charges auto-renew orders from the client balance, expires orders, releases proxies once the client's grace window is over, sends pre-renewal reminders, re-buckets the Renewals board, times out unpaid crypto charges after 72 h, backfills under-provisioned orders from the pool when that flag is on, and prunes client bell items older than 7 days. `GET`/`POST /api/cron/sweep` forces a run (a signed-in admin, or an external cron with `CRON_SECRET`). Scenario-by-scenario behaviour: [`PROXY_ORDER_FLOWS.md`](PROXY_ORDER_FLOWS.md).

### Data model
24 Prisma models. Highlights:
- **User** — unified role enum (`CLIENT` / `ADMIN_SUPER` / `ADMIN_OPS` / `ADMIN_SUPPORT`)
- **Plan** — capacity-aware; client `/catalog` shows `active=true AND visibility=PUBLIC` plans (not deleted, not marked `SOLD_OUT`) as one card per duration; a duration that is sold out in every location keeps its card, which opens a sold-out dialog instead of checkout
- **Order** — lifecycle (`NEW` / `PROVISIONING` / `ACTIVE` / `SUSPENDED` / `EXPIRED` / `CANCELLED`; `AWAITING` and `PENDING_RENEWAL` are in the enum but no flow sets them) + exception system; a renewal extends the same order
- **Assignment** — proxy↔order history (rows are closed, not rewritten; deleting a proxy also deletes its released history)
- **Payment** + **Invoice** — separate entities; balance ledger is independent
- **BalanceLedgerEntry** — append-only; written ops are TOPUP / ORDER_DEBIT / MANUAL_ADJUST (`REFUND_CREDIT` stays in the enum but is no longer written — refunds are returned outside the portal since #159)
- **Log** — audit trail, polymorphic over (object_type, object_id)
- **Notification** — client-visible bell items (kept 7 days)
- **SystemSetting** — KV bucket for provider toggles, grace rules, flags

Full schema: `prisma/schema.prisma`.

---

## Phase scope

| Phase | Status |
|---|---|
| Phase 1 — Admin (super-only), client portal with isolation, lifecycle wired | ✅ Built |
| Phase 1.5 — Stage 1.5 surfaces (balance ledger / invoices / whitelist / rotation policy / provider enum) | Partial — balance ledger (deposits, balance payments, Adjust balance) and invoices (admin PDF) are built; the per-proxy IP whitelist is saved but not enforced yet; rotation is the per-proxy rotation URL only (URL reset and auto-rotation are not wired); provider enum not started |
| Shipped since — in-portal crypto payments (NOWPayments), lifecycle sweep (expiry, client grace, balance auto-renew, reminders, release after grace), manual two-step refunds, transactional email, admin Telegram alerts, email verification + password reset, public landing at `/` | ✅ Built |
| Phase 2 — Admin RBAC / 2FA / advanced webhooks / support tickets / API keys / accessibility audit | ❌ Deferred (deferred UI items: [`PHASE2_BACKLOG.md`](PHASE2_BACKLOG.md)) |

## Docs in this repo

- [`PROXY_ORDER_FLOWS.md`](PROXY_ORDER_FLOWS.md) — what happens to an order and its proxies in every scenario: statuses, admin and client signals, next actions.
- [`PHASE2_BACKLOG.md`](PHASE2_BACKLOG.md) — deferred features from the owner's page-by-page review.
- [`SECURITY.md`](SECURITY.md) — security policy, the automated security pipeline, pre-deploy checklist.
- [`Gooeex/proxy-handoff`](https://github.com/Gooeex/proxy-handoff) — the historical May-2026 handoff (prototypes + spec). Where it disagrees with the code, the code and `PROXY_ORDER_FLOWS.md` describe current behaviour.
