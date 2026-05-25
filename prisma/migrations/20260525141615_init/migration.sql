-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CLIENT', 'ADMIN_SUPER', 'ADMIN_OPS', 'ADMIN_SUPPORT');

-- CreateEnum
CREATE TYPE "UserTier" AS ENUM ('STANDARD', 'PRO', 'VIP');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'CHURNED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('NONE', 'REVIEW', 'FLAG');

-- CreateEnum
CREATE TYPE "PlanVisibility" AS ENUM ('PUBLIC', 'INTERNAL');

-- CreateEnum
CREATE TYPE "CapacityState" AS ENUM ('LOW', 'SOLD_OUT', 'BLOCKED_GRACE', 'WAITING_RELEASE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'AWAITING', 'PROVISIONING', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'CANCELLED', 'PENDING_RENEWAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AWAITING', 'CONFIRMED', 'PAID', 'FREE', 'FAILED', 'REFUNDED', 'REFUND_REQUESTED', 'CANCELLED', 'REPLACEMENT', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "OrderException" AS ENUM ('PAID_NOT_PROVISIONED', 'RENEWAL_NOT_EXTENDED', 'RENEWAL_FAULTY_PROXY', 'REPLACEMENT_PENDING', 'REFUND_PENDING');

-- CreateEnum
CREATE TYPE "CredentialsChannel" AS ENUM ('EMAIL', 'TELEGRAM', 'BOTH');

-- CreateEnum
CREATE TYPE "RenewalBucket" AS ENUM ('H24', 'D3', 'D7', 'GRACE', 'EXPIRED', 'RENEWED');

-- CreateEnum
CREATE TYPE "ProxyStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'PROVISIONING', 'RELEASED', 'FAULTY', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ProxyHealth" AS ENUM ('HEALTHY', 'DEGRADED', 'OFFLINE');

-- CreateEnum
CREATE TYPE "AssignmentReason" AS ENUM ('CANCEL', 'ORDER_EXPIRED', 'QTY_DOWN_ON_RENEWAL', 'RENEWAL_CARRYOVER', 'MIGRATED', 'PRE_BIND_PENDING_RENEWAL', 'RENEWAL_CANCELLED_BY_OPERATOR', 'REPLACEMENT');

-- CreateEnum
CREATE TYPE "PaymentMethodKind" AS ENUM ('BALANCE', 'CARD', 'CRYPTO');

-- CreateEnum
CREATE TYPE "LedgerOp" AS ENUM ('TOPUP', 'ORDER_DEBIT', 'REFUND_CREDIT', 'MANUAL_ADJUST');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'DANGER');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "NotificationTrigger" AS ENUM ('EXPIRING_3D', 'EXPIRING_24H', 'AWAITING', 'GRACE', 'REPLACEMENT_PENDING', 'ORDER_CREATED', 'PAYMENT_CONFIRMED', 'PROXY_ASSIGNED', 'REFUND_ISSUED', 'ORDER_EXPIRED_FINAL', 'REPLACEMENT_COMPLETED', 'ADMIN_NEW_ORDER', 'ADMIN_PAYMENT_FAILED', 'ADMIN_PROXY_FAULTY', 'ADMIN_QUOTA_85', 'ADMIN_CHARGEBACK', 'ADMIN_REFUND_REQUEST');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'PENDING', 'ANSWERED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('GENERAL', 'ORDER', 'PROXY', 'PAYMENT', 'REFUND', 'OTHER');

-- CreateEnum
CREATE TYPE "NoteObjectType" AS ENUM ('ORDER', 'PAYMENT', 'PROXY', 'CLIENT', 'PLAN');

-- CreateEnum
CREATE TYPE "LogObjectType" AS ENUM ('ORDER', 'PAYMENT', 'PROXY', 'CLIENT', 'PLAN', 'AUTH', 'SYSTEM', 'ASSIGNMENT', 'TICKET');

