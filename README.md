# HBP Proto

Production-shaped prototype of a mobile-proxy reseller platform — single Next.js + PostgreSQL + Prisma codebase serving **both** the client portal and the operator admin panel on shared data.

Spec source: [`Gooeex/proxy-handoff`](https://github.com/Gooeex/proxy-handoff) (static HTML prototypes + decision docs).

---

## Stack

- **Next.js 14** (App Router) + React 18 + TypeScript
- **NextAuth** (Credentials provider, bcrypt-hashed passwords, JWT sessions, role-gated routes)
- **Prisma 5** + **PostgreSQL 16**
- Two surfaces in one app:
  - `/marketing`, `/dashboard`, `/orders`, `/proxies`, `/billing`, `/catalog`, `/checkout`, `/settings`, `/support` — **client portal**
  - `/admin`, `/admin/orders`, `/admin/clients`, `/admin/plans`, `/admin/proxies`, `/admin/payments`, `/admin/renewals`, `/admin/logs`, `/admin/settings` — **operator panel**

---

## Local dev

### Prerequisites
- Node.js ≥ 20 (use `nvm install 20`)
- pnpm (`npm i -g pnpm`)
- Postgres 14+ running locally (any flavor: Homebrew, Docker, etc.)

### Setup
```bash
git clone https://github.com/E5GEN2/hbp_proto.git
cd hbp_proto
pnpm install

cp .env.example .env
# Edit .env — set DATABASE_URL and NEXTAUTH_SECRET

# Create the database and apply the schema
createdb hbp_proto   # or use your psql tool
pnpm db:deploy       # runs migrations

# Seed with demo data (admins, clients, plans, orders, proxies, payments)
pnpm db:seed

pnpm dev
```

App is at http://localhost:3000.

### Demo credentials
| Role | Email | Password |
|---|---|---|
| Client | `demo@example.com` | `demo1234` |
| Super admin | `admin@hbp.local` | `admin1234` |
| Ops admin | `ops@hbp.local` | `admin1234` |
| Support admin | `support@hbp.local` | `admin1234` |

---

## Deploy to Railway

1. **Create a Railway project** → New Project → "Deploy from GitHub repo" → pick `E5GEN2/hbp_proto`.

2. **Add a PostgreSQL service** → in your Railway project → New → Database → PostgreSQL. Railway provisions one with a `DATABASE_URL` variable.

3. **Wire env vars** on the Next.js service. Click the service → Variables tab → add:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway reference syntax — pulls from the Postgres service) |
   | `NEXTAUTH_URL` | `https://YOUR-DOMAIN.up.railway.app` (or your custom domain) |
   | `NEXTAUTH_SECRET` | a 32-byte random string. Generate with: `openssl rand -base64 32` |

4. **Deploy** — Railway auto-builds with Nixpacks. The build runs:
   - `pnpm install` → `postinstall` runs `prisma generate`
   - `pnpm build` → `next build`
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

6. **Verify** — open the Railway URL, log in as `admin@hbp.local / admin1234`.

### Notes for deploy
- `package.json` has `engines.node: >=20`. Railway respects this and picks Node 20+.
- `railway.json` declares the start command (`pnpm start` which chains `prisma migrate deploy` then `next start`).
- The seed assumes fresh tables. To re-seed without the wipe, edit `prisma/seed.ts` first.

---

## Architecture

### Cross-surface transition layer
Every admin mutation that affects the client portal goes through `src/lib/transitions.ts`. Each transition is a Prisma `$transaction` that:
1. Validates state
2. Performs the change + cascades (proxies, invoices, ledger entries)
3. Writes an audit `Log` entry
4. Creates a `Notification` for the affected client

Available transitions:
`markPaymentPaid` · `refundPayment` · `cancelOrder` · `suspendOrder` · `resumeOrder` · `extendOrder` · `assignProxyManually` · `markCredentialsDelivered` · `markProxyFaulty` · `releaseProxy` · `togglePlanActive` · `adjustBalance` · `blockClient` · `unblockClient`

### Data model
30 Prisma models. Highlights:
- **User** — unified role enum (`CLIENT` / `ADMIN_SUPER` / `ADMIN_OPS` / `ADMIN_SUPPORT`)
- **Plan** — capacity-aware; client `/catalog` shows only `active=true AND visibility=PUBLIC AND displayAvailable>0`
- **Order** — full lifecycle (`NEW` / `AWAITING` / `PROVISIONING` / `ACTIVE` / `SUSPENDED` / `EXPIRED` / `CANCELLED` / `PENDING_RENEWAL`) + exception system + linked-renewal pattern
- **Assignment** — proxy↔order history (append-only)
- **Payment** + **Invoice** — separate entities; balance ledger is independent
- **BalanceLedgerEntry** — append-only, 4 op types (TOPUP / ORDER_DEBIT / REFUND_CREDIT / MANUAL_ADJUST)
- **Log** — audit trail, polymorphic over (object_type, object_id)
- **Notification** — client-visible bell items
- **SystemSetting** — KV bucket for provider toggles, grace rules, flags

Full schema: `prisma/schema.prisma`.

---

## Phase scope

| Phase | Status |
|---|---|
| Phase 1 — Admin (super-only), client portal with isolation, lifecycle wired | ✅ Built |
| Phase 1.5 — Stage 1.5 surfaces (balance ledger / invoices / whitelist / rotation policy / provider enum) | Partial — schema ready, some UIs deferred |
| Phase 2 — Admin RBAC / 2FA / advanced webhooks / accessibility audit | ❌ Deferred |

See [`Gooeex/proxy-handoff`](https://github.com/Gooeex/proxy-handoff) for the canonical Phase scope, decision log, and lifecycle contract.
