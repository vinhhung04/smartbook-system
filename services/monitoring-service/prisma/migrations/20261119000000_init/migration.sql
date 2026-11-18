-- CreateTable
CREATE TABLE "system_incidents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fingerprint" VARCHAR(128) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "rule_uid" VARCHAR(100),
    "title" VARCHAR(200) NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "severity" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "service_name" VARCHAR(80) NOT NULL,
    "alert_kind" VARCHAR(40),
    "summary" TEXT,
    "description" TEXT,
    "runbook_url" VARCHAR(500),
    "labels" JSONB NOT NULL DEFAULT '{}',
    "source_started_at" TIMESTAMPTZ(6),
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "last_notified_at" TIMESTAMPTZ(6),
    "acknowledged_at" TIMESTAMPTZ(6),
    "acknowledged_by" VARCHAR(64),
    "acknowledged_by_name" VARCHAR(150),
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" VARCHAR(64),
    "resolved_by_name" VARCHAR(150),
    "resolution_type" VARCHAR(20),
    "resolution_note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_incident_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "incident_id" UUID NOT NULL,
    "event_type" VARCHAR(40) NOT NULL,
    "actor_id" VARCHAR(64),
    "actor_name" VARCHAR(150),
    "message" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_incident_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "match_rule_uid" VARCHAR(100),
    "match_category" VARCHAR(20),
    "match_severity" VARCHAR(20),
    "email_enabled" BOOLEAN NOT NULL DEFAULT false,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "webhook_enabled" BOOLEAN NOT NULL DEFAULT false,
    "notify_on_resolve" BOOLEAN NOT NULL DEFAULT true,
    "cooldown_minutes" INTEGER NOT NULL DEFAULT 30,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_channel_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "channel_type" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secret_ciphertext" TEXT,
    "secret_hint" VARCHAR(80),
    "max_attempts" INTEGER NOT NULL DEFAULT 6,
    "last_test_at" TIMESTAMPTZ(6),
    "last_test_status" VARCHAR(20),
    "last_test_error" VARCHAR(300),
    "updated_by" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_channel_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "incident_id" UUID,
    "event_id" UUID,
    "channel_config_id" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 6,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(6),
    "last_error" VARCHAR(300),
    "last_status_code" INTEGER,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_delivery_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delivery_id" UUID NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "outcome" VARCHAR(20) NOT NULL,
    "status_code" INTEGER,
    "error_code" VARCHAR(300),
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "incident_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "severity" VARCHAR(20) NOT NULL,
    "title" VARCHAR(250) NOT NULL,
    "body" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_notification_reads" (
    "notification_id" UUID NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "read_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_notification_reads_pkey" PRIMARY KEY ("notification_id","user_id")
);

-- CreateTable
CREATE TABLE "monitoring_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" VARCHAR(64),
    "actor_name" VARCHAR(150),
    "action" VARCHAR(60) NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" VARCHAR(64),
    "changes" JSONB NOT NULL DEFAULT '{}',
    "request_id" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitoring_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_system_incidents_status_severity" ON "system_incidents"("status", "severity");

-- CreateIndex
CREATE INDEX "idx_system_incidents_service_seen" ON "system_incidents"("service_name", "first_seen_at");

-- CreateIndex
CREATE INDEX "idx_system_incidents_fingerprint_resolved" ON "system_incidents"("fingerprint", "resolved_at");

-- CreateIndex
CREATE INDEX "idx_system_incidents_first_seen" ON "system_incidents"("first_seen_at");

