SET lock_timeout = '5s';
SET statement_timeout = '30s';
ALTER TABLE integration_outbox
  ADD COLUMN next_attempt_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN lease_until TIMESTAMPTZ(6),
  ADD COLUMN last_error_code VARCHAR(64);
CREATE INDEX idx_integration_outbox_retry_due
  ON integration_outbox(status, event_type, next_attempt_at);
RESET lock_timeout;
RESET statement_timeout;
