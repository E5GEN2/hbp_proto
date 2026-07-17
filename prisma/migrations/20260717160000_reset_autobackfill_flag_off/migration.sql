-- systemAutoProvisionOnPayment was decorative (notWired) and seeded true; it now
-- gates real auto-backfill of under-provisioned orders from the pool. Reset any
-- stale stored value to false so the feature ships OFF (opt-in) as documented —
-- admins enable it explicitly in Settings → Flags. Safe: nothing consulted this
-- key before, so no deliberate operator choice is being overwritten.
UPDATE "system_settings" SET value = 'false'::jsonb WHERE key = 'systemAutoProvisionOnPayment';
