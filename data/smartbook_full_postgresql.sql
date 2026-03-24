\set ON_ERROR_STOP on
\encoding UTF8
SET client_min_messages TO warning;

SELECT 'CREATE DATABASE auth_db' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'auth_db')\gexec

SELECT 'CREATE DATABASE inventory_db' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'inventory_db')\gexec

SELECT 'CREATE DATABASE borrow_db' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'borrow_db')\gexec

SELECT 'CREATE DATABASE ai_db' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ai_db')\gexec

SELECT 'CREATE DATABASE analytics_db' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'analytics_db')\gexec

SELECT 'CREATE DATABASE chatbot_db' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'chatbot_db')\gexec

\connect auth_db
\encoding UTF8
SET client_min_messages TO warning;

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(100) NOT NULL UNIQUE,
    module_name VARCHAR(50) NOT NULL,
    action_name VARCHAR(50) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username CITEXT NOT NULL UNIQUE,
    email CITEXT UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(30),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'INACTIVE', 'LOCKED', 'PENDING')),
    avatar_url TEXT,
    primary_warehouse_id UUID,
    is_superuser BOOLEAN NOT NULL DEFAULT FALSE,
    failed_login_attempts INT NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_by_user_id UUID,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_warehouse_scopes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL,
    access_level VARCHAR(20) NOT NULL
        CHECK (access_level IN ('VIEW', 'OPERATE', 'MANAGE', 'ADMIN')),
    assigned_by_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    user_agent TEXT,
    ip_address INET,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    CHECK (expires_at > created_at),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    CHECK (expires_at > created_at),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID,
    action_name VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    detail JSONB NOT NULL DEFAULT '{}'::JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id UUID,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    headers JSONB NOT NULL DEFAULT '{}'::JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
    retry_count INT NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS integration_inbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_service VARCHAR(50) NOT NULL,
    event_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED'
        CHECK (status IN ('RECEIVED', 'PROCESSED', 'FAILED')),
    error_message TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    UNIQUE (source_service, event_id)
);

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_primary_warehouse_id ON users(primary_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_user_warehouse_scopes_warehouse_id ON user_warehouse_scopes(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_actor_user_id ON auth_audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_created_at ON auth_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_auth_outbox_status ON integration_outbox(status, occurred_at);
CREATE INDEX IF NOT EXISTS idx_auth_inbox_status ON integration_inbox(status, received_at);

INSERT INTO roles (code, name, description, is_system)
VALUES
    ('ADMIN', 'Administrator', 'Full access to platform configuration and IAM', TRUE),
    ('MANAGER', 'Manager', 'Can monitor operations, analytics and approvals', TRUE),
    ('STAFF', 'Staff', 'Can operate warehouse and borrow workflows', TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (code, module_name, action_name, description)
VALUES
    ('auth.users.read', 'auth', 'read', 'View user accounts'),
    ('auth.users.write', 'auth', 'write', 'Create or update user accounts'),
    ('auth.roles.read', 'auth', 'read', 'View roles and permissions'),
    ('auth.roles.write', 'auth', 'write', 'Manage roles and permissions'),
    ('inventory.catalog.read', 'inventory', 'read', 'View catalog and variants'),
    ('inventory.catalog.write', 'inventory', 'write', 'Manage catalog and variants'),
    ('inventory.stock.read', 'inventory', 'read', 'View stock balances and movements'),
    ('inventory.stock.write', 'inventory', 'write', 'Post inventory movements'),
    ('inventory.purchase.approve', 'inventory', 'approve', 'Approve purchase and transfer documents'),
    ('borrow.read', 'borrow', 'read', 'View customers, reservations and loans'),
    ('borrow.write', 'borrow', 'write', 'Create reservations, loans and returns'),
    ('borrow.fines.manage', 'borrow', 'write', 'Issue and settle fines'),
    ('ai.read', 'ai', 'read', 'View recognition jobs and results'),
    ('ai.write', 'ai', 'write', 'Create and verify recognition jobs'),
    ('analytics.read', 'analytics', 'read', 'View forecasts, KPI and recommendations'),
    ('chatbot.use', 'chatbot', 'execute', 'Use chatbot and save reports'),
    ('observability.read', 'platform', 'read', 'View logs and audit information')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON TRUE
WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p
  ON p.code IN (
      'inventory.catalog.read',
      'inventory.stock.read',
      'inventory.purchase.approve',
      'borrow.read',
      'analytics.read',
      'chatbot.use',
      'observability.read'
  )
WHERE r.code = 'MANAGER'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p
  ON p.code IN (
      'inventory.catalog.read',
      'inventory.stock.read',
      'inventory.stock.write',
      'borrow.read',
      'borrow.write',
      'ai.read',
      'ai.write',
      'chatbot.use'
  )
WHERE r.code = 'STAFF'
ON CONFLICT DO NOTHING;

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY['roles', 'users']
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I;', tbl, tbl);
        EXECUTE format(
            'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
            tbl, tbl
        );
    END LOOP;
END $$;

COMMIT;

\connect inventory_db
\encoding UTF8
SET client_min_messages TO warning;

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS publishers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(30) UNIQUE,
    name VARCHAR(150) NOT NULL UNIQUE,
    phone VARCHAR(30),
    email VARCHAR(150),
    website TEXT,
    address TEXT,
    country VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS authors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(150) NOT NULL,
    sort_name VARCHAR(150),
    biography TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (full_name)
);

CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    slug VARCHAR(150) NOT NULL UNIQUE,
    parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (parent_id, name)
);

CREATE TABLE IF NOT EXISTS books (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_code VARCHAR(30) UNIQUE,
    title VARCHAR(255) NOT NULL,
    subtitle VARCHAR(255),
    description TEXT,
    publisher_id UUID REFERENCES publishers(id) ON DELETE SET NULL,
    edition VARCHAR(50),
    published_date DATE,
    page_count INT CHECK (page_count IS NULL OR page_count > 0),
    country_of_origin VARCHAR(100),
    default_language VARCHAR(10),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS book_authors (
    book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    author_order INT NOT NULL DEFAULT 1 CHECK (author_order > 0),
    PRIMARY KEY (book_id, author_id)
);

CREATE TABLE IF NOT EXISTS book_categories (
    book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (book_id, category_id)
);

CREATE TABLE IF NOT EXISTS book_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    sku VARCHAR(50) NOT NULL UNIQUE,
    isbn13 VARCHAR(20) UNIQUE,
    isbn10 VARCHAR(20) UNIQUE,
    internal_barcode VARCHAR(50) UNIQUE,
    cover_type VARCHAR(20) NOT NULL DEFAULT 'PAPERBACK'
        CHECK (cover_type IN ('HARDCOVER', 'PAPERBACK', 'OTHER')),
    language_code VARCHAR(10) NOT NULL DEFAULT 'vi',
    publish_year INT CHECK (publish_year IS NULL OR publish_year BETWEEN 1000 AND 2100),
    condition_grade VARCHAR(20) NOT NULL DEFAULT 'NEW'
        CHECK (condition_grade IN ('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED')),
    unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    list_price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (list_price >= 0),
    replacement_cost NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (replacement_cost >= 0),
    is_borrowable BOOLEAN NOT NULL DEFAULT TRUE,
    is_sellable BOOLEAN NOT NULL DEFAULT FALSE,
    is_track_by_unit BOOLEAN NOT NULL DEFAULT FALSE,
    cover_image_url TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS book_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id UUID REFERENCES books(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES book_variants(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    image_type VARCHAR(20) NOT NULL DEFAULT 'COVER'
        CHECK (image_type IN ('COVER', 'BACK', 'PREVIEW', 'THUMBNAIL', 'OTHER')),
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (book_id IS NOT NULL OR variant_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(30) UNIQUE,
    name VARCHAR(150) NOT NULL UNIQUE,
    contact_name VARCHAR(150),
    phone VARCHAR(30),
    email VARCHAR(150),
    address TEXT,
    tax_code VARCHAR(50),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES book_variants(id) ON DELETE CASCADE,
    supplier_sku VARCHAR(50),
    lead_time_days INT CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
    default_cost NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (default_cost >= 0),
    min_order_qty INT NOT NULL DEFAULT 1 CHECK (min_order_qty > 0),
    is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (supplier_id, variant_id)
);

CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    warehouse_type VARCHAR(20) NOT NULL DEFAULT 'WAREHOUSE'
        CHECK (warehouse_type IN ('WAREHOUSE', 'STORE', 'BRANCH', 'LIBRARY')),
    address_line1 TEXT,
    address_line2 TEXT,
    ward VARCHAR(120),
    district VARCHAR(120),
    province VARCHAR(120),
    country VARCHAR(120) NOT NULL DEFAULT 'Vietnam',
    manager_user_id UUID,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS warehouse_settings (
    warehouse_id UUID PRIMARY KEY REFERENCES warehouses(id) ON DELETE CASCADE,
    reservation_hold_hours INT NOT NULL DEFAULT 24 CHECK (reservation_hold_hours > 0 AND reservation_hold_hours <= 168),
    allow_negative_stock BOOLEAN NOT NULL DEFAULT FALSE,
    default_low_stock_threshold INT NOT NULL DEFAULT 5 CHECK (default_low_stock_threshold >= 0),
    enable_cycle_count BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    parent_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    location_code VARCHAR(60) NOT NULL,
    location_type VARCHAR(20) NOT NULL DEFAULT 'ZONE'
        CHECK (location_type IN ('ZONE', 'SHELF', 'SHELF_COMPARTMENT', 'AISLE', 'BIN', 'RECEIVING', 'SHIPPING', 'RETURN', 'STAGING')),
    zone VARCHAR(50),
    aisle VARCHAR(50),
    shelf VARCHAR(50),
    bin VARCHAR(50),
    barcode VARCHAR(100) UNIQUE,
    capacity_qty INT CHECK (capacity_qty IS NULL OR capacity_qty >= 0),
    available INT NOT NULL DEFAULT 0,
    is_pickable BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (warehouse_id, location_code),
    UNIQUE (warehouse_id, zone, aisle, shelf, bin)
);

CREATE TABLE IF NOT EXISTS inventory_units (    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id UUID NOT NULL REFERENCES book_variants(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    home_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    current_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    unit_barcode VARCHAR(100) NOT NULL UNIQUE,
    acquisition_reference TEXT,
    acquisition_cost NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (acquisition_cost >= 0),
    condition_grade VARCHAR(20) NOT NULL DEFAULT 'NEW'
        CHECK (condition_grade IN ('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED')),
    status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE'
        CHECK (status IN ('AVAILABLE', 'RESERVED', 'BORROWED', 'IN_TRANSIT', 'LOST', 'DAMAGED', 'ARCHIVED')),
    last_seen_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES book_variants(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    on_hand_qty INT NOT NULL DEFAULT 0 CHECK (on_hand_qty >= 0),
    available_qty INT NOT NULL DEFAULT 0 CHECK (available_qty >= 0),
    reserved_qty INT NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
    borrowed_qty INT NOT NULL DEFAULT 0 CHECK (borrowed_qty >= 0),
    damaged_qty INT NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),
    in_transit_qty INT NOT NULL DEFAULT 0 CHECK (in_transit_qty >= 0),
    safety_stock_qty INT NOT NULL DEFAULT 0 CHECK (safety_stock_qty >= 0),
    reorder_point INT NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE'
        CHECK (status IN ('AVAILABLE', 'LOW_STOCK', 'OUT_OF_STOCK', 'HOLD')),
    version INT NOT NULL DEFAULT 1 CHECK (version > 0),
    last_movement_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (variant_id, location_id)
);

CREATE TABLE IF NOT EXISTS stock_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_code VARCHAR(40) NOT NULL UNIQUE,
    variant_id UUID NOT NULL REFERENCES book_variants(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    customer_id UUID,
    source_service VARCHAR(20) NOT NULL
        CHECK (source_service IN ('BORROW', 'SALES', 'TRANSFER', 'MANUAL')),
    source_reference_id UUID,
    quantity INT NOT NULL CHECK (quantity > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED', 'CANCELLED')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_by_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number VARCHAR(40) NOT NULL UNIQUE,
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')),
    ordered_by_user_id UUID NOT NULL,
    approved_by_user_id UUID,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_date DATE,
    note TEXT,
    CHECK (expected_date IS NULL OR expected_date >= order_date),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES book_variants(id) ON DELETE RESTRICT,
    ordered_qty INT NOT NULL CHECK (ordered_qty > 0),
    received_qty INT NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
    unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    note TEXT,
    UNIQUE (purchase_order_id, variant_id)
);

CREATE TABLE IF NOT EXISTS goods_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_number VARCHAR(40) NOT NULL UNIQUE,
    purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    source_type VARCHAR(20) NOT NULL DEFAULT 'PURCHASE_ORDER'
        CHECK (source_type IN ('PURCHASE_ORDER', 'RETURN', 'TRANSFER', 'ADJUSTMENT', 'MANUAL')),
    source_reference_id UUID,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED')),
    received_by_user_id UUID NOT NULL,
    received_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancelled_by_user_id UUID,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goods_receipt_id UUID NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES book_variants(id) ON DELETE RESTRICT,
    location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    condition_grade VARCHAR(20) NOT NULL DEFAULT 'NEW'
        CHECK (condition_grade IN ('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED')),
    note TEXT
);

CREATE TABLE IF NOT EXISTS outbound_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outbound_number VARCHAR(40) NOT NULL UNIQUE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    outbound_type VARCHAR(30) NOT NULL
        CHECK (outbound_type IN ('SALE', 'DISPOSAL', 'RETURN_TO_SUPPLIER', 'MANUAL')),
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PICKING', 'READY_FOR_OUTBOUND', 'COMPLETED', 'CANCELLED')),
    requested_by_user_id UUID NOT NULL,
    approved_by_user_id UUID,
    processed_by_user_id UUID,
    external_reference TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outbound_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outbound_order_id UUID NOT NULL REFERENCES outbound_orders(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES book_variants(id) ON DELETE RESTRICT,
    source_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    processed_qty INT NOT NULL DEFAULT 0 CHECK (processed_qty >= 0),
    note TEXT
);

CREATE TABLE IF NOT EXISTS transfer_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_number VARCHAR(40) NOT NULL UNIQUE,
    from_warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    to_warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'REQUESTED', 'APPROVED', 'PICKING', 'READY_FOR_OUTBOUND', 'OUTBOUND_COMPLETED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')),
    requested_by_user_id UUID NOT NULL,
    approved_by_user_id UUID,
    shipped_by_user_id UUID,
    received_by_user_id UUID,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    shipped_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ,
    note TEXT,
    CHECK (shipped_at IS NULL OR shipped_at >= requested_at),
    CHECK (received_at IS NULL OR shipped_at IS NULL OR received_at >= shipped_at),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (from_warehouse_id <> to_warehouse_id)
);

CREATE TABLE IF NOT EXISTS transfer_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_order_id UUID NOT NULL REFERENCES transfer_orders(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES book_variants(id) ON DELETE RESTRICT,
    from_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    to_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    shipped_qty INT NOT NULL DEFAULT 0 CHECK (shipped_qty >= 0),
    received_qty INT NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
    unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    note TEXT
);

CREATE TABLE IF NOT EXISTS stock_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_number VARCHAR(40) NOT NULL UNIQUE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'IN_PROGRESS', 'REVIEWED', 'COMPLETED', 'CANCELLED')),
    created_by_user_id UUID NOT NULL,
    reviewed_by_user_id UUID,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    note TEXT,
    CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_audit_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_audit_id UUID NOT NULL REFERENCES stock_audits(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES book_variants(id) ON DELETE RESTRICT,
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
    expected_qty INT NOT NULL DEFAULT 0 CHECK (expected_qty >= 0),
    counted_qty INT CHECK (counted_qty IS NULL OR counted_qty >= 0),
    variance_qty INT,
    adjustment_posted BOOLEAN NOT NULL DEFAULT FALSE,
    note TEXT,
    UNIQUE (stock_audit_id, variant_id, location_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movement_number VARCHAR(40) NOT NULL UNIQUE,
    movement_type VARCHAR(20) NOT NULL
        CHECK (movement_type IN ('INBOUND', 'OUTBOUND', 'TRANSFER', 'ADJUSTMENT', 'BORROW', 'RETURN', 'RESERVE', 'RELEASE')),
    movement_status VARCHAR(20) NOT NULL DEFAULT 'POSTED'
        CHECK (movement_status IN ('DRAFT', 'POSTED', 'CANCELLED')),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    variant_id UUID NOT NULL REFERENCES book_variants(id) ON DELETE RESTRICT,
    inventory_unit_id UUID REFERENCES inventory_units(id) ON DELETE SET NULL,
    from_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    to_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    reason_code TEXT,
    source_service VARCHAR(30) NOT NULL,
    reference_type VARCHAR(50),
    reference_id UUID,
    correlation_id UUID,
    idempotency_key VARCHAR(100),
    created_by_user_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    reverted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS stock_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES book_variants(id) ON DELETE CASCADE,
    alert_type VARCHAR(20) NOT NULL
        CHECK (alert_type IN ('LOW_STOCK', 'OUT_OF_STOCK', 'AGEING', 'HIGH_DEMAND', 'DAMAGED')),
    alert_level VARCHAR(20) NOT NULL
        CHECK (alert_level IN ('INFO', 'WARN', 'CRITICAL')),
    threshold_value NUMERIC(12, 2),
    current_value NUMERIC(12, 2),
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
    first_triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_by_user_id UUID,
    acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    payload JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE TABLE IF NOT EXISTS inventory_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID,
    action_name VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    before_data JSONB,
    after_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id UUID,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    headers JSONB NOT NULL DEFAULT '{}'::JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
    retry_count INT NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS integration_inbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_service VARCHAR(50) NOT NULL,
    event_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED'
        CHECK (status IN ('RECEIVED', 'PROCESSED', 'FAILED')),
    error_message TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    UNIQUE (source_service, event_id)
);

CREATE INDEX IF NOT EXISTS idx_books_title_trgm ON books USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_authors_full_name_trgm ON authors USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_book_variants_book_id ON book_variants(book_id);
CREATE INDEX IF NOT EXISTS idx_book_variants_isbn13 ON book_variants(isbn13);
CREATE INDEX IF NOT EXISTS idx_locations_warehouse_id ON locations(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_units_variant_status ON inventory_units(variant_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_units_current_location_id ON inventory_units(current_location_id);
CREATE INDEX IF NOT EXISTS idx_stock_balances_variant_location ON stock_balances(variant_id, location_id);
CREATE INDEX IF NOT EXISTS idx_stock_balances_warehouse_status ON stock_balances(warehouse_id, status);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_status_expires ON stock_reservations(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status, order_date);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_status ON goods_receipts(status, received_at);
CREATE INDEX IF NOT EXISTS idx_outbound_orders_status ON outbound_orders(status, requested_at);
CREATE INDEX IF NOT EXISTS idx_transfer_orders_status ON transfer_orders(status, requested_at);
CREATE INDEX IF NOT EXISTS idx_stock_audits_status ON stock_audits(status, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_variant_created_at ON stock_movements(variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_reference ON stock_movements(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_stock_alerts_status ON stock_alerts(status, alert_type);
CREATE INDEX IF NOT EXISTS idx_inventory_outbox_status ON integration_outbox(status, occurred_at);
CREATE INDEX IF NOT EXISTS idx_inventory_inbox_status ON integration_inbox(status, received_at);

INSERT INTO warehouse_settings (warehouse_id)
SELECT id
FROM warehouses
ON CONFLICT DO NOTHING;

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'publishers',
        'authors',
        'categories',
        'books',
        'book_variants',
        'suppliers',
        'warehouses',
        'warehouse_settings',
        'locations',
        'inventory_units',
        'stock_balances',
        'stock_reservations',
        'purchase_orders',
        'goods_receipts',
        'outbound_orders',
        'transfer_orders',
        'stock_audits'
    ]
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I;', tbl, tbl);
        EXECUTE format(
            'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
            tbl, tbl
        );
    END LOOP;
END $$;

COMMIT;

\connect borrow_db
\encoding UTF8
SET client_min_messages TO warning;

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_code VARCHAR(30) NOT NULL UNIQUE,
    full_name VARCHAR(150) NOT NULL,
    email CITEXT UNIQUE,
    phone VARCHAR(30) UNIQUE,
    birth_date DATE,
    address TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'SUSPENDED', 'BLOCKED', 'INACTIVE')),
    total_fine_balance NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_fine_balance >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS membership_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    max_active_loans INT NOT NULL DEFAULT 5 CHECK (max_active_loans >= 0),
    max_loan_days INT NOT NULL DEFAULT 14 CHECK (max_loan_days > 0),
    max_renewal_count INT NOT NULL DEFAULT 2 CHECK (max_renewal_count >= 0),
    reservation_hold_hours INT NOT NULL DEFAULT 24 CHECK (reservation_hold_hours > 0 AND reservation_hold_hours <= 168),
    fine_per_day NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (fine_per_day >= 0),
    lost_item_fee_multiplier NUMERIC(5, 2) NOT NULL DEFAULT 1.00 CHECK (lost_item_fee_multiplier >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES membership_plans(id) ON DELETE RESTRICT,
    card_number VARCHAR(40) NOT NULL UNIQUE,
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED')),
    max_active_loans_override INT CHECK (max_active_loans_override IS NULL OR max_active_loans_override >= 0),
    max_loan_days_override INT CHECK (max_loan_days_override IS NULL OR max_loan_days_override > 0),
    note TEXT,
    CHECK (end_date IS NULL OR end_date >= start_date),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_preferences (
    customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
    notify_email BOOLEAN NOT NULL DEFAULT TRUE,
    notify_sms BOOLEAN NOT NULL DEFAULT FALSE,
    notify_in_app BOOLEAN NOT NULL DEFAULT TRUE,
    preferred_language VARCHAR(10) NOT NULL DEFAULT 'vi',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loan_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_number VARCHAR(40) NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL,
    inventory_unit_id UUID,
    warehouse_id UUID NOT NULL,
    pickup_location_id UUID,
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    source_channel VARCHAR(20) NOT NULL DEFAULT 'WEB'
        CHECK (source_channel IN ('WEB', 'MOBILE', 'COUNTER', 'ADMIN')),
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'CONFIRMED', 'READY_FOR_PICKUP', 'CANCELLED', 'EXPIRED', 'CONVERTED_TO_LOAN')),
    reserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    notes TEXT,
    CHECK (expires_at > reserved_at),
    created_by_user_id UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loan_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_number VARCHAR(40) NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL,
    handled_by_user_id UUID NOT NULL,
    source_reservation_id UUID REFERENCES loan_reservations(id) ON DELETE SET NULL,
    borrow_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    due_date TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'BORROWED'
        CHECK (status IN ('RESERVED', 'BORROWED', 'RETURNED', 'OVERDUE', 'LOST', 'CANCELLED')),
    total_items INT NOT NULL DEFAULT 0 CHECK (total_items >= 0),
    notes TEXT,
    CHECK (due_date >= borrow_date),
    CHECK (closed_at IS NULL OR closed_at >= borrow_date),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loan_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id UUID NOT NULL REFERENCES loan_transactions(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL,
    inventory_unit_id UUID,
    item_barcode VARCHAR(100),
    due_date TIMESTAMPTZ NOT NULL,
    return_date TIMESTAMPTZ,
    returned_to_warehouse_id UUID,
    returned_to_location_id UUID,
    item_condition_on_checkout VARCHAR(20) NOT NULL DEFAULT 'GOOD'
        CHECK (item_condition_on_checkout IN ('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED')),
    item_condition_on_return VARCHAR(20)
        CHECK (item_condition_on_return IS NULL OR item_condition_on_return IN ('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED')),
    status VARCHAR(20) NOT NULL DEFAULT 'BORROWED'
        CHECK (status IN ('RESERVED', 'BORROWED', 'RETURNED', 'OVERDUE', 'LOST', 'DAMAGED')),
    fine_amount NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (fine_amount >= 0),
    lost_fee_amount NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (lost_fee_amount >= 0),
    notes TEXT
);

CREATE TABLE IF NOT EXISTS loan_renewals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_item_id UUID NOT NULL REFERENCES loan_items(id) ON DELETE CASCADE,
    renewed_by_user_id UUID,
    renewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    old_due_date TIMESTAMPTZ NOT NULL,
    new_due_date TIMESTAMPTZ NOT NULL,
    renewal_count INT NOT NULL CHECK (renewal_count > 0),
    CHECK (new_due_date > old_due_date),
    reason TEXT
);

CREATE TABLE IF NOT EXISTS fines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    loan_item_id UUID REFERENCES loan_items(id) ON DELETE SET NULL,
    fine_type VARCHAR(20) NOT NULL
        CHECK (fine_type IN ('OVERDUE', 'DAMAGE', 'LOST', 'OTHER')),
    amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
    waived_amount NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (waived_amount >= 0 AND waived_amount <= amount),
    status VARCHAR(20) NOT NULL DEFAULT 'UNPAID'
        CHECK (status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'WAIVED')),
    issued_by_user_id UUID,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    paid_at TIMESTAMPTZ,
    waived_by_user_id UUID,
    note TEXT
);

