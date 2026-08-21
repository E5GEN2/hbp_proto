-- Order-level discounts + persisted custom expiry (owner decisions 2026-08-21):
--   · discountAmount — flat $ off the order total at creation (alternative to
--     discountPct; at most one of the two is non-zero).
--   · customExpiresAt — admin-set absolute end date. Persisted at creation and
--     CONSUMED (stamped into expiresAt, then cleared) at first activation, so
--     the expiresAt-null-until-ACTIVE invariant holds while the admin's intent
--     survives PROVISIONING (recreating a paid-then-deleted order with its
--     original end date is the primary use case).
--   · renewalDiscount* — per-order renewal discount granted by the admin.
--     REPLACES the plan's renewalDiscountPct while active (owner decision).
--     value: percent of unit price when isPercent, else $ off the total.
--     cyclesLeft: NULL = indefinite; N = remaining paid renewals; decremented
--     once per successful paid renewal; 0 = exhausted (plan discount resumes).
-- Additive only: five nullable columns, no backfill. Safe for
-- `prisma migrate deploy` on live data.

ALTER TABLE "orders" ADD COLUMN "discountAmount" DECIMAL(10,2);
ALTER TABLE "orders" ADD COLUMN "customExpiresAt" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "renewalDiscountValue" DECIMAL(10,2);
ALTER TABLE "orders" ADD COLUMN "renewalDiscountIsPercent" BOOLEAN;
ALTER TABLE "orders" ADD COLUMN "renewalDiscountCyclesLeft" INTEGER;
