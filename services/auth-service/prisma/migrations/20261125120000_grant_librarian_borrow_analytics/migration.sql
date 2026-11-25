-- Data-only: borrow-domain analytics (overdue, fines, reservations, reader risk)
-- for librarians, so one account holding WAREHOUSE_MANAGER + LIBRARIAN manages
-- both domains. Every analytics route behind analytics.borrow.read is branch-
-- scoped (user_warehouse_scopes). Production applies migrations on boot but is
-- not re-seeded, hence a migration; prisma/seed.js grants the same.
-- Idempotent; on an empty database (before the seed) only the permission row
-- is created.
INSERT INTO "permissions" ("code", "module_name", "action_name", "description")
VALUES ('analytics.borrow.read', 'analytics', 'read', 'View borrow-domain analytics (fines, overdue, reservations)')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" = 'analytics.borrow.read'
WHERE r."code" IN ('ADMIN', 'LIBRARIAN')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
