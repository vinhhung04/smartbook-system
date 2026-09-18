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

-- Durable cache for "find book by cover photo" visual-embedding gallery
-- (cover_gallery.py). One row per inventory book_variants row that has a
-- cover_image_url. No pgvector: embedding is a plain JSONB float array,
-- compared with the same pure-Python cosine_similarity used by book_index.py.
CREATE TABLE IF NOT EXISTS ai_cover_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id UUID UNIQUE NOT NULL,
    book_id UUID NOT NULL,
    title TEXT,
    author TEXT,
    cover_image_url TEXT NOT NULL,
    model_name VARCHAR(128) NOT NULL,
    embedding JSONB NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_ai_cover_embeddings_book ON ai_cover_embeddings (book_id);

-- Vector store (Phase A). Extension tao o day chu khong chi trong db-init/ vi
-- db-init chi chay tren volume trong; schema.sql chay moi lan service khoi dong
-- nen day la duong duy nhat co tac dung voi database dang ton tai.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE IF NOT EXISTS ai_documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corpus        VARCHAR(32)  NOT NULL,
    source_id     VARCHAR(128) NOT NULL,
    title         TEXT,
    content       TEXT         NOT NULL,
    content_hash  VARCHAR(64)  NOT NULL,
    metadata      JSONB        NOT NULL DEFAULT '{}',
    updated_at    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    UNIQUE (corpus, source_id)
);

CREATE TABLE IF NOT EXISTS ai_document_chunks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID NOT NULL REFERENCES ai_documents (id) ON DELETE CASCADE,
    corpus          VARCHAR(32)  NOT NULL,
    chunk_index     INT          NOT NULL,
    content         TEXT         NOT NULL,
    content_hash    VARCHAR(64)  NOT NULL,
    embedding       vector(768)  NOT NULL,
    embedding_model VARCHAR(64)  NOT NULL,
    tsv             tsvector,
    created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS ix_ai_chunks_embedding
    ON ai_document_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS ix_ai_chunks_tsv
    ON ai_document_chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS ix_ai_chunks_corpus_model
    ON ai_document_chunks (corpus, embedding_model);
