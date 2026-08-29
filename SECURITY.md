# Security Policy

This document defines how we keep hbp_proto secure and the automated checks the
team commits to. It is the go-forward baseline; treat every item as a rule, not a
suggestion.

## Reporting a vulnerability

Do **not** open a public issue for a security problem. Email the maintainers
privately (or use GitHub's **Report a vulnerability** under the Security tab) with
steps to reproduce and impact. We aim to acknowledge within 48 hours. Please give
us reasonable time to remediate before any public disclosure.

## Automated security pipeline

Every push to `main` and every pull request runs these checks (GitHub Actions).
They also run on a weekly schedule so newly-published advisories and queries
re-scan unchanged code.

| Check | Tool | Workflow | Gate |
| --- | --- | --- | --- |
| Secret scanning (full git history) | gitleaks | `security.yml` | **Blocking** |
| Dependency vulnerabilities | `pnpm audit` (High/Critical) | `security.yml` | **Blocking** |
| Dependency updates + alerts | Dependabot | `dependabot.yml` | Auto-PRs |
| SAST — data-flow / injection / auth | CodeQL (`security-extended`) | `codeql.yml` | Alerts (Security tab) |
| SAST — OWASP / Next.js / secrets rules | Semgrep | `security.yml` | Alerts (Security tab) |

- **Secret scanning is zero-tolerance.** A secret in *any* commit of this
  **public** repo is permanently exposed. If the gate ever catches one:
  (1) rotate/revoke the secret immediately, (2) then scrub history. Do not merge
  until it is rotated — removing the commit does not un-leak it.
- **Dependency gate** fails on a High/Critical advisory. Dependabot opens the fix
  PRs; the gate is the backstop for anything not yet merged.
- **CodeQL & Semgrep** publish to **Security → Code scanning alerts**. They are
  non-blocking by design (SAST has false positives), but every new
  High/Critical alert must be triaged before the next release — dismiss with a
  reason or fix it.

Enable once in repo settings (Settings → Code security): Dependabot alerts,
Dependabot security updates, and Secret scanning + push protection.

## Security invariants (must hold in every change)

These are the rules the pipeline can only partially enforce — reviewers own them.

1. **Authenticate then authorize on the server, every time.** Every API route and
   every `'use server'` action must (a) resolve the session server-side and
   (b) scope the operation. Client routes scope *every* DB read/write by the
   session's `clientId`; never trust an id/amount/role from the request body,
   params, or a hidden field. Admin routes/actions call `requireAdmin()` —
   hiding a control in the UI is not authorization.
2. **Middleware is a gate, not the only gate.** `/admin/**` and client routes are
   guarded in `middleware.ts` *and* re-checked per page/route (RSC segments render
   in parallel with the layout). Keep both.
3. **Proxy credentials are the crown jewel.** They may reach only the client who
   owns that order. Never serialize them into an RSC payload, API response, log
   line, email, or alert for anyone else. Never log them at all.
4. **Secrets live only in the environment.** Never commit a real secret; the only
   env file in the repo is `.env.example` (placeholders). Nothing sensitive goes
   in a `NEXT_PUBLIC_*` variable — those ship to the browser.
5. **Fail closed.** Security- or money-relevant flags default to the safe state
   when their env var is absent (e.g. mock payments and sandbox must be OFF
   unless explicitly enabled *and* not in production).
6. **Validate all input** with zod at the trust boundary; use only Prisma's
   parameterized queries (tagged-template `$queryRaw` — never string-built SQL).
7. **No untrusted redirects.** `returnTo`/`callbackUrl` must be allowlisted to
   same-origin paths.
8. **Verify webhooks.** The NOWPayments IPN is authenticated by a timing-safe
   HMAC over the raw body and settled idempotently. Keep both properties.

## Pre-deploy security checklist

Before opening the portal to real clients / any production release:

- [ ] `ALLOW_MOCK_PAYMENTS=false` and `NOWPAYMENTS_SANDBOX` unset on the service.
- [ ] Seed/demo accounts (`admin@hbp.local`, `demo@example.com`, …) removed or
      given strong unique passwords — the seed passwords are in this public repo.
- [ ] All required secrets set on the service and **none** in the repo/history.
- [ ] Security response headers present (CSP, HSTS, X-Frame-Options,
      X-Content-Type-Options, Referrer-Policy, Permissions-Policy).
- [ ] Rate limiting on auth (login/register/reset) and money endpoints
      (deposit/checkout/repay).
- [ ] Green run of the Security workflow on `main`; Security-tab alerts triaged.

## Supported versions

Only the current `main` (the deployed revision) is supported. Keep runtime
dependencies patched via Dependabot; do not pin below a version that carries a
known advisory (e.g. `next` ≥ 14.2.25 for CVE-2025-29927).
