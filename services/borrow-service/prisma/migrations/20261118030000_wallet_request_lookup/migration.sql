SET lock_timeout = '5s';
SET statement_timeout = '30s';
CREATE INDEX idx_account_ledger_request_key ON account_ledger(idempotency_key);
RESET lock_timeout;
RESET statement_timeout;
