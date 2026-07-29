-- One AWAITING payment per order — the durable invariant behind the in-portal
-- crypto flow (review find, 2026-07-29). The application-level guards (repay's
-- pre-check, handleRenewal's pending-check) run under READ COMMITTED where a
-- concurrent uncommitted insert is invisible, so two overlapping requests can
-- both pass and stack live charges for one order. A partial unique index
-- catches the loser at commit regardless of which code path inserted the row.
-- orderId IS NOT NULL keeps concurrent deposits (orderId NULL) legal.

-- Pre-clean: keep only the newest AWAITING row per order (createdAt, id as
-- tiebreak) so the index can build on existing data. Older duplicates — if any
-- exist — are dead fixed-rate charges; FAILED matches what the expired-IPN
-- would have set.
UPDATE "payments" p SET "status" = 'FAILED'
WHERE p."status" = 'AWAITING' AND p."orderId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "payments" q
    WHERE q."orderId" = p."orderId" AND q."status" = 'AWAITING'
      AND (q."createdAt" > p."createdAt" OR (q."createdAt" = p."createdAt" AND q."id" > p."id"))
  );

CREATE UNIQUE INDEX "payments_one_awaiting_per_order"
  ON "payments"("orderId")
  WHERE "status" = 'AWAITING' AND "orderId" IS NOT NULL;
