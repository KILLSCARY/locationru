CREATE TABLE "admin_audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "adminId" UUID NOT NULL, "action" VARCHAR(64) NOT NULL,
  "targetType" VARCHAR(64) NOT NULL, "targetId" UUID NOT NULL, "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_audit_logs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "admin_audit_logs_admin_created_at_idx" ON "admin_audit_logs"("adminId", "createdAt");
CREATE INDEX "admin_audit_logs_target_created_at_idx" ON "admin_audit_logs"("targetType", "targetId", "createdAt");
