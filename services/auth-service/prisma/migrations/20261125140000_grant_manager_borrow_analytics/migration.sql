-- Data-only: managers read the library's borrow analytics (overdue, fines,
-- reservations, borrow trends, reader risk) without a second role. Read-only:
-- no borrow.* desk permission comes with it. Every analytics route behind
-- analytics.borrow.read is limited to the caller's user_warehouse_scopes.
-- prisma/seed.js grants the same. Idempotent; needs the permission row created
-- by 20261125120000_grant_librarian_borrow_analytics.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" = 'analytics.borrow.read'
WHERE r."code" = 'WAREHOUSE_MANAGER'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
