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

-- Snapshot on the CHARGE of whether the per-order renewal discount priced it.
-- The cycle is consumed at settle ONLY when this is true — a discount granted
-- while a full-price crypto charge was in flight must not be eaten by that
-- charge's settle, and a discounted charge's settle must consume even if the
-- fields changed meanwhile (adversarial review R1).
ALTER TABLE "payments" ADD COLUMN "renewalDiscountApplied" BOOLEAN;

-- Backfill (R3): the AWAITING-scoped renewal guards key on this stamp being
-- non-null for renewal-originated charges. Live pre-deploy renewal charges
-- (AWAITING crypto renewals in their ≤72h window, or parked MANUAL_REVIEW)
-- would otherwise be invisible to the one-click-renew guard until they die.
-- Renewal-shaped = order charge on a non-NEW order created well after the
-- order itself (purchase charges are created in the same tx as the order).
UPDATE "payments" p SET "renewalDiscountApplied" = false
FROM "orders" o
WHERE p."orderId" = o.id
  AND p.status IN ('AWAITING', 'MANUAL_REVIEW')
  AND o.status <> 'NEW'
  AND p."createdAt" > o."createdAt" + interval '5 minutes';
