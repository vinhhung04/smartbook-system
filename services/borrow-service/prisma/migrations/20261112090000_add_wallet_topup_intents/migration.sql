-- Online wallet top-up through VNPay. One row per payment link; VNPay's return/IPN
-- callback finalizes it once and credits the wallet through account_ledger
-- (entry CREDIT, reference_type VNPAY_TOPUP). Mirrors fine_payment_intents.
--
-- Additive only: a new table, nothing existing is changed.
-- Rollback (manual; only safe while no top-up has succeeded):
--   DROP TABLE IF EXISTS "wallet_topup_intents";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261112090000_add_wallet_topup_intents';

CREATE TABLE "wallet_topup_intents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL DEFAULT 'VNPAY',
    "txn_ref" VARCHAR(50) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "vnp_order_info" VARCHAR(255),
    "vnp_response_code" VARCHAR(20),
    "vnp_transaction_no" VARCHAR(50),
    "vnp_bank_code" VARCHAR(20),
    "ledger_entry_id" UUID,
    "raw_return_params" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "finalized_at" TIMESTAMPTZ(6),

    CONSTRAINT "wallet_topup_intents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wallet_topup_intents_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "wallet_topup_intents_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'EXPIRED'))
);

CREATE UNIQUE INDEX "uq_wallet_topup_intents_txn_ref" ON "wallet_topup_intents"("txn_ref");
CREATE INDEX "idx_wallet_topup_intents_customer_status" ON "wallet_topup_intents"("customer_id", "status");

-- RESTRICT: a customer with top-up history cannot be deleted out from under it.
ALTER TABLE "wallet_topup_intents" ADD CONSTRAINT "wallet_topup_intents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
