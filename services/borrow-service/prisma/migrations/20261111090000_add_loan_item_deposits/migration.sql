-- Per-book deposits held in the customer wallet while a book is on loan.
--
-- Backward compatible: every new column has a default, deposit_per_item = 0 keeps
-- every existing plan deposit-free, existing loans have no deposit rows, and no
-- existing row is rewritten. Money only ever moves through account_ledger.
--
-- Rollback (manual; Prisma has no down migrations). Only safe while no deposit
-- has been held, otherwise held_balance would be orphaned:
--   DROP TRIGGER IF EXISTS loan_item_deposits_settled_immutable ON "loan_item_deposits";
--   DROP TRIGGER IF EXISTS account_ledger_append_only ON "account_ledger";
--   DROP FUNCTION IF EXISTS smartbook_guard_loan_item_deposit();
--   DROP FUNCTION IF EXISTS smartbook_reject_ledger_mutation();
--   DROP TABLE IF EXISTS "loan_item_deposits";
--   ALTER TABLE "account_ledger" DROP COLUMN IF EXISTS "entry_seq";
--   ALTER TABLE "membership_plans" DROP COLUMN IF EXISTS "deposit_per_item";
--   (fine_payment_intents.vnp_response_code can stay VARCHAR(20).)
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261111090000_add_loan_item_deposits';

-- 1. Deposit policy: a fixed amount per borrowed book, configured per membership plan.
ALTER TABLE "membership_plans"
    ADD COLUMN "deposit_per_item" DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD CONSTRAINT "membership_plans_deposit_per_item_check" CHECK ("deposit_per_item" >= 0);

-- 2. Strict ordering of ledger entries for reconciliation. Several entries can be
--    written in one transaction and then share created_at (now() is the
--    transaction timestamp), so created_at alone cannot order them. Existing rows
--    are numbered in table order when the column is added.
ALTER TABLE "account_ledger" ADD COLUMN "entry_seq" SERIAL NOT NULL;
CREATE UNIQUE INDEX "uq_account_ledger_entry_seq" ON "account_ledger"("entry_seq");

-- 3. One deposit per loan item.
CREATE TABLE "loan_item_deposits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "loan_item_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "inventory_unit_id" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "captured_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "refunded_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'HELD',
    "return_condition" VARCHAR(20),
    "settlement_reason" TEXT,
    "held_by_user_id" UUID,
    "settled_by_user_id" UUID,
    "held_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_item_deposits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "loan_item_deposits_amount_check" CHECK ("amount" > 0 AND "captured_amount" >= 0 AND "refunded_amount" >= 0),
    CONSTRAINT "loan_item_deposits_status_check" CHECK ("status" IN ('HELD', 'RELEASED', 'PARTIALLY_REFUNDED', 'CAPTURED')),
    -- HELD: nothing taken or returned yet. Any settled state: every dong accounted for.
    CONSTRAINT "loan_item_deposits_settlement_check" CHECK (
        ("status" = 'HELD' AND "captured_amount" = 0 AND "refunded_amount" = 0 AND "settled_at" IS NULL)
        OR ("status" <> 'HELD' AND "captured_amount" + "refunded_amount" = "amount" AND "settled_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "uq_loan_item_deposits_loan_item" ON "loan_item_deposits"("loan_item_id");
CREATE INDEX "idx_loan_item_deposits_customer_status" ON "loan_item_deposits"("customer_id", "status");
CREATE INDEX "idx_loan_item_deposits_loan" ON "loan_item_deposits"("loan_id");

-- RESTRICT, not CASCADE: deleting a customer, loan or loan item must never take
-- deposit history with it.
ALTER TABLE "loan_item_deposits" ADD CONSTRAINT "loan_item_deposits_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "loan_item_deposits" ADD CONSTRAINT "loan_item_deposits_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "customer_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "loan_item_deposits" ADD CONSTRAINT "loan_item_deposits_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loan_transactions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "loan_item_deposits" ADD CONSTRAINT "loan_item_deposits_loan_item_id_fkey" FOREIGN KEY ("loan_item_id") REFERENCES "loan_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- 4. The wallet ledger is append-only: a wrong entry is corrected by a new
--    entry, never by editing or deleting an old one. This also stops a CASCADE
--    from a deleted customer/account from silently erasing money history.
CREATE OR REPLACE FUNCTION smartbook_reject_ledger_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'account_ledger is append-only: % of entry % is not allowed', TG_OP, OLD."id"
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER account_ledger_append_only
    BEFORE UPDATE OR DELETE ON "account_ledger"
    FOR EACH ROW EXECUTE FUNCTION smartbook_reject_ledger_mutation();

-- 5. Fix: finalizeVnpayPayment marks a stale intent with vnp_response_code
--    'STALE_INTENT' (12 chars), which did not fit VARCHAR(10), so that fail-safe
--    path errored out instead of recording the failure. Widening never rewrites rows.
ALTER TABLE "fine_payment_intents" ALTER COLUMN "vnp_response_code" TYPE VARCHAR(20);

-- 6. A deposit row may change only while it is HELD (that one change is its
--    settlement) and is never deleted.
CREATE OR REPLACE FUNCTION smartbook_guard_loan_item_deposit() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'loan_item_deposits rows cannot be deleted (deposit %)', OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD."status" <> 'HELD' THEN
        RAISE EXCEPTION 'deposit % is already settled (%) and cannot change', OLD."id", OLD."status"
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER loan_item_deposits_settled_immutable
    BEFORE UPDATE OR DELETE ON "loan_item_deposits"
    FOR EACH ROW EXECUTE FUNCTION smartbook_guard_loan_item_deposit();
