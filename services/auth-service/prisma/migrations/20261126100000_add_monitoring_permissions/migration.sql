-- Data-only: the monitoring-service permissions existed only in prisma/seed.js,
-- and production applies migrations on boot but is not re-seeded, so a database
-- seeded before them had no monitoring permissions at all. ADMIN gets them, as
-- in the seed. Idempotent; on an empty database (before the seed) only the
-- permission rows are created.
INSERT INTO "permissions" ("code", "module_name", "action_name", "description")
VALUES
  ('monitoring.incidents.read', 'monitoring', 'read', 'View incidents, alert activity and monitoring analytics'),
  ('monitoring.incidents.manage', 'monitoring', 'write', 'Acknowledge, resolve and annotate incidents'),
  ('monitoring.settings.manage', 'monitoring', 'write', 'Configure alert notification channels and routing policies')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('monitoring.incidents.read', 'monitoring.incidents.manage', 'monitoring.settings.manage')
WHERE r."code" = 'ADMIN'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
