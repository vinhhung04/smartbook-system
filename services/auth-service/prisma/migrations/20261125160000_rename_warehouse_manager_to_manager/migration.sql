-- Data-only: the manager role code is MANAGER (was WAREHOUSE_MANAGER): one manager
-- role for warehouse operations and the library's analytics.
-- Renamed in place when MANAGER does not exist yet, so role id, user_roles and
-- role_permissions are kept. If a MANAGER row already exists (e.g. created by the
-- seed first), its holders and permissions are merged into it and the old row goes.
-- Tokens issued before still carry WAREHOUSE_MANAGER: every service maps it to
-- MANAGER when it reads the token (auth middlewares, web/mobile role maps).
-- Idempotent: nothing to do once WAREHOUSE_MANAGER is gone.
DO $$
DECLARE
  old_id uuid;
  new_id uuid;
BEGIN
  SELECT "id" INTO old_id FROM "roles" WHERE "code" = 'WAREHOUSE_MANAGER';
  IF old_id IS NULL THEN
    RETURN;
  END IF;
  SELECT "id" INTO new_id FROM "roles" WHERE "code" = 'MANAGER';
  IF new_id IS NULL THEN
    UPDATE "roles"
    SET "code" = 'MANAGER', "name" = 'Manager',
        "description" = 'Manage warehouse operations (POs, inventory, staff) and read library analytics',
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = old_id;
  ELSE
    INSERT INTO "user_roles" ("user_id", "role_id", "assigned_by_user_id", "assigned_at", "expires_at")
    SELECT "user_id", new_id, "assigned_by_user_id", "assigned_at", "expires_at" FROM "user_roles" WHERE "role_id" = old_id
    ON CONFLICT ("user_id", "role_id") DO NOTHING;
    INSERT INTO "role_permissions" ("role_id", "permission_id")
    SELECT new_id, "permission_id" FROM "role_permissions" WHERE "role_id" = old_id
    ON CONFLICT ("role_id", "permission_id") DO NOTHING;
    DELETE FROM "roles" WHERE "id" = old_id; -- cascades to its user_roles / role_permissions
  END IF;
END $$;
