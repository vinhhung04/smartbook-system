-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_code" VARCHAR(30) NOT NULL,
    "full_name" VARCHAR(150) NOT NULL,
    "email" CITEXT,
    "phone" VARCHAR(30),
    "birth_date" DATE,
    "address" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "total_fine_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "max_active_loans" INTEGER NOT NULL DEFAULT 5,
    "max_loan_days" INTEGER NOT NULL DEFAULT 14,
    "max_renewal_count" INTEGER NOT NULL DEFAULT 2,
    "reservation_hold_hours" INTEGER NOT NULL DEFAULT 24,
    "fine_per_day" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lost_item_fee_multiplier" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "card_number" VARCHAR(40) NOT NULL,
    "start_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_date" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "max_active_loans_override" INTEGER,
    "max_loan_days_override" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_preferences" (
    "customer_id" UUID NOT NULL,
    "notify_email" BOOLEAN NOT NULL DEFAULT true,
    "notify_sms" BOOLEAN NOT NULL DEFAULT false,
    "notify_in_app" BOOLEAN NOT NULL DEFAULT true,
    "preferred_language" VARCHAR(10) NOT NULL DEFAULT 'vi',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_preferences_pkey" PRIMARY KEY ("customer_id")
);

-- CreateTable
CREATE TABLE "loan_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservation_number" VARCHAR(40) NOT NULL,
    "customer_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "inventory_unit_id" UUID,
    "warehouse_id" UUID NOT NULL,
    "pickup_location_id" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "source_channel" VARCHAR(20) NOT NULL DEFAULT 'WEB',
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "reserved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "pickup_code" VARCHAR(24),
    "pickup_code_issued_at" TIMESTAMPTZ(6),
    "pickup_code_expires_at" TIMESTAMPTZ(6),
    "pickup_code_used_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "loan_number" VARCHAR(40) NOT NULL,
    "customer_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "handled_by_user_id" UUID NOT NULL,
    "source_reservation_id" UUID,
    "borrow_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "status" VARCHAR(20) NOT NULL DEFAULT 'BORROWED',
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "loan_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "inventory_unit_id" UUID,
    "item_barcode" VARCHAR(100),
    "due_date" TIMESTAMPTZ(6) NOT NULL,
    "return_date" TIMESTAMPTZ(6),
    "returned_to_warehouse_id" UUID,
    "returned_to_location_id" UUID,
    "item_condition_on_checkout" VARCHAR(20) NOT NULL DEFAULT 'GOOD',
    "item_condition_on_return" VARCHAR(20),
    "status" VARCHAR(20) NOT NULL DEFAULT 'BORROWED',
    "fine_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lost_fee_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "loan_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_renewals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "loan_item_id" UUID NOT NULL,
    "renewed_by_user_id" UUID,
    "renewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "old_due_date" TIMESTAMPTZ(6) NOT NULL,
    "new_due_date" TIMESTAMPTZ(6) NOT NULL,
    "renewal_count" INTEGER NOT NULL,
    "reason" TEXT,

    CONSTRAINT "loan_renewals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "loan_item_id" UUID,
    "fine_type" VARCHAR(20) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "waived_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'UNPAID',
    "issued_by_user_id" UUID,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(6),
    "waived_by_user_id" UUID,
    "note" TEXT,

    CONSTRAINT "fines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fine_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fine_id" UUID NOT NULL,
    "payment_method" VARCHAR(20) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "transaction_reference" TEXT,
    "paid_by_user_id" UUID,
    "paid_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "fine_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "template_code" VARCHAR(50),
    "subject" VARCHAR(200),
    "body" TEXT NOT NULL,
    "reference_type" VARCHAR(50),
    "reference_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),
    "read_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "customer_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "comment" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'VISIBLE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_wishlists" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_wishlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "notified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "availability_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "borrow_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID,
    "action_name" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID,
    "before_data" JSONB,
    "after_data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "borrow_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "currency_code" VARCHAR(10) NOT NULL DEFAULT 'VND',
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "available_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "held_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_credited" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_debited" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_ledger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "entry_type" VARCHAR(20) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balance_before" DECIMAL(12,2) NOT NULL,
    "balance_after" DECIMAL(12,2) NOT NULL,
    "reference_type" VARCHAR(50),
    "reference_id" UUID,
    "idempotency_key" VARCHAR(120),
    "note" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "method_type" VARCHAR(20) NOT NULL,
    "provider" VARCHAR(40),
    "provider_reference" VARCHAR(100),
    "masked_account" VARCHAR(50),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_payment_settings" (
    "customer_id" UUID NOT NULL,
    "auto_debit_borrow_fee" BOOLEAN NOT NULL DEFAULT true,
    "auto_debit_fines" BOOLEAN NOT NULL DEFAULT false,
    "allow_partial_fine_payment" BOOLEAN NOT NULL DEFAULT true,
    "min_wallet_balance_required" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "default_payment_method_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_payment_settings_pkey" PRIMARY KEY ("customer_id")
);

