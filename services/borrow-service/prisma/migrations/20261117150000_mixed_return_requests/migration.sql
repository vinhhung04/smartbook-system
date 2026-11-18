CREATE TABLE loan_return_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key varchar(255) NOT NULL UNIQUE,
  loan_id uuid NOT NULL REFERENCES loan_transactions(id) ON UPDATE NO ACTION,
  fingerprint text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PROCESSING',
  response jsonb,
  unresolved_item_ids jsonb NOT NULL DEFAULT '[]',
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_loan_return_request_status CHECK (status IN ('PROCESSING','COMPLETED','RETRYABLE'))
);
CREATE INDEX idx_loan_return_requests_loan ON loan_return_requests(loan_id);
-- Additive request ledger. No historic loan, fine, payment or deposit is rewritten.
