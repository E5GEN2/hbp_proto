-- A proxy can be bound to at most one open assignment at a time
-- (LIFECYCLE_CONTRACT "Must-resolve": partial unique index WHERE released_at IS NULL).
CREATE UNIQUE INDEX "assignments_proxyId_active_key" ON "assignments"("proxyId") WHERE "releasedAt" IS NULL;
