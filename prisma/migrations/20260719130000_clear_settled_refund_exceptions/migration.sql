-- Phase B finding B-4: refundPayment used to RE-TAG orders REFUND_PENDING after
-- issuing the refund, so «refund review pending» counted settled refunds
-- forever. Clear the exception on orders whose refund is fully settled (every
-- payment refunded — nothing left to review).
UPDATE "orders" o
SET "exception" = NULL, "excInfo" = NULL
WHERE o."exception" = 'REFUND_PENDING'
  AND EXISTS (SELECT 1 FROM "payments" p WHERE p."orderId" = o."id" AND p."status" = 'REFUNDED')
  AND NOT EXISTS (
    SELECT 1 FROM "payments" p
    WHERE p."orderId" = o."id"
      AND p."status" IN ('CONFIRMED', 'PAID', 'REFUND_REQUESTED', 'AWAITING', 'PENDING', 'MANUAL_REVIEW')
  );
