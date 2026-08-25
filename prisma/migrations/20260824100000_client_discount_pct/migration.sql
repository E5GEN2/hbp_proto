-- Client-level discount (owner decision 2026-08-22): a special price for one
-- client — integer percent off ALL their orders, new purchases AND renewals.
-- Pricing precedence (renewalPricing / purchaseUnitPrice):
--   · an ACTIVE per-order renewal grant (orders.renewalDiscount*) beats both;
--   · otherwise the LARGER of clientDiscountPct and plan.renewalDiscountPct
--     applies (discounts never stack — owner decision);
--   · new purchases have no plan discount, so clientDiscountPct applies alone.
-- NULL = none; indefinite until an admin clears it (/admin/clients/[id]).
-- Additive only: one nullable column, no backfill. Safe for
-- `prisma migrate deploy` on live data.

ALTER TABLE "users" ADD COLUMN "clientDiscountPct" INTEGER;