-- CreateIndex
CREATE INDEX "idx_system_incident_events_incident" ON "system_incident_events"("incident_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_alert_deliveries_due" ON "alert_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "idx_alert_deliveries_incident" ON "alert_deliveries"("incident_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_alert_deliveries_event_channel" ON "alert_deliveries"("event_id", "channel_config_id");

-- CreateIndex
CREATE INDEX "idx_alert_delivery_attempts_delivery" ON "alert_delivery_attempts"("delivery_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_system_notifications_event" ON "system_notifications"("event_id");

-- CreateIndex
CREATE INDEX "idx_system_notifications_created" ON "system_notifications"("created_at");

-- CreateIndex
CREATE INDEX "idx_system_notification_reads_user" ON "system_notification_reads"("user_id");

-- CreateIndex
CREATE INDEX "idx_monitoring_audit_logs_entity" ON "monitoring_audit_logs"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "system_incident_events" ADD CONSTRAINT "system_incident_events_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "system_incidents"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "system_incidents"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "system_incident_events"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_channel_config_id_fkey" FOREIGN KEY ("channel_config_id") REFERENCES "alert_channel_configs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "alert_delivery_attempts" ADD CONSTRAINT "alert_delivery_attempts_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "alert_deliveries"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "system_notifications" ADD CONSTRAINT "system_notifications_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "system_incidents"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "system_notification_reads" ADD CONSTRAINT "system_notification_reads_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "system_notifications"("id") ON DELETE CASCADE ON UPDATE NO ACTION;


-- SQL-only protections (not expressible in Prisma 5.21).
-- At most one unresolved incident per fingerprint: a re-sent Grafana webhook can
-- never create a second open incident, even under concurrent deliveries.
CREATE UNIQUE INDEX "uq_system_incidents_open_fingerprint" ON "system_incidents"("fingerprint") WHERE "status" <> 'RESOLVED';

ALTER TABLE "system_incidents"
  ADD CONSTRAINT "ck_system_incidents_status" CHECK ("status" IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  ADD CONSTRAINT "ck_system_incidents_severity" CHECK ("severity" IN ('CRITICAL', 'HIGH', 'WARNING', 'INFO')),
  ADD CONSTRAINT "ck_system_incidents_category" CHECK ("category" IN ('TECHNICAL', 'BUSINESS', 'INFO')),
  ADD CONSTRAINT "ck_system_incidents_occurrences" CHECK ("occurrence_count" >= 1);
ALTER TABLE "alert_deliveries"
  ADD CONSTRAINT "ck_alert_deliveries_status" CHECK ("status" IN ('PENDING', 'SENDING', 'RETRY', 'SENT', 'DEAD', 'SUPPRESSED')),
  ADD CONSTRAINT "ck_alert_deliveries_channel" CHECK ("channel" IN ('EMAIL', 'IN_APP', 'WEBHOOK'));
ALTER TABLE "alert_channel_configs"
  ADD CONSTRAINT "ck_alert_channel_configs_type" CHECK ("channel_type" IN ('EMAIL', 'IN_APP', 'WEBHOOK')),
  ADD CONSTRAINT "ck_alert_channel_configs_attempts" CHECK ("max_attempts" BETWEEN 1 AND 12);
ALTER TABLE "alert_policies"
  ADD CONSTRAINT "ck_alert_policies_cooldown" CHECK ("cooldown_minutes" BETWEEN 0 AND 1440);

-- Default routing (configuration data, editable by an administrator).
-- Business alerts are not system failures: they go in-app only by default.
INSERT INTO "alert_policies" ("name", "description", "match_category", "match_severity", "email_enabled", "in_app_enabled", "webhook_enabled", "notify_on_resolve", "cooldown_minutes", "is_default") VALUES
  ('Sự cố kỹ thuật nghiêm trọng', 'Dịch vụ ngừng, mất cơ sở dữ liệu, mất metrics', 'TECHNICAL', 'CRITICAL', true, true, true, true, 15, true),
  ('Sự cố kỹ thuật mức cao', 'Ảnh hưởng đáng kể đến nghiệp vụ', 'TECHNICAL', 'HIGH', true, true, true, true, 30, true),
  ('Cảnh báo kỹ thuật', 'Suy giảm hoặc bất thường cần theo dõi', 'TECHNICAL', 'WARNING', true, true, false, true, 60, true),
  ('Cảnh báo nghiệp vụ nghiêm trọng', 'Tiền thanh toán chờ xử lý, đối soát kẹt', 'BUSINESS', 'CRITICAL', true, true, true, true, 30, true),
  ('Cảnh báo nghiệp vụ', 'Tồn kho thấp, xung đột đặt trước, chi phí AI', 'BUSINESS', NULL, false, true, false, false, 120, true),
  ('Thông tin vận hành', 'Sự kiện thông tin, không phải sự cố', NULL, 'INFO', false, true, false, false, 240, true),
  ('Mặc định', 'Áp dụng khi không có chính sách nào khớp', NULL, NULL, true, true, false, true, 30, true);

INSERT INTO "alert_channel_configs" ("channel_type", "name", "enabled", "config") VALUES
  ('IN_APP', 'Thông báo trong ứng dụng', true, '{}'),
  ('EMAIL', 'Email quản trị', false, '{"recipients": []}');