-- CreateTable
CREATE TABLE "integration_outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "aggregate_type" VARCHAR(100) NOT NULL,
    "aggregate_id" UUID,
    "event_type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "integration_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_inbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_service" VARCHAR(50) NOT NULL,
    "event_id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
    "error_message" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "integration_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_customer_code_key" ON "customers"("customer_code");

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "idx_customers_status" ON "customers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "membership_plans_code_key" ON "membership_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "customer_memberships_card_number_key" ON "customer_memberships"("card_number");

-- CreateIndex
CREATE INDEX "idx_customer_memberships_customer_id" ON "customer_memberships"("customer_id");

-- CreateIndex
CREATE INDEX "idx_customer_memberships_status" ON "customer_memberships"("status");

-- CreateIndex
CREATE UNIQUE INDEX "loan_reservations_reservation_number_key" ON "loan_reservations"("reservation_number");

-- CreateIndex
CREATE UNIQUE INDEX "loan_reservations_pickup_code_key" ON "loan_reservations"("pickup_code");

-- CreateIndex
CREATE INDEX "idx_loan_reservations_status_expires" ON "loan_reservations"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "loan_transactions_loan_number_key" ON "loan_transactions"("loan_number");

-- CreateIndex
CREATE INDEX "idx_loan_transactions_customer_id" ON "loan_transactions"("customer_id", "status");

-- CreateIndex
CREATE INDEX "idx_loan_transactions_due_date" ON "loan_transactions"("due_date", "status");

-- CreateIndex
CREATE INDEX "idx_loan_items_loan_status" ON "loan_items"("loan_id", "status");

-- CreateIndex
CREATE INDEX "idx_loan_renewals_loan_item_id" ON "loan_renewals"("loan_item_id");

-- CreateIndex
CREATE INDEX "idx_fines_customer_status" ON "fines"("customer_id", "status");

-- CreateIndex
CREATE INDEX "idx_fines_loan_item_id" ON "fines"("loan_item_id");

-- CreateIndex
CREATE INDEX "idx_fine_payments_fine_id" ON "fine_payments"("fine_id");

-- CreateIndex
CREATE INDEX "idx_customer_notifications_status" ON "customer_notifications"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "idx_book_reviews_book_id" ON "book_reviews"("book_id");

-- CreateIndex
CREATE INDEX "idx_book_reviews_customer_id" ON "book_reviews"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_book_reviews_customer_book" ON "book_reviews"("customer_id", "book_id");

-- CreateIndex
CREATE INDEX "idx_book_wishlists_customer_id" ON "book_wishlists"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_book_wishlists_customer_book" ON "book_wishlists"("customer_id", "book_id");

-- CreateIndex
CREATE INDEX "idx_availability_alerts_book_status" ON "availability_alerts"("book_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_availability_alerts_customer_book" ON "availability_alerts"("customer_id", "book_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_accounts_customer_id_key" ON "customer_accounts"("customer_id");

-- CreateIndex
CREATE INDEX "idx_customer_accounts_status" ON "customer_accounts"("status");

-- CreateIndex
CREATE INDEX "idx_account_ledger_account_created" ON "account_ledger"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_account_ledger_customer_created" ON "account_ledger"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_account_ledger_entry_type" ON "account_ledger"("entry_type");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_account_ledger_customer_idempotency" ON "account_ledger"("customer_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "idx_payment_methods_customer_status" ON "payment_methods"("customer_id", "status");

-- CreateIndex
CREATE INDEX "idx_integration_outbox_status_occurred" ON "integration_outbox"("status", "occurred_at");

-- CreateIndex
CREATE INDEX "idx_integration_inbox_status_received" ON "integration_inbox"("status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_inbox_source_service_event_id_key" ON "integration_inbox"("source_service", "event_id");

-- AddForeignKey
ALTER TABLE "customer_memberships" ADD CONSTRAINT "customer_memberships_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "customer_memberships" ADD CONSTRAINT "customer_memberships_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "membership_plans"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "customer_preferences" ADD CONSTRAINT "customer_preferences_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "loan_reservations" ADD CONSTRAINT "loan_reservations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "loan_transactions" ADD CONSTRAINT "loan_transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "loan_transactions" ADD CONSTRAINT "loan_transactions_source_reservation_id_fkey" FOREIGN KEY ("source_reservation_id") REFERENCES "loan_reservations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "loan_items" ADD CONSTRAINT "loan_items_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loan_transactions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "loan_renewals" ADD CONSTRAINT "loan_renewals_loan_item_id_fkey" FOREIGN KEY ("loan_item_id") REFERENCES "loan_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_loan_item_id_fkey" FOREIGN KEY ("loan_item_id") REFERENCES "loan_items"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fine_payments" ADD CONSTRAINT "fine_payments_fine_id_fkey" FOREIGN KEY ("fine_id") REFERENCES "fines"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "customer_notifications" ADD CONSTRAINT "customer_notifications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "book_reviews" ADD CONSTRAINT "book_reviews_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "book_wishlists" ADD CONSTRAINT "book_wishlists_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "availability_alerts" ADD CONSTRAINT "availability_alerts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "account_ledger" ADD CONSTRAINT "account_ledger_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "account_ledger" ADD CONSTRAINT "account_ledger_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auto_payment_settings" ADD CONSTRAINT "auto_payment_settings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

