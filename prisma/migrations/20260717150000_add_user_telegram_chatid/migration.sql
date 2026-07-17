-- Numeric Telegram chat id, populated when a client links their account via the
-- bot (Start). Delivery target for incident alerts; @handle alone can't receive.
ALTER TABLE "users" ADD COLUMN "telegramChatId" TEXT;
