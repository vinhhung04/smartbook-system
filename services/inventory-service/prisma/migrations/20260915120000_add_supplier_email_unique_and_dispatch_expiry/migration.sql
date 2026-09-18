-- Security fix: findAuthenticatedSupplier() in supplier-portal.controller.js resolves the
-- logged-in supplier account by `suppliers.findFirst({ email })` with no tiebreaker. Without
-- a unique constraint, two supplier rows sharing an email (a data-entry duplicate) would bind
-- unpredictably to whichever row Postgres returns first, exposing one supplier's orders /
-- invoices / shortage reports to the other supplier's account.
--
-- NOTE: if this fails with a unique-violation error, it means duplicate non-null supplier
-- emails already exist. Resolve them first, e.g.:
--   SELECT email, array_agg(id) FROM suppliers WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1;
-- then update/null out the duplicates before re-running this migration.
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_email_key" UNIQUE ("email");

-- Security fix: the supplier-portal magic link (public, unauthenticated except for the token
-- itself) never expired, so a leaked link (forwarded email, browser history, proxy access log)
-- stayed usable indefinitely. expires_at is set on dispatch (see purchase-order.controller.js
-- sendToSupplier) and enforced by getPortalTokenWhere() in supplier-portal.controller.js.
ALTER TABLE "supplier_order_dispatches" ADD COLUMN "expires_at" TIMESTAMPTZ(6);