-- CreateEnum
CREATE TYPE "CatalogKind" AS ENUM ('CARRIER', 'REGION', 'POOL', 'PROTOCOL', 'ROTATION', 'TRAFFIC', 'DURATION', 'VISIBILITY', 'CURRENCY');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'CLIENT',
    "telegram" TEXT,
    "country" TEXT,
    "tier" "UserTier" NOT NULL DEFAULT 'STANDARD',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "risk" "RiskLevel" NOT NULL DEFAULT 'NONE',
    "riskNote" TEXT,
    "preferredCarrier" TEXT,
    "preferredRegion" TEXT,
    "acquisition" TEXT,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "emailRenewal" BOOLEAN NOT NULL DEFAULT true,
    "emailIncidents" BOOLEAN NOT NULL DEFAULT true,
    "emailMarketing" BOOLEAN NOT NULL DEFAULT false,
    "telegramAll" BOOLEAN NOT NULL DEFAULT true,
    "preRenewalReminderHours" INTEGER NOT NULL DEFAULT 72,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "twoFactorRecoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "initials" TEXT,
    "ipAddress" TEXT,
    "avatarColor" TEXT,
    "blockedAt" TIMESTAMP(3),
    "blockedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "notifLastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "internalSku" TEXT,
    "description" TEXT,
    "visibility" "PlanVisibility" NOT NULL DEFAULT 'PUBLIC',
    "carrier" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "pool" TEXT NOT NULL,
    "poolOverride" BOOLEAN NOT NULL DEFAULT false,
    "durationDays" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "protocols" TEXT,
    "rotation" TEXT,
    "traffic" TEXT,
    "availableQuota" INTEGER NOT NULL,
    "capacityState" "CapacityState",
    "lowCapacityThresholdPct" INTEGER,
    "renewalDiscountPct" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "autoProvision" BOOLEAN NOT NULL DEFAULT true,
    "autoRenewDefault" BOOLEAN NOT NULL DEFAULT true,
    "renewalAllowed" BOOLEAN NOT NULL DEFAULT true,
    "preRenewalReminderHours" INTEGER NOT NULL DEFAULT 72,
    "gracePeriodHours" INTEGER NOT NULL DEFAULT 48,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "discountPct" INTEGER NOT NULL DEFAULT 0,
    "region" TEXT NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "autoProvision" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT,
    "ref" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "exception" "OrderException",
    "excInfo" TEXT,
    "replacesOrderId" TEXT,
    "renewalGraceUntil" TIMESTAMP(3),
    "renewalCarryoverProxyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "renewalAddProxyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "renewalBucket" "RenewalBucket",
    "lastReminderAt" TIMESTAMP(3),
    "credentialsSentAt" TIMESTAMP(3),
    "credentialsChannel" "CredentialsChannel",
    "manualProvisioning" BOOLEAN NOT NULL DEFAULT false,
    "manualFulfillmentOverride" BOOLEAN NOT NULL DEFAULT false,
    "manualFulfillmentOverridePayState" TEXT,
    "autoRenewBeforeSuspend" BOOLEAN,
    "credentialsBeforeSuspend" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "clientId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "gross" DECIMAL(10,2) NOT NULL,
    "fees" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(10,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "refundedAmount" DECIMAL(10,2),
    "externalRef" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "orderId" TEXT,
    "clientId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proxies" (
    "id" TEXT NOT NULL,
    "modem" TEXT NOT NULL,
    "imei" TEXT,
    "carrier" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "city" TEXT,
    "pool" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "rotateToken" TEXT,
    "status" "ProxyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "health" "ProxyHealth" NOT NULL DEFAULT 'HEALTHY',
    "uptime" DOUBLE PRECISION NOT NULL DEFAULT 99,
    "speedMbps" INTEGER NOT NULL DEFAULT 50,
    "latency" INTEGER,
    "trafficUsedMB" INTEGER NOT NULL DEFAULT 0,
    "trafficLimitMB" INTEGER NOT NULL DEFAULT 0,
    "autoRotateMin" INTEGER NOT NULL DEFAULT 0,
    "lastRotated" TIMESTAMP(3),
    "label" TEXT,
    "currentOrderId" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "securityResetAt" TIMESTAMP(3),
    "passwordRotatedAt" TIMESTAMP(3),
    "ipRotatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proxies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "proxyId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "reason" "AssignmentReason",
    "reasonDetail" TEXT,
    "actorId" TEXT NOT NULL,
    "suspendedAt" TIMESTAMP(3),

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proxy_whitelist" (
    "id" SERIAL NOT NULL,
    "proxyId" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedBy" TEXT NOT NULL,

    CONSTRAINT "proxy_whitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "PaymentMethodKind" NOT NULL,
    "brand" TEXT NOT NULL,
    "last4" TEXT,
    "exp" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_ledger" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "op" "LedgerOp" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "refOrderId" TEXT,
    "refPaymentId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL DEFAULT 'INFO',
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "trigger" "NotificationTrigger" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provisioning_rules" (
    "id" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "defaultPool" TEXT NOT NULL,
    "fallbackPools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "autoAssign" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provisioning_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" "TicketCategory" NOT NULL DEFAULT 'GENERAL',
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "refOrderId" TEXT,
    "refProxyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_replies" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "isStaff" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_notes" (
    "id" TEXT NOT NULL,
    "objectType" "NoteObjectType" NOT NULL,
    "objectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logs" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "objectType" "LogObjectType" NOT NULL,
    "objectId" TEXT,
    "detail" TEXT,

    CONSTRAINT "logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "catalog_items" (
    "id" SERIAL NOT NULL,
    "kind" "CatalogKind" NOT NULL,
    "value" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyMasked" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "events" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastDeliveryAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_drafts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT,
    "planId" TEXT,
    "duration" INTEGER,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "autoExtend" BOOLEAN NOT NULL DEFAULT true,
    "location" TEXT,
    "paymentMethod" TEXT,
    "step" TEXT NOT NULL DEFAULT 'details',
    "depositAmount" DECIMAL(10,2),
    "draftOrderId" TEXT,
    "draftPaymentId" TEXT,
    "resumeFromOrderId" TEXT,
    "returnTo" TEXT,
    "ref" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "plans_internalSku_key" ON "plans"("internalSku");

-- CreateIndex
CREATE INDEX "plans_active_deletedAt_idx" ON "plans"("active", "deletedAt");

-- CreateIndex
CREATE INDEX "plans_carrier_region_idx" ON "plans"("carrier", "region");

-- CreateIndex
CREATE UNIQUE INDEX "orders_replacesOrderId_key" ON "orders"("replacesOrderId");

-- CreateIndex
CREATE INDEX "orders_clientId_idx" ON "orders"("clientId");

-- CreateIndex
CREATE INDEX "orders_planId_idx" ON "orders"("planId");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_expiresAt_idx" ON "orders"("expiresAt");

-- CreateIndex
CREATE INDEX "orders_exception_idx" ON "orders"("exception");

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");

-- CreateIndex
CREATE INDEX "payments_clientId_idx" ON "payments"("clientId");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_paymentId_key" ON "invoices"("paymentId");

-- CreateIndex
CREATE INDEX "invoices_clientId_idx" ON "invoices"("clientId");

-- CreateIndex
CREATE INDEX "proxies_status_idx" ON "proxies"("status");

-- CreateIndex
CREATE INDEX "proxies_health_idx" ON "proxies"("health");

-- CreateIndex
CREATE INDEX "proxies_currentOrderId_idx" ON "proxies"("currentOrderId");

-- CreateIndex
CREATE INDEX "proxies_carrier_region_idx" ON "proxies"("carrier", "region");

-- CreateIndex
CREATE INDEX "assignments_orderId_idx" ON "assignments"("orderId");

-- CreateIndex
CREATE INDEX "assignments_proxyId_idx" ON "assignments"("proxyId");

-- CreateIndex
CREATE INDEX "assignments_releasedAt_idx" ON "assignments"("releasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "proxy_whitelist_proxyId_ip_key" ON "proxy_whitelist"("proxyId", "ip");

-- CreateIndex
CREATE INDEX "payment_methods_userId_idx" ON "payment_methods"("userId");

-- CreateIndex
CREATE INDEX "balance_ledger_userId_idx" ON "balance_ledger"("userId");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_channel_trigger_key" ON "notification_templates"("channel", "trigger");

-- CreateIndex
CREATE UNIQUE INDEX "provisioning_rules_carrier_region_key" ON "provisioning_rules"("carrier", "region");

-- CreateIndex
CREATE INDEX "tickets_clientId_idx" ON "tickets"("clientId");

-- CreateIndex
CREATE INDEX "tickets_status_idx" ON "tickets"("status");

-- CreateIndex
CREATE INDEX "ticket_replies_ticketId_idx" ON "ticket_replies"("ticketId");

-- CreateIndex
CREATE INDEX "entity_notes_objectType_objectId_idx" ON "entity_notes"("objectType", "objectId");

-- CreateIndex
CREATE INDEX "logs_objectType_objectId_idx" ON "logs"("objectType", "objectId");

-- CreateIndex
CREATE INDEX "logs_at_idx" ON "logs"("at");

-- CreateIndex
CREATE INDEX "logs_action_idx" ON "logs"("action");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_kind_value_key" ON "catalog_items"("kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_drafts_userId_key" ON "checkout_drafts"("userId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_replacesOrderId_fkey" FOREIGN KEY ("replacesOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "proxies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proxy_whitelist" ADD CONSTRAINT "proxy_whitelist_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "proxies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proxy_whitelist" ADD CONSTRAINT "proxy_whitelist_addedBy_fkey" FOREIGN KEY ("addedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_ledger" ADD CONSTRAINT "balance_ledger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_replies" ADD CONSTRAINT "ticket_replies_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_replies" ADD CONSTRAINT "ticket_replies_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_notes" ADD CONSTRAINT "entity_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logs" ADD CONSTRAINT "logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_drafts" ADD CONSTRAINT "checkout_drafts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

