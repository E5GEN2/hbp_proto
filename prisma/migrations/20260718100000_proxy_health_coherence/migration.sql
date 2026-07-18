-- Coherence repair: a proxy in the pool (AVAILABLE) or serving (ASSIGNED) must
-- be HEALTHY. OFFLINE health may only coexist with FAULTY status. Earlier
-- release/return paths left proxies in the impossible AVAILABLE+OFFLINE state
-- (e.g. PXY-00022), which hid them from auto-fill and mislabelled the health
-- widget. Reconcile existing rows; the transitions are fixed to keep the
-- invariant going forward.
UPDATE "proxies" SET "health" = 'HEALTHY'
WHERE "status" = 'AVAILABLE' AND "health" <> 'HEALTHY';
