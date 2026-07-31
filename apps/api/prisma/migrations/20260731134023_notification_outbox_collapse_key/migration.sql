-- AlterTable
ALTER TABLE "notification_outbox_events" ADD COLUMN     "collapseKey" VARCHAR(255) NOT NULL;

-- CreateIndex
CREATE INDEX "notification_outbox_events_collapse_key_status_idx" ON "notification_outbox_events"("collapseKey", "status");
