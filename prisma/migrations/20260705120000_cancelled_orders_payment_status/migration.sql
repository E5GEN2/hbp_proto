-- Data repair: orders cancelled before payment kept a live-looking
-- paymentStatus (AWAITING/PENDING) — the snapshot and dashboard feed showed
-- them as still awaiting. Going forward the cancel transitions set this;
-- this backfills orders cancelled before the fix.
UPDATE "orders" SET "paymentStatus" = 'CANCELLED'
WHERE "status" = 'CANCELLED' AND "paymentStatus" IN ('AWAITING', 'PENDING');

-- Same for their payment rows (admin-cancelled unpaid orders never flipped
-- them; client cancels already did) — stale AWAITING rows would otherwise
-- keep a live "Pay now" link in Billing.
UPDATE "payments" SET "status" = 'CANCELLED'
WHERE "status" IN ('AWAITING', 'PENDING')
  AND "orderId" IN (SELECT "id" FROM "orders" WHERE "status" = 'CANCELLED');
