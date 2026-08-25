-- ai-service schema — idempotent, applied automatically at startup (see db.py::init_db).
-- Not a migration tool: just CREATE ... IF NOT EXISTS, matching the simplicity of the
-- repo's existing db-init/*.sql scripts. Safe to run on every boot.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ai_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID UNIQUE NOT NULL,
    title VARCHAR(255),
    user_id VARCHAR(64) NOT NULL,
    user_roles JSONB NOT NULL DEFAULT '[]',
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    summary TEXT,
    last_intent VARCHAR(128),
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    last_message_at TIMESTAMPTZ(6)
);

CREATE INDEX IF NOT EXISTS ix_ai_conversations_user_status ON ai_conversations (user_id, status);

CREATE TABLE IF NOT EXISTS ai_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES ai_conversations (id) ON DELETE CASCADE,
    role VARCHAR(16) NOT NULL,
    content TEXT,
    tool_calls JSONB,
    tool_results JSONB,
    data JSONB,
    pending_action_id VARCHAR(64),
    grounding_warning TEXT,
    sources JSONB,
    metadata JSONB,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_ai_messages_conversation_created ON ai_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS ai_pending_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_id VARCHAR(64) UNIQUE NOT NULL,
    type VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    summary TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    risk VARCHAR(16) NOT NULL,
    requires_confirmation BOOLEAN NOT NULL DEFAULT TRUE,
    allowed_roles JSONB NOT NULL DEFAULT '[]',
    allowed_permissions JSONB NOT NULL DEFAULT '[]',
    sources JSONB NOT NULL DEFAULT '[]',
    intent VARCHAR(128),
    created_from_message TEXT,
    warnings JSONB NOT NULL DEFAULT '[]',
    requires_review BOOLEAN NOT NULL DEFAULT FALSE,
    created_by_user_id VARCHAR(64),
    created_by_roles JSONB NOT NULL DEFAULT '[]',
    confirmed_by_user_id VARCHAR(64),
    cancelled_by_user_id VARCHAR(64),
    result JSONB,
    error_message TEXT,
    conversation_id UUID REFERENCES ai_conversations (conversation_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ(6) NOT NULL,
    confirmed_at TIMESTAMPTZ(6),
    executed_at TIMESTAMPTZ(6),
    cancelled_at TIMESTAMPTZ(6),
    failed_at TIMESTAMPTZ(6),
    expired_at TIMESTAMPTZ(6)
);

CREATE INDEX IF NOT EXISTS ix_ai_pending_actions_creator_status ON ai_pending_actions (created_by_user_id, status);
CREATE INDEX IF NOT EXISTS ix_ai_pending_actions_conversation ON ai_pending_actions (conversation_id);

CREATE TABLE IF NOT EXISTS ai_action_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(32) NOT NULL,
    actor_user_id VARCHAR(64),
    actor_roles JSONB NOT NULL DEFAULT '[]',
    old_status VARCHAR(32),
    new_status VARCHAR(32),
    payload_snapshot JSONB,
    metadata JSONB,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_ai_action_audit_logs_action ON ai_action_audit_logs (action_id);
