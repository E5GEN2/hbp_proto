-- Grace period moves from the plan to the client (owner decision 2026-08-12):
-- a per-client override plus tier defaults (Settings → Grace / lib/grace.ts).
-- The new override is nullable (NULL = tier default); dropping the plan column
-- is safe because every runtime reader was switched to the client cascade in
-- the same change (grep gracePeriodHours = 0 outside migrations).

ALTER TABLE "users" ADD COLUMN "graceHoursOverride" INTEGER;

ALTER TABLE "plans" DROP COLUMN "gracePeriodHours";
