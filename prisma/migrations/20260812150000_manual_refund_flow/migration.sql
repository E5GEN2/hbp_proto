-- Manual-refund flow (owner decision 2026-08-12): refunds are two-step and the
-- money is returned by an admin OUTSIDE the portal — no balance credit.
--   initiate: status → REFUND_IN_PROGRESS + refundReason
--   complete: status → REFUNDED + refundProof (+ refundedAt)
-- Additive only: new enum value + two nullable columns. Safe for
-- `prisma migrate deploy` on live data (PG12+ allows ADD VALUE in a
-- transaction as long as the new value isn't USED in the same transaction —
-- and nothing below uses it).

ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REFUND_IN_PROGRESS';

ALTER TABLE "payments" ADD COLUMN "refundReason" TEXT;
ALTER TABLE "payments" ADD COLUMN "refundProof" TEXT;
