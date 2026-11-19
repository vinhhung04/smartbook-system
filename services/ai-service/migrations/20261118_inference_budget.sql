-- Apply as the AI schema owner/migrator before starting the new application.
-- No historical data is rewritten. One row records one admitted inference attempt.
CREATE TABLE IF NOT EXISTS ai_inference_leases (
    id UUID PRIMARY KEY,
    feature VARCHAR(64) NOT NULL,
    principal_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS ai_inference_leases_window ON ai_inference_leases (created_at);
CREATE INDEX IF NOT EXISTS ai_inference_leases_principal_window ON ai_inference_leases (principal_hash, feature, created_at);
CREATE INDEX IF NOT EXISTS ai_inference_leases_active ON ai_inference_leases (expires_at) WHERE completed_at IS NULL;
