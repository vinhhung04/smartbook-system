-- SmartBook Sample Seed Data
-- Consolidated seed for: auth_db, inventory_db, borrow_db
-- Run AFTER schema has been created (prisma db push or docker init scripts).
-- Uses ON CONFLICT DO NOTHING for idempotent inserts.
-- Set ON_ERROR_STOP=off so partial runs (e.g. missing DB) don't abort.

SET client_encoding = 'UTF8';
\set ON_ERROR_STOP off

-- ============================================================
-- AUTH_DB
-- ============================================================
\connect auth_db
BEGIN;

INSERT INTO permissions (code, module_name, action_name, description) VALUES
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

INSERT INTO roles (code, name, description, is_system) VALUES
    ('ADMIN', 'Administrator', 'Full access to platform configuration and IAM', TRUE),
    ('MANAGER', 'Manager', 'Can monitor operations, analytics and approvals', TRUE),
    ('STAFF', 'Staff', 'Can operate warehouse and borrow workflows', TRUE)
ON CONFLICT (code) DO NOTHING;

-- ADMIN gets all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON TRUE WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;

-- MANAGER gets inventory + borrow read + analytics + chatbot + observability
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code IN (
    'inventory.catalog.read', 'inventory.stock.read', 'inventory.purchase.approve',
    'borrow.read', 'analytics.read', 'chatbot.use', 'observability.read'
) WHERE r.code = 'MANAGER'
ON CONFLICT DO NOTHING;

-- STAFF gets inventory + borrow read/write + ai + chatbot
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code IN (
    'inventory.catalog.read', 'inventory.stock.read', 'inventory.stock.write',
    'borrow.read', 'borrow.write', 'ai.read', 'ai.write', 'chatbot.use'
) WHERE r.code = 'STAFF'
ON CONFLICT DO NOTHING;

