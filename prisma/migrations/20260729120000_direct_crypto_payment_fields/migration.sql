-- In-portal crypto payments (owner ask 2026-07-29): NOWPayments direct
-- payments (POST /v1/payment) replace the hosted-invoice redirect. The client
-- now pays on OUR page, so the Payment row must carry everything that page
-- shows: the coin, the exact crypto amount, the deposit address (+ memo/tag
-- for chains that need one, e.g. TON), and the fixed-rate window expiry.
-- npStatus mirrors the latest IPN payment_status (waiting / confirming /
-- confirmed / sending / partially_paid / finished / failed / expired) purely
-- for client-side progress display — settlement still flips `status` alone.
-- All columns are nullable: legacy hosted-invoice payments and non-crypto
-- payments simply leave them NULL.
ALTER TABLE "payments" ADD COLUMN "payCurrency" TEXT;
ALTER TABLE "payments" ADD COLUMN "payAmount" DECIMAL(30,12);
ALTER TABLE "payments" ADD COLUMN "payAddress" TEXT;
ALTER TABLE "payments" ADD COLUMN "payinExtraId" TEXT;
ALTER TABLE "payments" ADD COLUMN "payExpiresAt" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN "npStatus" TEXT;
