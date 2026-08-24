-- Pre-renewal reminder cascade (owner decision 2026-08-22): effective hours =
-- client override → plan value → global Settings default (mirrors the grace
-- cascade, PR #160). Both columns become nullable ("inherit the next level").
--   · users.preRenewalReminderHours was WRITE-ONLY before this change — the
--     sweep never read it, so any admin-entered values had no effect. NULLing
--     them all is the honest baseline (no behaviour changes; from now on a
--     value here really overrides).
--   · plans.preRenewalReminderHours WAS live (the sweep read it) — existing
--     values are preserved; only the NOT NULL/default constraints drop so a
--     new plan can leave it blank and inherit the global default.
-- Safe for `prisma migrate deploy` on live data.

ALTER TABLE "users" ALTER COLUMN "preRenewalReminderHours" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "preRenewalReminderHours" DROP DEFAULT;
UPDATE "users" SET "preRenewalReminderHours" = NULL;

ALTER TABLE "plans" ALTER COLUMN "preRenewalReminderHours" DROP NOT NULL;
ALTER TABLE "plans" ALTER COLUMN "preRenewalReminderHours" DROP DEFAULT;
