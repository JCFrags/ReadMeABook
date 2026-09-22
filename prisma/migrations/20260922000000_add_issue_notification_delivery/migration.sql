-- Additive Pi-Notify delivery receipts. Existing reports remain unchanged.
ALTER TABLE "notification_backends" ADD COLUMN "issue_events_enabled_at" TIMESTAMP(3);

CREATE TABLE "issue_notification_deliveries" (
    "id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "backend_id" TEXT NOT NULL,
    "event" JSONB NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "issue_notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "issue_notification_deliveries_issue_id_backend_id_key"
    ON "issue_notification_deliveries"("issue_id", "backend_id");
CREATE INDEX "issue_notification_deliveries_backend_id_accepted_at_next_a_idx"
    ON "issue_notification_deliveries"("backend_id", "accepted_at", "next_attempt_at");
ALTER TABLE "issue_notification_deliveries"
    ADD CONSTRAINT "issue_notification_deliveries_issue_id_fkey"
    FOREIGN KEY ("issue_id") REFERENCES "reported_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "issue_notification_deliveries"
    ADD CONSTRAINT "issue_notification_deliveries_backend_id_fkey"
    FOREIGN KEY ("backend_id") REFERENCES "notification_backends"("id") ON DELETE CASCADE ON UPDATE CASCADE;