-- Users
-- Password hashes are bcrypt(10) of 'password123' and 'demo_password'
INSERT INTO users (
    id, username, email, password_hash, full_name, phone, status,
    primary_warehouse_id, is_superuser, failed_login_attempts, last_login_at
) VALUES
    ('00000000-0000-0000-0000-000000000101', 'admin.smartbook', 'admin@smartbook.local', '$2b$12$demo_admin_hash', 'System Admin', '0901000001', 'ACTIVE', '00000000-0000-0000-0000-000000000461', TRUE, 0, '2026-03-14 08:30:00+07'),
    ('00000000-0000-0000-0000-000000000102', 'manager.hcm', 'manager.hcm@smartbook.local', '$2b$12$demo_manager_hash', 'HCM Library Manager', '0901000002', 'ACTIVE', '00000000-0000-0000-0000-000000000461', FALSE, 0, '2026-03-14 08:15:00+07'),
    ('00000000-0000-0000-0000-000000000103', 'staff.counter', 'staff.counter@smartbook.local', '$2b$12$demo_staff_hash', 'Counter Staff', '0901000003', 'ACTIVE', '00000000-0000-0000-0000-000000000461', FALSE, 1, '2026-03-13 17:40:00+07'),
    ('00000000-0000-0000-0000-000000000104', 'hung', 'hung@smartbook.local', '$2b$10$7Du0qLbFMsVmDremJzRrX.QMMydqBYI7aR83PnG2Ifbte/7ZrSzAG', 'Hung Admin', '0912345678', 'ACTIVE', '00000000-0000-0000-0000-000000000461', TRUE, 0, '2026-03-14 08:30:00+07'),
    ('00000000-0000-0000-0000-000000000105', 'khoa', 'khoa@smartbook.local', '$2b$10$7Du0qLbFMsVmDremJzRrX.QMMydqBYI7aR83PnG2Ifbte/7ZrSzAG', 'Khoa Admin', '0912345679', 'ACTIVE', '00000000-0000-0000-0000-000000000461', TRUE, 0, '2026-03-14 08:30:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_roles (user_id, role_id, assigned_by_user_id, assigned_at, expires_at)
SELECT * FROM (
    SELECT '00000000-0000-0000-0000-000000000101'::uuid, r.id, '00000000-0000-0000-0000-000000000101'::uuid, '2026-03-01 09:00:00+07'::timestamptz, NULL::timestamptz FROM roles r WHERE r.code = 'ADMIN'
    UNION ALL
    SELECT '00000000-0000-0000-0000-000000000102'::uuid, r.id, '00000000-0000-0000-0000-000000000101'::uuid, '2026-03-01 09:10:00+07'::timestamptz, NULL::timestamptz FROM roles r WHERE r.code = 'MANAGER'
    UNION ALL
    SELECT '00000000-0000-0000-0000-000000000103'::uuid, r.id, '00000000-0000-0000-0000-000000000102'::uuid, '2026-03-01 09:15:00+07'::timestamptz, NULL::timestamptz FROM roles r WHERE r.code = 'STAFF'
    UNION ALL
    SELECT '00000000-0000-0000-0000-000000000104'::uuid, r.id, '00000000-0000-0000-0000-000000000101'::uuid, '2026-03-01 09:00:00+07'::timestamptz, NULL::timestamptz FROM roles r WHERE r.code = 'ADMIN'
    UNION ALL
    SELECT '00000000-0000-0000-0000-000000000105'::uuid, r.id, '00000000-0000-0000-0000-000000000101'::uuid, '2026-03-01 09:00:00+07'::timestamptz, NULL::timestamptz FROM roles r WHERE r.code = 'ADMIN'
) AS x(user_id, role_id, assigned_by_user_id, assigned_at, expires_at)
ON CONFLICT DO NOTHING;

INSERT INTO user_warehouse_scopes (
    id, user_id, warehouse_id, access_level, assigned_by_user_id, created_at
) VALUES
    ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000461', 'ADMIN',  '00000000-0000-0000-0000-000000000101', '2026-03-01 09:20:00+07'),
    ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000461', 'MANAGE', '00000000-0000-0000-0000-000000000101', '2026-03-01 09:21:00+07'),
    ('00000000-0000-0000-0000-000000000113', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000461', 'OPERATE','00000000-0000-0000-0000-000000000102', '2026-03-01 09:22:00+07'),
    ('00000000-0000-0000-0000-000000000114', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000462', 'VIEW',   '00000000-0000-0000-0000-000000000101', '2026-03-01 09:23:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO refresh_tokens (
    id, user_id, token_hash, user_agent, ip_address, expires_at, revoked_at, created_at
) VALUES
    ('00000000-0000-0000-0000-000000000121', '00000000-0000-0000-0000-000000000102', 'rt_hash_demo_manager_01', 'Chrome on Windows', '192.168.1.10', '2026-03-21 08:15:00+07', NULL, '2026-03-14 08:15:00+07'),
    ('00000000-0000-0000-0000-000000000122', '00000000-0000-0000-0000-000000000103', 'rt_hash_demo_staff_01',   'Edge on Windows',   '192.168.1.11', '2026-03-20 17:40:00+07', NULL, '2026-03-13 17:40:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO password_reset_tokens (
    id, user_id, token_hash, expires_at, used_at, created_at
) VALUES
    ('00000000-0000-0000-0000-000000000131', '00000000-0000-0000-0000-000000000103', 'pr_hash_demo_staff_01', '2026-03-16 10:00:00+07', NULL, '2026-03-14 09:00:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth_audit_logs (
    id, actor_user_id, action_name, entity_type, entity_id, detail, ip_address, user_agent, created_at
) VALUES
    ('00000000-0000-0000-0000-000000000141', '00000000-0000-0000-0000-000000000101', 'ASSIGN_ROLE', 'USER', '00000000-0000-0000-0000-000000000103', '{"role":"STAFF"}'::jsonb, '192.168.1.10', 'Chrome on Windows', '2026-03-01 09:15:00+07'),
    ('00000000-0000-0000-0000-000000000142', '00000000-0000-0000-0000-000000000103', 'LOGIN_SUCCESS', 'USER', '00000000-0000-0000-0000-000000000103', '{"channel":"web"}'::jsonb, '192.168.1.11', 'Edge on Windows', '2026-03-13 17:40:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO integration_outbox (
    id, aggregate_type, aggregate_id, event_type, payload, headers, status, retry_count, occurred_at, published_at
) VALUES
    ('00000000-0000-0000-0000-000000000151', 'USER', '00000000-0000-0000-0000-000000000103', 'auth.user.updated', '{"user_id":"00000000-0000-0000-0000-000000000103","status":"ACTIVE"}'::jsonb, '{"trace_id":"auth-demo-001"}'::jsonb, 'PUBLISHED', 0, '2026-03-13 17:40:00+07', '2026-03-13 17:40:05+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO integration_inbox (
    id, source_service, event_id, event_type, payload, status, error_message, received_at, processed_at
) VALUES
    ('00000000-0000-0000-0000-000000000161', 'inventory', '00000000-0000-0000-0000-000000000601', 'inventory.stock.low', '{"warehouse_id":"00000000-0000-0000-0000-000000000461","variant_id":"00000000-0000-0000-0000-000000000442"}'::jsonb, 'PROCESSED', NULL, '2026-03-14 08:35:00+07', '2026-03-14 08:35:01+07')
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ============================================================
-- INVENTORY_DB
-- ============================================================
\connect inventory_db
BEGIN;

-- Publishers
INSERT INTO publishers (id, code, name, phone, email, website, address, country) VALUES
    ('00000000-0000-0000-0000-000000000401', 'PUB-TP', 'Tech Press', '0281000001', 'contact@techpress.local', 'https://techpress.local', 'District 1, HCM City', 'Vietnam'),
    ('00000000-0000-0000-0000-000000000402', 'PUB-DP', 'Data Press', '0281000002', 'hello@datapress.local', 'https://datapress.local', 'Ha Noi', 'Vietnam')
ON CONFLICT (id) DO NOTHING;

-- Authors
INSERT INTO authors (id, full_name, sort_name, biography) VALUES
    ('00000000-0000-0000-0000-000000000411', 'Pham Minh Duc', 'Duc, Pham Minh', 'Writes about software architecture and backend systems.'),
    ('00000000-0000-0000-0000-000000000412', 'Le Minh',       'Minh, Le',       'Writes about data science and analytics.'),
    ('00000000-0000-0000-0000-000000000413', 'Tran Ha',       'Ha, Tran',       'Writes about library operations and customer service.')
ON CONFLICT (id) DO NOTHING;

-- Categories
INSERT INTO categories (id, name, slug, parent_id, description) VALUES
    ('00000000-0000-0000-0000-000000000421', 'Technology',   'technology',   NULL, 'Top level technology books.'),
    ('00000000-0000-0000-0000-000000000422', 'Databases',    'databases',    '00000000-0000-0000-0000-000000000421', 'Database design and SQL.'),
    ('00000000-0000-0000-0000-000000000423', 'AI Analytics', 'ai-analytics', '00000000-0000-0000-0000-000000000421', 'AI, ML and analytics titles.')
ON CONFLICT (id) DO NOTHING;

-- Books
INSERT INTO books (
    id, book_code, title, subtitle, description, publisher_id, edition, published_date,
    page_count, country_of_origin, default_language, is_active, metadata
) VALUES
    ('00000000-0000-0000-0000-000000000431', 'BOOK-DB-001', 'Practical PostgreSQL', 'Design and Performance', 'Reference book for SQL and schema design.', '00000000-0000-0000-0000-000000000401', '2nd', '2024-04-10', 420, 'Vietnam', 'en', TRUE, '{"topic":"database"}'::jsonb),
    ('00000000-0000-0000-0000-000000000432', 'BOOK-ML-001', 'Intro to Machine Learning', 'From Data to Prediction', 'A starter guide for machine learning workflows.', '00000000-0000-0000-0000-000000000402', '1st', '2024-09-15', 360, 'Vietnam', 'en', TRUE, '{"topic":"ml"}'::jsonb),
    ('00000000-0000-0000-0000-000000000433', 'BOOK-LIB-001', 'Library Operations Handbook', NULL, 'Operational handbook for borrowing, stock and service desks.', '00000000-0000-0000-0000-000000000401', '3rd', '2023-01-20', 280, 'Vietnam', 'en', TRUE, '{"topic":"operations"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Book Authors
INSERT INTO book_authors (book_id, author_id, author_order) VALUES
    ('00000000-0000-0000-0000-000000000431', '00000000-0000-0000-0000-000000000411', 1),
    ('00000000-0000-0000-0000-000000000432', '00000000-0000-0000-0000-000000000412', 1),
    ('00000000-0000-0000-0000-000000000433', '00000000-0000-0000-0000-000000000413', 1)
ON CONFLICT DO NOTHING;

-- Book Categories
INSERT INTO book_categories (book_id, category_id) VALUES
    ('00000000-0000-0000-0000-000000000431', '00000000-0000-0000-0000-000000000422'),
    ('00000000-0000-0000-0000-000000000432', '00000000-0000-0000-0000-000000000423'),
    ('00000000-0000-0000-0000-000000000433', '00000000-0000-0000-0000-000000000421')
ON CONFLICT DO NOTHING;

-- Book Variants
INSERT INTO book_variants (
    id, book_id, sku, isbn13, isbn10, internal_barcode, cover_type, language_code,
    publish_year, condition_grade, unit_cost, list_price, replacement_cost,
    is_borrowable, is_sellable, is_track_by_unit, cover_image_url, metadata, is_active
) VALUES
    ('00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000431', 'SKU-DB-001',  '9786040000001', '6040000001', 'BC-DB-001',  'PAPERBACK', 'en', 2024, 'NEW', 85000,  135000, 150000, TRUE, TRUE,  FALSE, 'https://img.local/db001.jpg', '{"edition":"2nd"}'::jsonb, TRUE),
    ('00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000432', 'SKU-ML-001',  '9786040000002', '6040000002', 'BC-ML-001',  'HARDCOVER', 'en', 2024, 'NEW', 120000, 189000, 210000, TRUE, TRUE,  TRUE,  'https://img.local/ml001.jpg', '{"edition":"1st"}'::jsonb, TRUE),
    ('00000000-0000-0000-0000-000000000443', '00000000-0000-0000-0000-000000000433', 'SKU-LIB-001', '9786040000003', '6040000003', 'BC-LIB-001', 'PAPERBACK', 'en', 2023, 'GOOD', 60000,  99000,  120000, TRUE, FALSE, TRUE,  'https://img.local/lib001.jpg','{"edition":"3rd"}'::jsonb, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Book Images
INSERT INTO book_images (id, book_id, variant_id, image_url, image_type, is_primary) VALUES
    ('00000000-0000-0000-0000-000000000444', '00000000-0000-0000-0000-000000000431', NULL,                             'https://img.local/book-db-cover.jpg',    'COVER', TRUE),
    ('00000000-0000-0000-0000-000000000445', NULL,                            '00000000-0000-0000-0000-000000000442', 'https://img.local/variant-ml-back.jpg', 'BACK',  FALSE)
ON CONFLICT (id) DO NOTHING;

-- Suppliers
INSERT INTO suppliers (id, code, name, contact_name, phone, email, address, tax_code, status) VALUES
    ('00000000-0000-0000-0000-000000000451', 'SUP-NB', 'North Books Supply',      'Ms Linh', '0241000001', 'sales@northbooks.local',     'Ha Noi',    'TAX001', 'ACTIVE'),
    ('00000000-0000-0000-0000-000000000452', 'SUP-SA', 'Saigon Academic Supply',   'Mr Long', '0281000003', 'sales@saigonacademic.local',  'HCM City',  'TAX002', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- Supplier Variants
INSERT INTO supplier_variants (id, supplier_id, variant_id, supplier_sku, lead_time_days, default_cost, min_order_qty, is_preferred, created_at) VALUES
    ('00000000-0000-0000-0000-000000000453', '00000000-0000-0000-0000-000000000451', '00000000-0000-0000-0000-000000000441', 'NB-DB-001', 5, 85000,  5, TRUE,  '2026-03-01 10:00:00+07'),
    ('00000000-0000-0000-0000-000000000454', '00000000-0000-0000-0000-000000000452', '00000000-0000-0000-0000-000000000442', 'SA-ML-001', 7, 120000, 3, TRUE,  '2026-03-01 10:05:00+07'),
    ('00000000-0000-0000-0000-000000000455', '00000000-0000-0000-0000-000000000452', '00000000-0000-0000-0000-000000000443', 'SA-LIB-001',3, 60000,  2, FALSE, '2026-03-01 10:10:00+07')
ON CONFLICT (id) DO NOTHING;

-- Warehouses
INSERT INTO warehouses (id, code, name, warehouse_type, address_line1, address_line2, ward, district, province, country, manager_user_id, is_active) VALUES
    ('00000000-0000-0000-0000-000000000461', 'WH-HCM-01', 'HCM Central Library', 'LIBRARY', '123 Nguyen Hue', NULL, 'Ben Nghe', 'District 1', 'HCM City', 'Vietnam', '00000000-0000-0000-0000-000000000102', TRUE),
    ('00000000-0000-0000-0000-000000000462', 'WH-HN-01',  'Ha Noi Branch',      'BRANCH',  '88 Kim Ma',      NULL, 'Ngoc Khanh', 'Ba Dinh',   'Ha Noi',   'Vietnam', '00000000-0000-0000-0000-000000000101', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Warehouse Settings
INSERT INTO warehouse_settings (warehouse_id, reservation_hold_hours, allow_negative_stock, default_low_stock_threshold, enable_cycle_count, created_at, updated_at) VALUES
    ('00000000-0000-0000-0000-000000000461', 24, FALSE, 5, TRUE, '2026-03-01 10:30:00+07', '2026-03-01 10:30:00+07'),
    ('00000000-0000-0000-0000-000000000462', 48, FALSE, 3, TRUE, '2026-03-01 10:31:00+07', '2026-03-01 10:31:00+07')
ON CONFLICT (warehouse_id) DO NOTHING;

-- Locations (HCM warehouse)
INSERT INTO locations (
    id, warehouse_id, parent_location_id, location_code, location_type, zone, aisle, shelf, bin,
    barcode, capacity_qty, available, is_pickable, is_active
) VALUES
    ('00000000-0000-0000-0000-000000000471', '00000000-0000-0000-0000-000000000461', NULL,                            'RCV-HCM',  'RECEIVING',         NULL, NULL, NULL, NULL, 'LOC-RCV-HCM',  500, 0, FALSE, TRUE),
    ('00000000-0000-0000-0000-000000004720', '00000000-0000-0000-0000-000000000461', NULL,                            'A',        'ZONE',              'A',   NULL, NULL, NULL, 'LOC-HCM-ZA',   NULL, 0, FALSE, TRUE),
    ('00000000-0000-0000-0000-000000004721', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000004720', 'A-01',    'SHELF',             'A',   NULL, '01', NULL, 'LOC-HCM-S-A01',NULL, 0, FALSE, TRUE),
    ('00000000-0000-0000-0000-000000000472', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000004721', 'A-01-01', 'SHELF_COMPARTMENT', 'A',   NULL, '01', '01', 'LOC-HCM-A0101', 100, 0, TRUE,  TRUE),
    ('00000000-0000-0000-0000-000000004730', '00000000-0000-0000-0000-000000000461', NULL,                            'B',        'ZONE',              'B',   NULL, NULL, NULL, 'LOC-HCM-ZB',   NULL, 0, FALSE, TRUE),
    ('00000000-0000-0000-0000-000000004731', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000004730', 'B-01',    'SHELF',             'B',   NULL, '01', NULL, 'LOC-HCM-S-B01',NULL, 0, FALSE, TRUE),
    ('00000000-0000-0000-0000-000000000473', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000004731', 'B-01-02', 'SHELF_COMPARTMENT', 'B',   NULL, '01', '02', 'LOC-HCM-B0102', 100, 0, TRUE,  TRUE)
ON CONFLICT (id) DO NOTHING;

-- Locations (Ha Noi warehouse)
INSERT INTO locations (
    id, warehouse_id, parent_location_id, location_code, location_type, zone, aisle, shelf, bin,
    barcode, capacity_qty, available, is_pickable, is_active
) VALUES
    ('00000000-0000-0000-0000-000000000474', '00000000-0000-0000-0000-000000000462', NULL,                            'RCV-HN',   'RECEIVING',         NULL, NULL, NULL, NULL, 'LOC-RCV-HN',   300, 0, FALSE, TRUE),
    ('00000000-0000-0000-0000-000000004750', '00000000-0000-0000-0000-000000000462', NULL,                            'A',        'ZONE',              'A',   NULL, NULL, NULL, 'LOC-HN-ZA',    NULL, 0, FALSE, TRUE),
    ('00000000-0000-0000-0000-000000004751', '00000000-0000-0000-0000-000000000462', '00000000-0000-0000-0000-000000004750', 'A-02',    'SHELF',             'A',   NULL, '02', NULL, 'LOC-HN-S-A02', NULL, 0, FALSE, TRUE),
    ('00000000-0000-0000-0000-000000000475', '00000000-0000-0000-0000-000000000462', '00000000-0000-0000-0000-000000004751', 'A-02-01', 'SHELF_COMPARTMENT', 'A',   NULL, '02', '01', 'LOC-HN-A0201',   80, 0, TRUE,  TRUE)
ON CONFLICT (id) DO NOTHING;

-- Inventory Units
INSERT INTO inventory_units (
    id, variant_id, warehouse_id, home_location_id, current_location_id, unit_barcode,
    acquisition_reference, acquisition_cost, condition_grade, status, last_seen_at, metadata, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000481', '00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000473', '00000000-0000-0000-0000-000000000473', 'UNIT-ML-0001',  'PO-0001',     120000, 'NEW',  'BORROWED',  '2026-03-10 09:00:00+07', '{"rfid":"RFID-0001"}'::jsonb, '2026-03-08 14:00:00+07', '2026-03-10 09:00:00+07'),
    ('00000000-0000-0000-0000-000000000482', '00000000-0000-0000-0000-000000000443', '00000000-0000-0000-0000-000000000462', '00000000-0000-0000-0000-000000000475', '00000000-0000-0000-0000-000000000475', 'UNIT-LIB-0001', 'MANUAL-INIT',  60000, 'GOOD', 'AVAILABLE', '2026-03-14 08:00:00+07', '{"rfid":"RFID-0002"}'::jsonb, '2026-03-02 09:00:00+07', '2026-03-14 08:00:00+07')
ON CONFLICT (id) DO NOTHING;

-- Stock Balances
INSERT INTO stock_balances (
    id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty,
    damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at,
    created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000483', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000472', 12, 10, 1, 1, 0, 0, 2, 4, 'AVAILABLE', 1, '2026-03-10 10:00:00+07', '2026-03-08 14:00:00+07', '2026-03-10 10:00:00+07'),
    ('00000000-0000-0000-0000-000000000484', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000473', 6,  4, 1, 1, 0, 0, 2, 5, 'LOW_STOCK', 1, '2026-03-10 10:10:00+07', '2026-03-08 14:00:00+07', '2026-03-10 10:10:00+07'),
    ('00000000-0000-0000-0000-000000000485', '00000000-0000-0000-0000-000000000462', '00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000475', 3,  3, 0, 0, 0, 0, 1, 2, 'AVAILABLE', 1, '2026-03-07 16:30:00+07', '2026-03-07 16:30:00+07', '2026-03-07 16:30:00+07'),
    ('00000000-0000-0000-0000-000000000486', '00000000-0000-0000-0000-000000000462', '00000000-0000-0000-0000-000000000443', '00000000-0000-0000-0000-000000000475', 4,  4, 0, 0, 0, 0, 1, 2, 'AVAILABLE', 1, '2026-03-14 08:00:00+07', '2026-03-02 09:00:00+07', '2026-03-14 08:00:00+07')
ON CONFLICT (id) DO NOTHING;

-- Stock Reservations
INSERT INTO stock_reservations (
    id, reservation_code, variant_id, warehouse_id, location_id, customer_id, source_service,
    source_reference_id, quantity, status, expires_at, created_by_user_id, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000491', 'INVRES-0001', '00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000473', '00000000-0000-0000-0000-000000000701', 'BORROW', '00000000-0000-0000-0000-000000000731', 1, 'ACTIVE',   '2026-03-15 18:00:00+07', '00000000-0000-0000-0000-000000000103', '2026-03-14 08:40:00+07', '2026-03-14 08:40:00+07'),
    ('00000000-0000-0000-0000-000000000492', 'INVRES-0002', '00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000472', '00000000-0000-0000-0000-000000000702', 'BORROW', '00000000-0000-0000-0000-000000000732', 1, 'RELEASED', '2026-03-15 18:00:00+07', '00000000-0000-0000-0000-000000000103', '2026-03-13 09:20:00+07', '2026-03-13 12:00:00+07')
ON CONFLICT (id) DO NOTHING;

-- Purchase Orders
INSERT INTO purchase_orders (
    id, po_number, supplier_id, warehouse_id, status, ordered_by_user_id,
    approved_by_user_id, order_date, expected_date, note, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000501', 'PO-0001', '00000000-0000-0000-0000-000000000451', '00000000-0000-0000-0000-000000000461', 'PARTIALLY_RECEIVED', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000101', '2026-03-01', '2026-03-10', 'March replenishment order.', '2026-03-01 11:00:00+07', '2026-03-08 15:00:00+07')
ON CONFLICT (id) DO NOTHING;

-- Purchase Order Items
INSERT INTO purchase_order_items (
    id, purchase_order_id, variant_id, ordered_qty, received_qty, unit_cost, note
) VALUES
    ('00000000-0000-0000-0000-000000000511', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000441', 20, 12, 85000,  'Priority title for SQL shelf.'),
    ('00000000-0000-0000-0000-000000000512', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000442', 10,  6, 120000, 'Starter amount for ML shelf.')
ON CONFLICT (id) DO NOTHING;

-- Goods Receipts
INSERT INTO goods_receipts (
    id, receipt_number, purchase_order_id, warehouse_id, source_type, source_reference_id,
    status, received_by_user_id, received_at, cancelled_at, cancelled_by_user_id, note, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000521', 'GR-0001', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000461', 'PURCHASE_ORDER', '00000000-0000-0000-0000-000000000501', 'POSTED', '00000000-0000-0000-0000-000000000103', '2026-03-08 14:00:00+07', NULL, NULL, 'First partial receipt for PO-0001.', '2026-03-08 14:00:00+07', '2026-03-08 14:05:00+07')
ON CONFLICT (id) DO NOTHING;

-- Goods Receipt Items
INSERT INTO goods_receipt_items (
    id, goods_receipt_id, variant_id, location_id, quantity, unit_cost, condition_grade, note
) VALUES
    ('00000000-0000-0000-0000-000000000531', '00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000472', 12, 85000,  'NEW', 'Placed on shelf A-01-01.'),
    ('00000000-0000-0000-0000-000000000532', '00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000473',  6, 120000, 'NEW', 'Placed on shelf B-01-02.')
ON CONFLICT (id) DO NOTHING;

-- Outbound Orders
INSERT INTO outbound_orders (
    id, outbound_number, warehouse_id, outbound_type, status, requested_by_user_id,
    approved_by_user_id, processed_by_user_id, external_reference, requested_at,
    completed_at, note, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000541', 'OUT-0001', '00000000-0000-0000-0000-000000000461', 'DISPOSAL', 'COMPLETED', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000103', 'DAMAGED-BOOK-01', '2026-03-09 11:00:00+07', '2026-03-09 11:30:00+07', 'Disposed one damaged copy.', '2026-03-09 11:00:00+07', '2026-03-09 11:30:00+07')
ON CONFLICT (id) DO NOTHING;

-- Outbound Order Items
INSERT INTO outbound_order_items (
    id, outbound_order_id, variant_id, source_location_id, quantity, processed_qty, note
) VALUES
    ('00000000-0000-0000-0000-000000000551', '00000000-0000-0000-0000-000000000541', '00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000473', 1, 1, 'Removed damaged item from ML shelf.')
ON CONFLICT (id) DO NOTHING;

-- Transfer Orders
INSERT INTO transfer_orders (
    id, transfer_number, from_warehouse_id, to_warehouse_id, status, requested_by_user_id,
    approved_by_user_id, shipped_by_user_id, received_by_user_id, requested_at,
    shipped_at, received_at, note, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000561', 'TR-0001', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000462', 'RECEIVED', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000102', '2026-03-05 09:00:00+07', '2026-03-06 08:30:00+07', '2026-03-07 16:30:00+07', 'Move two SQL copies to Ha Noi branch.', '2026-03-05 09:00:00+07', '2026-03-07 16:30:00+07')
ON CONFLICT (id) DO NOTHING;

-- Transfer Order Items
INSERT INTO transfer_order_items (
    id, transfer_order_id, variant_id, from_location_id, to_location_id, quantity,
    shipped_qty, received_qty, unit_cost, note
) VALUES
    ('00000000-0000-0000-0000-000000000571', '00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000472', '00000000-0000-0000-0000-000000000475', 2, 2, 2, 85000, 'Balanced stock between HCM and Ha Noi.')
ON CONFLICT (id) DO NOTHING;

-- Stock Audits
INSERT INTO stock_audits (
    id, audit_number, warehouse_id, status, created_by_user_id, reviewed_by_user_id,
    started_at, completed_at, note, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000581', 'AUD-0001', '00000000-0000-0000-0000-000000000461', 'COMPLETED', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000102', '2026-03-12 08:00:00+07', '2026-03-12 10:00:00+07', 'Cycle count for top shelves.', '2026-03-12 08:00:00+07', '2026-03-12 10:00:00+07')
ON CONFLICT (id) DO NOTHING;

-- Stock Audit Lines
INSERT INTO stock_audit_lines (
    id, stock_audit_id, variant_id, location_id, expected_qty, counted_qty, variance_qty, adjustment_posted, note
) VALUES
    ('00000000-0000-0000-0000-000000000591', '00000000-0000-0000-0000-000000000581', '00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000472', 12, 12,  0, FALSE, 'Counts matched system.'),
    ('00000000-0000-0000-0000-000000000592', '00000000-0000-0000-0000-000000000581', '00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000473',  6,  5, -1, TRUE,  'One copy sent to disposal.')
ON CONFLICT (id) DO NOTHING;

-- Stock Movements
INSERT INTO stock_movements (
    id, movement_number, movement_type, movement_status, warehouse_id, variant_id, inventory_unit_id,
    from_location_id, to_location_id, quantity, unit_cost, reason_code, source_service, reference_type,
    reference_id, correlation_id, idempotency_key, created_by_user_id, metadata, created_at
) VALUES
    ('00000000-0000-0000-0000-000000000601', 'MOV-0001', 'INBOUND',  'POSTED', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000441', NULL,                             NULL, '00000000-0000-0000-0000-000000000472', 12, 85000,  'PO_RECEIPT',        'INVENTORY', 'GOODS_RECEIPT',    '00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-000000000901', 'idem-mov-0001', '00000000-0000-0000-0000-000000000103', '{"note":"initial receipt for SQL title"}'::jsonb,          '2026-03-08 14:00:00+07'),
    ('00000000-0000-0000-0000-000000000602', 'MOV-0002', 'INBOUND',  'POSTED', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000442', NULL,                             NULL, '00000000-0000-0000-0000-000000000473',  6, 120000, 'PO_RECEIPT',        'INVENTORY', 'GOODS_RECEIPT',    '00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-000000000902', 'idem-mov-0002', '00000000-0000-0000-0000-000000000103', '{"note":"initial receipt for ML title"}'::jsonb,           '2026-03-08 14:05:00+07'),
    ('00000000-0000-0000-0000-000000000603', 'MOV-0003', 'TRANSFER', 'POSTED', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000441', NULL,                             '00000000-0000-0000-0000-000000000472', '00000000-0000-0000-0000-000000000475',  2, 85000,  'BRANCH_REBALANCE',  'INVENTORY', 'TRANSFER_ORDER',   '00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000903', 'idem-mov-0003', '00000000-0000-0000-0000-000000000103', '{"to_warehouse":"WH-HN-01"}'::jsonb,                      '2026-03-06 08:30:00+07'),
    ('00000000-0000-0000-0000-000000000604', 'MOV-0004', 'BORROW',   'POSTED', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000481', '00000000-0000-0000-0000-000000000473', NULL,                              1, 120000, 'CUSTOMER_LOAN',     'BORROW',    'LOAN_TRANSACTION', '00000000-0000-0000-0000-000000000741', '00000000-0000-0000-0000-000000000904', 'idem-mov-0004', '00000000-0000-0000-0000-000000000103', '{"customer_id":"00000000-0000-0000-0000-000000000701"}'::jsonb, '2026-03-10 09:05:00+07'),
    ('00000000-0000-0000-0000-000000000605', 'MOV-0005', 'RESERVE',  'POSTED', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000442', NULL,                             '00000000-0000-0000-0000-000000000473', '00000000-0000-0000-0000-000000000473',  1, 0,      'LOAN_RESERVATION',  'BORROW',    'LOAN_RESERVATION', '00000000-0000-0000-0000-000000000731', '00000000-0000-0000-0000-000000000905', 'idem-mov-0005', '00000000-0000-0000-0000-000000000103', '{"customer_id":"00000000-0000-0000-0000-000000000701"}'::jsonb, '2026-03-09 16:00:00+07'),
    ('00000000-0000-0000-0000-000000000606', 'MOV-0006', 'OUTBOUND', 'POSTED', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000442', NULL,                             '00000000-0000-0000-0000-000000000473', NULL,                              1, 120000, 'DAMAGED_COPY',      'INVENTORY', 'OUTBOUND_ORDER',   '00000000-0000-0000-0000-000000000541', '00000000-0000-0000-0000-000000000906', 'idem-mov-0006', '00000000-0000-0000-0000-000000000103', '{"reason":"damaged"}'::jsonb,                               '2026-03-09 11:30:00+07')
ON CONFLICT (id) DO NOTHING;

-- Stock Alerts
INSERT INTO stock_alerts (
    id, warehouse_id, variant_id, alert_type, alert_level, threshold_value, current_value,
    status, first_triggered_at, acknowledged_by_user_id, acknowledged_at, resolved_at, payload
) VALUES
    ('00000000-0000-0000-0000-000000000611', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000442', 'LOW_STOCK', 'WARN',     5, 4, 'OPEN',         '2026-03-14 08:35:00+07', NULL,                            NULL, NULL, '{"message":"ML title below reorder point"}'::jsonb),
    ('00000000-0000-0000-0000-000000000612', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000442', 'DAMAGED',   'CRITICAL', 1, 1, 'ACKNOWLEDGED', '2026-03-09 11:20:00+07', '00000000-0000-0000-0000-000000000102', '2026-03-09 11:25:00+07', NULL, '{"message":"One damaged copy disposed"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Inventory Audit Logs
INSERT INTO inventory_audit_logs (
    id, actor_user_id, action_name, entity_type, entity_id, before_data, after_data, created_at
) VALUES
    ('00000000-0000-0000-0000-000000000621', '00000000-0000-0000-0000-000000000102', 'APPROVE_TRANSFER', 'TRANSFER_ORDER', '00000000-0000-0000-0000-000000000561', '{"status":"REQUESTED"}'::jsonb, '{"status":"RECEIVED"}'::jsonb, '2026-03-07 16:30:00+07')
ON CONFLICT (id) DO NOTHING;

-- Integration Outbox (inventory)
INSERT INTO integration_outbox (
    id, aggregate_type, aggregate_id, event_type, payload, headers, status, retry_count, occurred_at, published_at
) VALUES
    ('00000000-0000-0000-0000-000000000631', 'STOCK_BALANCE', '00000000-0000-0000-0000-000000000484', 'inventory.stock.low', '{"warehouse_id":"00000000-0000-0000-0000-000000000461","variant_id":"00000000-0000-0000-0000-000000000442","available_qty":4}'::jsonb, '{"trace_id":"inv-demo-001"}'::jsonb, 'PUBLISHED', 0, '2026-03-14 08:35:00+07', '2026-03-14 08:35:02+07')
ON CONFLICT (id) DO NOTHING;

-- Integration Inbox (inventory)
INSERT INTO integration_inbox (
    id, source_service, event_id, event_type, payload, status, error_message, received_at, processed_at
) VALUES
    ('00000000-0000-0000-0000-000000000632', 'borrow', '00000000-0000-0000-0000-000000000811', 'borrow.loan.created', '{"loan_id":"00000000-0000-0000-0000-000000000741","warehouse_id":"00000000-0000-0000-0000-000000000461"}'::jsonb, 'PROCESSED', NULL, '2026-03-10 09:05:00+07', '2026-03-10 09:05:01+07')
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ============================================================
-- BORROW_DB
-- ============================================================
\connect borrow_db
BEGIN;

-- Membership Plans
INSERT INTO membership_plans (
    code, name, description, max_active_loans, max_loan_days, max_renewal_count,
    reservation_hold_hours, fine_per_day, lost_item_fee_multiplier, is_active
) VALUES
    ('STANDARD', 'Standard', 'Default borrow plan for regular members', 5, 14, 2, 24, 5000, 1.00, TRUE),
    ('PREMIUM', 'Premium', 'Higher quota and longer due date for premium members', 10, 30, 3, 48, 3000, 1.00, TRUE)
ON CONFLICT (code) DO NOTHING;

-- Customers
INSERT INTO customers (
    id, customer_code, full_name, email, phone, birth_date, address, status,
    total_fine_balance, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000701', 'CUS-0001', 'Nguyen Van An',  'an.customer@smartbook.local',  '0912000001', '1999-05-20', 'Thu Duc, HCM City', 'ACTIVE', 10000, '2026-03-01 12:00:00+07', '2026-03-14 08:50:00+07'),
    ('00000000-0000-0000-0000-000000000702', 'CUS-0002', 'Tran Thu Ha',    'ha.customer@smartbook.local',  '0912000002', '2001-11-02', 'Ba Dinh, Ha Noi',   'ACTIVE', 0,      '2026-03-02 09:00:00+07', '2026-03-13 11:00:00+07')
ON CONFLICT (id) DO NOTHING;

-- Customer Memberships
INSERT INTO customer_memberships (
    id, customer_id, plan_id, card_number, start_date, end_date, status,
    max_active_loans_override, max_loan_days_override, note, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000711', '00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000711', 'CARD-0001', '2026-03-01', '2027-03-01', 'ACTIVE', NULL, NULL, NULL, '2026-03-01 12:10:00+07', '2026-03-01 12:10:00+07'),
    ('00000000-0000-0000-0000-000000000712', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000712', 'CARD-0002', '2026-03-02', '2027-03-02', 'ACTIVE', NULL, NULL, NULL, '2026-03-02 09:05:00+07', '2026-03-02 09:05:00+07')
ON CONFLICT (card_number) DO NOTHING;

-- Customer Preferences
INSERT INTO customer_preferences (
    customer_id, notify_email, notify_sms, notify_in_app, preferred_language
) VALUES
    ('00000000-0000-0000-0000-000000000701', TRUE, FALSE, TRUE, 'vi'),
    ('00000000-0000-0000-0000-000000000702', TRUE, FALSE, TRUE, 'vi')
ON CONFLICT (customer_id) DO NOTHING;

-- Customer Accounts
INSERT INTO customer_accounts (
    id, customer_id, currency_code, status, available_balance, held_balance,
    total_credited, total_debited, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000721', '00000000-0000-0000-0000-000000000701', 'VND', 'ACTIVE', 50000, 0, 15000, 10000, '2026-03-01 12:15:00+07', '2026-03-14 08:50:00+07'),
    ('00000000-0000-0000-0000-000000000722', '00000000-0000-0000-0000-000000000702', 'VND', 'ACTIVE', 0, 0, 0, 0, '2026-03-02 09:10:00+07', '2026-03-02 09:10:00+07')
ON CONFLICT (id) DO NOTHING;

-- Loan Reservations
INSERT INTO loan_reservations (
    id, reservation_number, customer_id, variant_id, inventory_unit_id, warehouse_id,
    pickup_location_id, quantity, source_channel, status, reserved_at, expires_at,
    notes, created_by_user_id, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000731', 'RSV-0001', '00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000481', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000473', 1, 'WEB',    'CONVERTED_TO_LOAN', '2026-03-09 16:00:00+07', '2026-03-10 16:00:00+07', 'Reserved online then checked out at counter.', '00000000-0000-0000-0000-000000000103', '2026-03-10 09:00:00+07'),
    ('00000000-0000-0000-0000-000000000732', 'RSV-0002', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000441', NULL, '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000472', 1, 'MOBILE', 'READY_FOR_PICKUP',  '2026-03-13 09:20:00+07', '2026-03-15 09:20:00+07', 'Waiting for pickup at HCM central library.', '00000000-0000-0000-0000-000000000103', '2026-03-13 09:20:00+07')
ON CONFLICT (id) DO NOTHING;

-- Loan Transactions (status must be: RESERVED | BORROWED | RETURNED | OVERDUE | LOST | CANCELLED)
INSERT INTO loan_transactions (
    id, loan_number, customer_id, warehouse_id, handled_by_user_id, source_reservation_id,
    borrow_date, due_date, closed_at, status, total_items, notes, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000741', 'LOAN-0001', '00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000731', '2026-03-10 09:00:00+07', '2026-03-24 09:00:00+07', NULL, 'BORROWED', 2, 'One active item and one returned item for demo.', '2026-03-10 09:00:00+07', '2026-03-18 16:00:00+07')
ON CONFLICT (id) DO NOTHING;

-- Loan Items (status must be: RESERVED | BORROWED | RETURNED | OVERDUE | LOST | DAMAGED)
INSERT INTO loan_items (
    id, loan_id, variant_id, inventory_unit_id, item_barcode, due_date, return_date,
    returned_to_warehouse_id, returned_to_location_id, item_condition_on_checkout,
    item_condition_on_return, status, fine_amount, lost_fee_amount, notes
) VALUES
    ('00000000-0000-0000-0000-000000000751', '00000000-0000-0000-0000-000000000741', '00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000481', 'UNIT-ML-0001', '2026-03-24 09:00:00+07', NULL,                            NULL,                            NULL, 'GOOD', NULL,                            'BORROWED', 0, 0, 'Active borrowed unit.'),
    ('00000000-0000-0000-0000-000000000752', '00000000-0000-0000-0000-000000000741', '00000000-0000-0000-0000-000000000441', NULL,                            'BC-DB-001',    '2026-03-20 09:00:00+07', '2026-03-18 15:30:00+07', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000472', 'GOOD', 'GOOD', 'RETURNED', 15000, 0, 'Returned with overdue fine.')
ON CONFLICT (id) DO NOTHING;

-- Loan Renewals
INSERT INTO loan_renewals (
    id, loan_item_id, renewed_by_user_id, renewed_at, old_due_date, new_due_date,
    renewal_count, reason
) VALUES
    ('00000000-0000-0000-0000-000000000761', '00000000-0000-0000-0000-000000000751', '00000000-0000-0000-0000-000000000103', '2026-03-14 08:45:00+07', '2026-03-20 09:00:00+07', '2026-03-24 09:00:00+07', 1, 'Approved first renewal for premium member.')
ON CONFLICT (id) DO NOTHING;

-- Fines (status must be: UNPAID | PARTIALLY_PAID | PAID | WAIVED)
INSERT INTO fines (
    id, customer_id, loan_item_id, fine_type, amount, waived_amount, status,
    issued_by_user_id, issued_at, paid_at, waived_by_user_id, note
) VALUES
    ('00000000-0000-0000-0000-000000000771', '00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000752', 'OVERDUE', 15000, 0, 'PARTIALLY_PAID', '00000000-0000-0000-0000-000000000103', '2026-03-18 15:35:00+07', NULL, NULL, 'Demo fine for overdue handling.')
ON CONFLICT (id) DO NOTHING;

-- Fine Payments (payment_method must be: CASH | CARD | TRANSFER | EWALLET)
INSERT INTO fine_payments (
    id, fine_id, payment_method, amount, transaction_reference, paid_by_user_id, paid_at, note
) VALUES
    ('00000000-0000-0000-0000-000000000781', '00000000-0000-0000-0000-000000000771', 'CASH', 5000, 'PAY-CASH-0001', '00000000-0000-0000-0000-000000000103', '2026-03-18 15:40:00+07', 'Partial payment at service counter.')
ON CONFLICT (id) DO NOTHING;

-- Customer Notifications
INSERT INTO customer_notifications (
    id, customer_id, channel, template_code, subject, body, reference_type, reference_id,
    status, scheduled_at, sent_at, read_at, metadata
) VALUES
    ('00000000-0000-0000-0000-000000000791', '00000000-0000-0000-0000-000000000701', 'EMAIL', 'LOAN_RENEWED', 'Loan renewed successfully', 'Your due date has been extended to 2026-03-24.', 'LOAN_ITEM', '00000000-0000-0000-0000-000000000751', 'SENT', '2026-03-14 08:46:00+07', '2026-03-14 08:46:10+07', NULL, '{"priority":"normal"}'::jsonb),
    ('00000000-0000-0000-0000-000000000792', '00000000-0000-0000-0000-000000000702', 'IN_APP', 'READY_PICKUP', 'Reservation ready', 'Your reserved SQL title is ready for pickup.', 'LOAN_RESERVATION', '00000000-0000-0000-0000-000000000732', 'READ', '2026-03-13 10:00:00+07', '2026-03-13 10:00:05+07', '2026-03-13 10:10:00+07', '{"priority":"high"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Borrow Audit Logs
INSERT INTO borrow_audit_logs (
    id, actor_user_id, action_name, entity_type, entity_id, before_data, after_data, created_at
) VALUES
    ('00000000-0000-0000-0000-000000000801', '00000000-0000-0000-0000-000000000103', 'CREATE_LOAN', 'LOAN_TRANSACTION', '00000000-0000-0000-0000-000000000741', NULL, '{"status":"BORROWED","total_items":2}'::jsonb, '2026-03-10 09:00:00+07')
ON CONFLICT (id) DO NOTHING;

-- Integration Outbox (borrow)
INSERT INTO integration_outbox (
    id, aggregate_type, aggregate_id, event_type, payload, headers, status, retry_count, occurred_at, published_at
) VALUES
    ('00000000-0000-0000-0000-000000000811', 'LOAN_TRANSACTION', '00000000-0000-0000-0000-000000000741', 'borrow.loan.created', '{"loan_id":"00000000-0000-0000-0000-000000000741","customer_id":"00000000-0000-0000-0000-000000000701"}'::jsonb, '{"trace_id":"borrow-demo-001"}'::jsonb, 'PUBLISHED', 0, '2026-03-10 09:00:00+07', '2026-03-10 09:00:03+07')
ON CONFLICT (id) DO NOTHING;

-- Integration Inbox (borrow)
INSERT INTO integration_inbox (
    id, source_service, event_id, event_type, payload, status, error_message, received_at, processed_at
) VALUES
    ('00000000-0000-0000-0000-000000000812', 'inventory', '00000000-0000-0000-0000-000000000605', 'inventory.stock.reserved', '{"reservation_id":"00000000-0000-0000-0000-000000000491","variant_id":"00000000-0000-0000-0000-000000000442"}'::jsonb, 'PROCESSED', NULL, '2026-03-09 16:00:01+07', '2026-03-09 16:00:02+07')
ON CONFLICT (id) DO NOTHING;

COMMIT;
