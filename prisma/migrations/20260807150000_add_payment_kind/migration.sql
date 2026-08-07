-- Explicit ORDER | TOPUP discriminator for payments (was inferred from
-- orderId IS NULL). Applied by `prisma migrate deploy` on release.

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('ORDER', 'TOPUP');

-- AlterTable: default ORDER so every existing order payment is correct
ALTER TABLE "payments" ADD COLUMN "kind" "PaymentKind" NOT NULL DEFAULT 'ORDER';

-- Backfill: any payment with no order is a balance top-up
UPDATE "payments" SET "kind" = 'TOPUP' WHERE "orderId" IS NULL;
