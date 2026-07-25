-- Email verification at signup (owner revision 2026-07-22, items 2-3): a new
-- client must prove email ownership (6-digit code OR magic link) before the
-- portal opens. users.emailVerifiedAt NULL = unverified (gated to /verify).
-- Every account existing at deploy time is verified by fiat — the 4 seed
-- admins use undeliverable @hbp.local addresses and demo/jordan/yuki are
-- @example.com: gating them would lock them out permanently.
ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
UPDATE "users" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;

-- One row = one challenge carrying BOTH the hashed 6-digit code and the
-- hashed magic-link token (issued together, invalidated together). Raw
-- values travel only in the email — same SHA-256 discipline as
-- password_reset_tokens. "attempts" caps code brute-force in the DB
-- (in-memory rate buckets reset on redeploy; 6 digits is only ~20 bits).
CREATE TABLE "email_verification_tokens" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_verification_tokens_tokenHash_key" ON "email_verification_tokens"("tokenHash");
CREATE INDEX "email_verification_tokens_userId_idx" ON "email_verification_tokens"("userId");

ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
