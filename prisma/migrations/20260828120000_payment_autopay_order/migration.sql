-- Split payment (owner decision 2026-08-27, approach B): a crypto TOPUP deposit
-- can carry the id of an order it should AUTO-PAY from balance once it settles.
-- The client pays part of the order from their balance and tops up the
-- shortfall via crypto (min $10); when the top-up confirms, the linked order is
-- paid from the now-sufficient balance (new purchase → activate/provision;
-- renewal → extend). Set only on TOPUP rows (orderId NULL); NULL everywhere else.
-- Additive: one nullable column, no backfill, safe for `prisma migrate deploy`.

ALTER TABLE "payments" ADD COLUMN "autoPayOrderId" TEXT;
