-- Backfill: earlier code stamped credentialsChannel='EMAIL' although no email
-- pipeline exists (DECISIONS.md §9 — send-event is delivery). New code writes
-- NULL; clear the false claims on legacy rows too.
UPDATE "orders" SET "credentialsChannel" = NULL WHERE "credentialsChannel" IS NOT NULL;
