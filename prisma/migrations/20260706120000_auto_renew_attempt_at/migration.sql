-- Auto-renew execution (Phase 3): the sweep records charge attempts here to
-- pace retries (once per 24h inside the grace window).
ALTER TABLE "orders" ADD COLUMN "autoRenewLastAttemptAt" TIMESTAMP(3);