CREATE TABLE IF NOT EXISTS fine_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fine_id UUID NOT NULL REFERENCES fines(id) ON DELETE CASCADE,
    payment_method VARCHAR(20) NOT NULL
        CHECK (payment_method IN ('CASH', 'CARD', 'TRANSFER', 'EWALLET')),
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    transaction_reference TEXT,
    paid_by_user_id UUID,
    paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    note TEXT
);

CREATE TABLE IF NOT EXISTS customer_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    channel VARCHAR(20) NOT NULL
        CHECK (channel IN ('EMAIL', 'SMS', 'IN_APP')),
    template_code VARCHAR(50),
    subject VARCHAR(200),
    body TEXT NOT NULL,
    reference_type VARCHAR(50),
    reference_id UUID,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'READ')),
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE TABLE IF NOT EXISTS borrow_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID,
    action_name VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    before_data JSONB,
    after_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id UUID,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    headers JSONB NOT NULL DEFAULT '{}'::JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
    retry_count INT NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS integration_inbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_service VARCHAR(50) NOT NULL,
    event_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED'
        CHECK (status IN ('RECEIVED', 'PROCESSED', 'FAILED')),
    error_message TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    UNIQUE (source_service, event_id)
);

CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customer_memberships_customer_id ON customer_memberships(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_memberships_status ON customer_memberships(status);
CREATE INDEX IF NOT EXISTS idx_loan_reservations_status_expires ON loan_reservations(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_loan_transactions_customer_id ON loan_transactions(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_loan_transactions_due_date ON loan_transactions(due_date, status);
CREATE INDEX IF NOT EXISTS idx_loan_items_status_due_date ON loan_items(status, due_date);
CREATE INDEX IF NOT EXISTS idx_fines_customer_id ON fines(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_customer_notifications_status ON customer_notifications(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_borrow_outbox_status ON integration_outbox(status, occurred_at);
CREATE INDEX IF NOT EXISTS idx_borrow_inbox_status ON integration_inbox(status, received_at);

INSERT INTO membership_plans (
    code,
    name,
    description,
    max_active_loans,
    max_loan_days,
    max_renewal_count,
    reservation_hold_hours,
    fine_per_day,
    lost_item_fee_multiplier,
    is_active
)
VALUES
    ('STANDARD', 'Standard', 'Default borrow plan for regular members', 5, 14, 2, 24, 5000, 1.00, TRUE),
    ('PREMIUM', 'Premium', 'Higher quota and longer due date for premium members', 10, 30, 3, 48, 3000, 1.00, TRUE)
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'customers',
        'membership_plans',
        'customer_memberships',
        'customer_preferences',
        'loan_reservations',
        'loan_transactions'
    ]
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I;', tbl, tbl);
        EXECUTE format(
            'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
            tbl, tbl
        );
    END LOOP;
END $$;

COMMIT;

\connect ai_db
\encoding UTF8
SET client_min_messages TO warning;

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS model_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_name VARCHAR(100) NOT NULL,
    version_label VARCHAR(50) NOT NULL,
    task_type VARCHAR(20) NOT NULL
        CHECK (task_type IN ('OCR', 'BARCODE', 'MATCHING', 'FORECAST_ASSIST')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metrics JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (model_name, version_label)
);

CREATE TABLE IF NOT EXISTS ai_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    storage_provider VARCHAR(20) NOT NULL DEFAULT 'LOCAL'
        CHECK (storage_provider IN ('LOCAL', 'S3', 'CLOUDINARY', 'OTHER')),
    object_key TEXT NOT NULL UNIQUE,
    original_file_name TEXT,
    mime_type VARCHAR(100),
    file_size BIGINT CHECK (file_size IS NULL OR file_size >= 0),
    checksum_sha256 CHAR(64),
    uploaded_by_user_id UUID,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recognition_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_number VARCHAR(40) NOT NULL UNIQUE,
    asset_id UUID NOT NULL REFERENCES ai_assets(id) ON DELETE CASCADE,
    requested_by_user_id UUID,
    warehouse_id UUID,
    source_type VARCHAR(20) NOT NULL DEFAULT 'IMAGE_UPLOAD'
        CHECK (source_type IN ('IMAGE_UPLOAD', 'BARCODE_SCAN', 'BATCH_IMPORT')),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
    model_version_id UUID REFERENCES model_versions(id) ON DELETE SET NULL,
    correlation_id UUID,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recognition_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL UNIQUE REFERENCES recognition_jobs(id) ON DELETE CASCADE,
    extracted_isbn10 VARCHAR(20),
    extracted_isbn13 VARCHAR(20),
    barcode_value VARCHAR(100),
    extracted_title TEXT,
    extracted_authors TEXT,
    extracted_publisher TEXT,
    extracted_publish_year INT CHECK (extracted_publish_year IS NULL OR extracted_publish_year BETWEEN 1000 AND 2100),
    confidence_score NUMERIC(5, 4) CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
    raw_ocr_text TEXT,
    normalized_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    google_books_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    matched_book_id UUID,
    matched_variant_id UUID,
    review_status VARCHAR(20) NOT NULL DEFAULT 'PENDING_REVIEW'
        CHECK (review_status IN ('PENDING_REVIEW', 'AUTO_ACCEPTED', 'VERIFIED', 'REJECTED')),
    human_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_by_user_id UUID,
    verified_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recognition_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES recognition_jobs(id) ON DELETE CASCADE,
    result_id UUID REFERENCES recognition_results(id) ON DELETE CASCADE,
    reviewed_by_user_id UUID NOT NULL,
    accepted BOOLEAN NOT NULL,
    corrected_isbn13 VARCHAR(20),
    corrected_title TEXT,
    corrected_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID,
    action_name VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    before_data JSONB,
    after_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id UUID,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    headers JSONB NOT NULL DEFAULT '{}'::JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
    retry_count INT NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS integration_inbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_service VARCHAR(50) NOT NULL,
    event_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED'
        CHECK (status IN ('RECEIVED', 'PROCESSED', 'FAILED')),
    error_message TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    UNIQUE (source_service, event_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_assets_uploaded_at ON ai_assets(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_recognition_jobs_status ON recognition_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recognition_jobs_requested_by ON recognition_jobs(requested_by_user_id);
CREATE INDEX IF NOT EXISTS idx_recognition_results_review_status ON recognition_results(review_status, human_verified);
CREATE INDEX IF NOT EXISTS idx_ai_outbox_status ON integration_outbox(status, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ai_inbox_status ON integration_inbox(status, received_at);

INSERT INTO model_versions (model_name, version_label, task_type, is_active, metrics)
VALUES
    ('ocr-isbn', 'v1', 'OCR', TRUE, '{}'::JSONB),
    ('barcode-reader', 'v1', 'BARCODE', TRUE, '{}'::JSONB)
ON CONFLICT (model_name, version_label) DO NOTHING;

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY['recognition_jobs', 'recognition_results']
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I;', tbl, tbl);
        EXECUTE format(
            'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
            tbl, tbl
        );
    END LOOP;
END $$;

COMMIT;

\connect analytics_db
\encoding UTF8
SET client_min_messages TO warning;

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS forecast_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_name VARCHAR(100) NOT NULL,
    model_name VARCHAR(100) NOT NULL,
    model_version VARCHAR(50),
    warehouse_id UUID,
    target_month DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'RUNNING'
        CHECK (status IN ('DRAFT', 'RUNNING', 'COMPLETED', 'FAILED', 'PUBLISHED')),
    triggered_by_user_id UUID,
    parameters JSONB NOT NULL DEFAULT '{}'::JSONB,
    metrics JSONB NOT NULL DEFAULT '{}'::JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    note TEXT,
    CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE TABLE IF NOT EXISTS demand_forecasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES forecast_runs(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    target_month DATE NOT NULL,
    predicted_demand_qty INT NOT NULL CHECK (predicted_demand_qty >= 0),
    confidence_lower INT CHECK (confidence_lower IS NULL OR confidence_lower >= 0),
    confidence_upper INT CHECK (confidence_upper IS NULL OR confidence_upper >= 0),
    recommended_reorder_qty INT NOT NULL DEFAULT 0 CHECK (recommended_reorder_qty >= 0),
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (run_id, variant_id, warehouse_id, target_month)
);

CREATE TABLE IF NOT EXISTS location_heatmaps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL,
    location_id UUID NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    pick_frequency INT NOT NULL DEFAULT 0 CHECK (pick_frequency >= 0),
    putaway_frequency INT NOT NULL DEFAULT 0 CHECK (putaway_frequency >= 0),
    score NUMERIC(10, 4) NOT NULL DEFAULT 0,
    category VARCHAR(20) NOT NULL
        CHECK (category IN ('HOT', 'WARM', 'COLD')),
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (period_end >= period_start),
    UNIQUE (location_id, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS stock_kpi_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL,
    snapshot_date DATE NOT NULL,
    total_titles INT NOT NULL DEFAULT 0 CHECK (total_titles >= 0),
    total_units INT NOT NULL DEFAULT 0 CHECK (total_units >= 0),
    available_units INT NOT NULL DEFAULT 0 CHECK (available_units >= 0),
    reserved_units INT NOT NULL DEFAULT 0 CHECK (reserved_units >= 0),
    borrowed_units INT NOT NULL DEFAULT 0 CHECK (borrowed_units >= 0),
    out_of_stock_titles INT NOT NULL DEFAULT 0 CHECK (out_of_stock_titles >= 0),
    low_stock_titles INT NOT NULL DEFAULT 0 CHECK (low_stock_titles >= 0),
    ageing_titles INT NOT NULL DEFAULT 0 CHECK (ageing_titles >= 0),
    turnover_ratio NUMERIC(10, 4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (warehouse_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS ageing_stock_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL,
    variant_id UUID NOT NULL,
    snapshot_date DATE NOT NULL,
    days_in_stock INT NOT NULL CHECK (days_in_stock >= 0),
    on_hand_qty INT NOT NULL CHECK (on_hand_qty >= 0),
    inventory_value NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (inventory_value >= 0),
    ageing_bucket VARCHAR(20) NOT NULL
        CHECK (ageing_bucket IN ('0_30', '31_60', '61_90', '91_180', '181_PLUS')),
    UNIQUE (warehouse_id, variant_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS purchase_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID REFERENCES forecast_runs(id) ON DELETE SET NULL,
    warehouse_id UUID NOT NULL,
    variant_id UUID NOT NULL,
    suggested_qty INT NOT NULL CHECK (suggested_qty > 0),
    reason_text TEXT,
    priority_score NUMERIC(10, 4) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'GENERATED'
        CHECK (status IN ('GENERATED', 'REVIEWED', 'APPROVED', 'REJECTED', 'ORDERED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_by_user_id UUID,
    reviewed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS relocation_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL,
    variant_id UUID NOT NULL,
    from_location_id UUID,
    to_location_id UUID,
    heat_score_before NUMERIC(10, 4),
    heat_score_after NUMERIC(10, 4),
    reason_text TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'GENERATED'
        CHECK (status IN ('GENERATED', 'REVIEWED', 'APPROVED', 'REJECTED', 'APPLIED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_by_user_id UUID,
    reviewed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS analytics_query_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requested_by_user_id UUID,
    source_channel VARCHAR(20) NOT NULL
        CHECK (source_channel IN ('DASHBOARD', 'CHATBOT', 'API', 'CRON')),
    query_name VARCHAR(100) NOT NULL,
    request_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    response_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    latency_ms INT CHECK (latency_ms IS NULL OR latency_ms >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS'
        CHECK (status IN ('SUCCESS', 'FAILED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id UUID,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    headers JSONB NOT NULL DEFAULT '{}'::JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
    retry_count INT NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS integration_inbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_service VARCHAR(50) NOT NULL,
    event_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED'
        CHECK (status IN ('RECEIVED', 'PROCESSED', 'FAILED')),
    error_message TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    UNIQUE (source_service, event_id)
);

CREATE INDEX IF NOT EXISTS idx_forecast_runs_status ON forecast_runs(status, target_month);
CREATE INDEX IF NOT EXISTS idx_demand_forecasts_variant_month ON demand_forecasts(variant_id, target_month);
CREATE INDEX IF NOT EXISTS idx_location_heatmaps_period ON location_heatmaps(period_start, period_end, category);
CREATE INDEX IF NOT EXISTS idx_stock_kpi_snapshots_date ON stock_kpi_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_ageing_stock_snapshots_bucket ON ageing_stock_snapshots(ageing_bucket, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_purchase_recommendations_status ON purchase_recommendations(status, created_at);
CREATE INDEX IF NOT EXISTS idx_relocation_recommendations_status ON relocation_recommendations(status, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_outbox_status ON integration_outbox(status, occurred_at);
CREATE INDEX IF NOT EXISTS idx_analytics_inbox_status ON integration_inbox(status, received_at);

COMMIT;

\connect chatbot_db
\encoding UTF8
SET client_min_messages TO warning;

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_code VARCHAR(40) NOT NULL UNIQUE,
    started_by_type VARCHAR(20) NOT NULL
        CHECK (started_by_type IN ('USER', 'CUSTOMER', 'SYSTEM')),
    started_by_user_id UUID,
    started_by_customer_id UUID,
    channel VARCHAR(20) NOT NULL DEFAULT 'WEB'
        CHECK (channel IN ('WEB', 'MOBILE', 'ADMIN')),
    title VARCHAR(200),
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'CLOSED', 'ARCHIVED')),
    context JSONB NOT NULL DEFAULT '{}'::JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    sender_type VARCHAR(20) NOT NULL
        CHECK (sender_type IN ('USER', 'CUSTOMER', 'BOT', 'SYSTEM')),
    sender_user_id UUID,
    sender_customer_id UUID,
    content_type VARCHAR(20) NOT NULL DEFAULT 'TEXT'
        CHECK (content_type IN ('TEXT', 'CARD', 'CHART', 'TABLE', 'SYSTEM')),
    content TEXT NOT NULL,
    model_name VARCHAR(100),
    prompt_tokens INT CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
    completion_tokens INT CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
    tool_calls JSONB NOT NULL DEFAULT '[]'::JSONB,
    citations JSONB NOT NULL DEFAULT '[]'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_query_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
    user_message_id UUID,
    sql_text TEXT,
    data_source VARCHAR(100),
    intent VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS'
        CHECK (status IN ('SUCCESS', 'FAILED')),
    latency_ms INT CHECK (latency_ms IS NULL OR latency_ms >= 0),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_saved_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    report_type VARCHAR(20) NOT NULL
        CHECK (report_type IN ('KPI', 'FORECAST', 'HEATMAP', 'OVERDUE', 'CUSTOM')),
    payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_by_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_by_user_id UUID,
    created_by_customer_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id UUID,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    headers JSONB NOT NULL DEFAULT '{}'::JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
    retry_count INT NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS integration_inbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_service VARCHAR(50) NOT NULL,
    event_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED'
        CHECK (status IN ('RECEIVED', 'PROCESSED', 'FAILED')),
    error_message TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    UNIQUE (source_service, event_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON chat_sessions(status, started_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_query_logs_session_id ON chat_query_logs(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_saved_reports_created_at ON chat_saved_reports(created_at);
CREATE INDEX IF NOT EXISTS idx_chatbot_outbox_status ON integration_outbox(status, occurred_at);
CREATE INDEX IF NOT EXISTS idx_chatbot_inbox_status ON integration_inbox(status, received_at);

COMMIT;
