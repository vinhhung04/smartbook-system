-- CreateTable
CREATE TABLE "fine_payment_intents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fine_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL DEFAULT 'VNPAY',
    "txn_ref" VARCHAR(50) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "vnp_order_info" VARCHAR(255),
    "vnp_response_code" VARCHAR(10),
    "vnp_transaction_no" VARCHAR(50),
    "vnp_bank_code" VARCHAR(20),
    "fine_payment_id" UUID,
    "raw_return_params" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "finalized_at" TIMESTAMPTZ(6),

    CONSTRAINT "fine_payment_intents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fine_payment_intents_fine_id_fkey" FOREIGN KEY ("fine_id") REFERENCES "fines"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_fine_payment_intents_txn_ref" ON "fine_payment_intents"("txn_ref");

-- CreateIndex
CREATE INDEX "idx_fine_payment_intents_customer_status" ON "fine_payment_intents"("customer_id", "status");

-- CreateIndex
CREATE INDEX "idx_fine_payment_intents_fine_id" ON "fine_payment_intents"("fine_id");
