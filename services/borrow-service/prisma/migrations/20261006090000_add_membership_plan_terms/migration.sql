-- Membership plans get explicit commercial terms and an explicit default flag.
-- Backward compatible: every column has a default, existing plans keep their
-- limits, existing customer_memberships are untouched.
ALTER TABLE "membership_plans"
    ADD COLUMN "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "duration_days" INTEGER NOT NULL DEFAULT 365,
    ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT false;

-- Backfill the default once, from data instead of from plan names or row order:
-- the active plan most readers already hold (what the old "configured code, else
-- oldest plan" lookup actually handed out), ties broken by plan code. Fresh
-- databases get their default from prisma/seed.js instead (no plans exist yet).
UPDATE "membership_plans"
SET "is_default" = true
WHERE "id" = (
    SELECT p."id"
    FROM "membership_plans" p
    LEFT JOIN "customer_memberships" m ON m."plan_id" = p."id"
    WHERE p."is_active" = true
    GROUP BY p."id", p."code"
    ORDER BY COUNT(m."id") DESC, p."code" ASC
    LIMIT 1
);
