-- Seed the built-in "Default Pool" (product ask 2026-07-07): plan-create now
-- hardlocks its Proxy pool default to this value, and pools are catalog-driven
-- in three places (plan create/edit selects + proxy registration), so the row
-- must durably exist. sortOrder 0 keeps it first in every pool dropdown.
-- Idempotent — re-running or racing an existing row is a no-op.
INSERT INTO "catalog_items" ("kind", "value", "sortOrder", "enabled")
VALUES ('POOL', 'Default Pool', 0, true)
ON CONFLICT ("kind", "value") DO NOTHING;
