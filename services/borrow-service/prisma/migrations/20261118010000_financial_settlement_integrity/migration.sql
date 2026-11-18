CREATE TABLE provider_payment_settlements (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 intent_id UUID NOT NULL UNIQUE REFERENCES fine_payment_intents(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 provider VARCHAR(20) NOT NULL,
 txn_ref VARCHAR(50) NOT NULL,
 provider_transaction_no VARCHAR(50) NOT NULL,
 customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 fine_id UUID NOT NULL REFERENCES fines(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 fine_payment_id UUID,
 received_amount DECIMAL(10,2) NOT NULL,
 applied_amount DECIMAL(10,2) NOT NULL,
 unapplied_amount DECIMAL(10,2) NOT NULL,
 raw_callback JSONB NOT NULL,
 received_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT ck_provider_settlement_conservation CHECK
  (received_amount>0 AND applied_amount>=0 AND unapplied_amount>=0 AND received_amount=applied_amount+unapplied_amount)
);
CREATE UNIQUE INDEX uq_provider_settlement_transaction ON provider_payment_settlements(provider,provider_transaction_no);
CREATE INDEX idx_provider_settlements_customer_received ON provider_payment_settlements(customer_id,received_at);
CREATE TABLE fine_payment_requests (
 idempotency_key VARCHAR(255) PRIMARY KEY,
 fingerprint VARCHAR(64) NOT NULL,
 fine_id UUID NOT NULL REFERENCES fines(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 response JSONB NOT NULL,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION protect_financial_payment_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'financial payment history is append-only'; END;
$$;
CREATE TRIGGER provider_settlement_append_only BEFORE UPDATE OR DELETE ON provider_payment_settlements
 FOR EACH ROW EXECUTE FUNCTION protect_financial_payment_history();
CREATE TRIGGER fine_payment_request_append_only BEFORE UPDATE OR DELETE ON fine_payment_requests
 FOR EACH ROW EXECUTE FUNCTION protect_financial_payment_history();
