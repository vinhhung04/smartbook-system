-- SmartBook merged seed data
-- Single consolidated seed file (sample + extended).
-- Run this after the main schema file has been created successfully.

SET client_encoding = 'UTF8';

-- SmartBook sample seed data
-- ASCII-only content to avoid Windows encoding issues.
-- Run this after the main schema file has been created successfully.

SET client_encoding = 'UTF8';

\connect auth_db
BEGIN;

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
SELECT *
FROM (
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

\connect inventory_db
BEGIN;

INSERT INTO publishers (id, code, name, phone, email, website, address, country) VALUES
    ('00000000-0000-0000-0000-000000000401', 'PUB-TP', 'Tech Press', '0281000001', 'contact@techpress.local', 'https://techpress.local', 'District 1, HCM City', 'Vietnam'),
    ('00000000-0000-0000-0000-000000000402', 'PUB-DP', 'Data Press', '0281000002', 'hello@datapress.local', 'https://datapress.local', 'Ha Noi', 'Vietnam')
ON CONFLICT (id) DO NOTHING;

INSERT INTO authors (id, full_name, sort_name, biography) VALUES
    ('00000000-0000-0000-0000-000000000411', 'Pham Minh Duc', 'Duc, Pham Minh', 'Writes about software architecture and backend systems.'),
    ('00000000-0000-0000-0000-000000000412', 'Le Minh',       'Minh, Le',       'Writes about data science and analytics.'),
    ('00000000-0000-0000-0000-000000000413', 'Tran Ha',       'Ha, Tran',       'Writes about library operations and customer service.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO categories (id, name, slug, parent_id, description) VALUES
    ('00000000-0000-0000-0000-000000000421', 'Technology',   'technology',   NULL, 'Top level technology books.'),
    ('00000000-0000-0000-0000-000000000422', 'Databases',    'databases',    '00000000-0000-0000-0000-000000000421', 'Database design and SQL.'),
    ('00000000-0000-0000-0000-000000000423', 'AI Analytics', 'ai-analytics', '00000000-0000-0000-0000-000000000421', 'AI, ML and analytics titles.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO books (
    id, book_code, title, subtitle, description, publisher_id, edition, published_date,
    page_count, country_of_origin, default_language, is_active, metadata
) VALUES
    ('00000000-0000-0000-0000-000000000431', 'BOOK-DB-001', 'Practical PostgreSQL', 'Design and Performance', 'Reference book for SQL and schema design.', '00000000-0000-0000-0000-000000000401', '2nd', '2024-04-10', 420, 'Vietnam', 'en', TRUE, '{"topic":"database"}'::jsonb),
    ('00000000-0000-0000-0000-000000000432', 'BOOK-ML-001', 'Intro to Machine Learning', 'From Data to Prediction', 'A starter guide for machine learning workflows.', '00000000-0000-0000-0000-000000000402', '1st', '2024-09-15', 360, 'Vietnam', 'en', TRUE, '{"topic":"ml"}'::jsonb),
    ('00000000-0000-0000-0000-000000000433', 'BOOK-LIB-001', 'Library Operations Handbook', NULL, 'Operational handbook for borrowing, stock and service desks.', '00000000-0000-0000-0000-000000000401', '3rd', '2023-01-20', 280, 'Vietnam', 'en', TRUE, '{"topic":"operations"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO book_authors (book_id, author_id, author_order) VALUES
    ('00000000-0000-0000-0000-000000000431', '00000000-0000-0000-0000-000000000411', 1),
    ('00000000-0000-0000-0000-000000000432', '00000000-0000-0000-0000-000000000412', 1),
    ('00000000-0000-0000-0000-000000000433', '00000000-0000-0000-0000-000000000413', 1)
ON CONFLICT DO NOTHING;

INSERT INTO book_categories (book_id, category_id) VALUES
    ('00000000-0000-0000-0000-000000000431', '00000000-0000-0000-0000-000000000422'),
    ('00000000-0000-0000-0000-000000000432', '00000000-0000-0000-0000-000000000423'),
    ('00000000-0000-0000-0000-000000000433', '00000000-0000-0000-0000-000000000421')
ON CONFLICT DO NOTHING;

INSERT INTO book_variants (
    id, book_id, sku, isbn13, isbn10, internal_barcode, cover_type, language_code,
    publish_year, condition_grade, unit_cost, list_price, replacement_cost,
    is_borrowable, is_sellable, is_track_by_unit, cover_image_url, metadata, is_active
) VALUES
    ('00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000431', 'SKU-DB-001', '9786040000001', '6040000001', 'BC-DB-001', 'PAPERBACK', 'en', 2024, 'NEW', 85000, 135000, 150000, TRUE, TRUE, FALSE, 'https://img.local/db001.jpg', '{"edition":"2nd"}'::jsonb, TRUE),
    ('00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000432', 'SKU-ML-001', '9786040000002', '6040000002', 'BC-ML-001', 'HARDCOVER', 'en', 2024, 'NEW', 120000, 189000, 210000, TRUE, TRUE, TRUE,  'https://img.local/ml001.jpg', '{"edition":"1st"}'::jsonb, TRUE),
    ('00000000-0000-0000-0000-000000000443', '00000000-0000-0000-0000-000000000433', 'SKU-LIB-001','9786040000003', '6040000003', 'BC-LIB-001','PAPERBACK', 'en', 2023, 'GOOD', 60000, 99000, 120000, TRUE, FALSE, TRUE, 'https://img.local/lib001.jpg', '{"edition":"3rd"}'::jsonb, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO book_images (id, book_id, variant_id, image_url, image_type, is_primary) VALUES
    ('00000000-0000-0000-0000-000000000444', '00000000-0000-0000-0000-000000000431', NULL, 'https://img.local/book-db-cover.jpg', 'COVER', TRUE),
    ('00000000-0000-0000-0000-000000000445', NULL, '00000000-0000-0000-0000-000000000442', 'https://img.local/variant-ml-back.jpg', 'BACK', FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO suppliers (
    id, code, name, contact_name, phone, email, address, tax_code, status
) VALUES
    ('00000000-0000-0000-0000-000000000451', 'SUP-NB', 'North Books Supply', 'Ms Linh', '0241000001', 'sales@northbooks.local', 'Ha Noi', 'TAX001', 'ACTIVE'),
    ('00000000-0000-0000-0000-000000000452', 'SUP-SA', 'Saigon Academic Supply', 'Mr Long', '0281000003', 'sales@saigonacademic.local', 'HCM City', 'TAX002', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

INSERT INTO supplier_variants (
    id, supplier_id, variant_id, supplier_sku, lead_time_days, default_cost, min_order_qty, is_preferred, created_at
) VALUES
    ('00000000-0000-0000-0000-000000000453', '00000000-0000-0000-0000-000000000451', '00000000-0000-0000-0000-000000000441', 'NB-DB-001', 5, 85000, 5, TRUE, '2026-03-01 10:00:00+07'),
    ('00000000-0000-0000-0000-000000000454', '00000000-0000-0000-0000-000000000452', '00000000-0000-0000-0000-000000000442', 'SA-ML-001', 7, 120000, 3, TRUE, '2026-03-01 10:05:00+07'),
    ('00000000-0000-0000-0000-000000000455', '00000000-0000-0000-0000-000000000452', '00000000-0000-0000-0000-000000000443', 'SA-LIB-001', 3, 60000, 2, FALSE, '2026-03-01 10:10:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO warehouses (
    id, code, name, warehouse_type, address_line1, address_line2, ward, district,
    province, country, manager_user_id, is_active
) VALUES
    ('00000000-0000-0000-0000-000000000461', 'WH-HCM-01', 'HCM Central Library', 'LIBRARY', '123 Nguyen Hue', NULL, 'Ben Nghe', 'District 1', 'HCM City', 'Vietnam', '00000000-0000-0000-0000-000000000102', TRUE),
    ('00000000-0000-0000-0000-000000000462', 'WH-HN-01',  'Ha Noi Branch',      'BRANCH',  '88 Kim Ma',      NULL, 'Ngoc Khanh', 'Ba Dinh',   'Ha Noi',   'Vietnam', '00000000-0000-0000-0000-000000000101', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO warehouse_settings (
    warehouse_id, reservation_hold_hours, allow_negative_stock, default_low_stock_threshold,
    enable_cycle_count, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000461', 24, FALSE, 5, TRUE, '2026-03-01 10:30:00+07', '2026-03-01 10:30:00+07'),
    ('00000000-0000-0000-0000-000000000462', 48, FALSE, 3, TRUE, '2026-03-01 10:31:00+07', '2026-03-01 10:31:00+07')
ON CONFLICT (warehouse_id) DO NOTHING;

INSERT INTO locations (
    id, warehouse_id, parent_location_id, location_code, location_type, zone, aisle,
    shelf, bin, barcode, capacity_qty, is_pickable, is_active
) VALUES
    ('00000000-0000-0000-0000-000000000471', '00000000-0000-0000-0000-000000000461', NULL, 'RCV-HCM',  'RECEIVING', NULL, NULL, NULL, NULL, 'LOC-RCV-HCM', 500, FALSE, TRUE),
    ('00000000-0000-0000-0000-000000004720', '00000000-0000-0000-0000-000000000461', NULL, 'A', 'ZONE', 'A', NULL, NULL, NULL, 'LOC-HCM-ZA', NULL, FALSE, TRUE),
    ('00000000-0000-0000-0000-000000004721', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000004720', 'A-01', 'SHELF', 'A', NULL, '01', NULL, 'LOC-HCM-S-A01', NULL, FALSE, TRUE),
    ('00000000-0000-0000-0000-000000000472', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000004721', 'A-01-01', 'SHELF_COMPARTMENT', 'A', NULL, '01', '01', 'LOC-HCM-A0101', 100, TRUE, TRUE),
    ('00000000-0000-0000-0000-000000004730', '00000000-0000-0000-0000-000000000461', NULL, 'B', 'ZONE', 'B', NULL, NULL, NULL, 'LOC-HCM-ZB', NULL, FALSE, TRUE),
    ('00000000-0000-0000-0000-000000004731', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000004730', 'B-01', 'SHELF', 'B', NULL, '01', NULL, 'LOC-HCM-S-B01', NULL, FALSE, TRUE),
    ('00000000-0000-0000-0000-000000000473', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000004731', 'B-01-02', 'SHELF_COMPARTMENT', 'B', NULL, '01', '02', 'LOC-HCM-B0102', 100, TRUE, TRUE),
    ('00000000-0000-0000-0000-000000000474', '00000000-0000-0000-0000-000000000462', NULL, 'RCV-HN',   'RECEIVING', NULL, NULL, NULL, NULL, 'LOC-RCV-HN',  300, FALSE, TRUE),
    ('00000000-0000-0000-0000-000000004750', '00000000-0000-0000-0000-000000000462', NULL, 'A', 'ZONE', 'A', NULL, NULL, NULL, 'LOC-HN-ZA', NULL, FALSE, TRUE),
    ('00000000-0000-0000-0000-000000004751', '00000000-0000-0000-0000-000000000462', '00000000-0000-0000-0000-000000004750', 'A-02', 'SHELF', 'A', NULL, '02', NULL, 'LOC-HN-S-A02', NULL, FALSE, TRUE),
    ('00000000-0000-0000-0000-000000000475', '00000000-0000-0000-0000-000000000462', '00000000-0000-0000-0000-000000004751', 'A-02-01', 'SHELF_COMPARTMENT', 'A', NULL, '02', '01', 'LOC-HN-A0201', 80,  TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory_units (
    id, variant_id, warehouse_id, home_location_id, current_location_id, unit_barcode,
    acquisition_reference, acquisition_cost, condition_grade, status, last_seen_at, metadata, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000481', '00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000473', '00000000-0000-0000-0000-000000000473', 'UNIT-ML-0001', 'PO-0001', 120000, 'NEW',  'BORROWED', '2026-03-10 09:00:00+07', '{"rfid":"RFID-0001"}'::jsonb, '2026-03-08 14:00:00+07', '2026-03-10 09:00:00+07'),
    ('00000000-0000-0000-0000-000000000482', '00000000-0000-0000-0000-000000000443', '00000000-0000-0000-0000-000000000462', '00000000-0000-0000-0000-000000000475', '00000000-0000-0000-0000-000000000475', 'UNIT-LIB-0001','MANUAL-INIT', 60000, 'GOOD', 'AVAILABLE','2026-03-14 08:00:00+07', '{"rfid":"RFID-0002"}'::jsonb, '2026-03-02 09:00:00+07', '2026-03-14 08:00:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO stock_balances (
    id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty,
    damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at,
    created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000483', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000472', 12, 10, 1, 1, 0, 0, 2, 4, 'AVAILABLE', 1, '2026-03-10 10:00:00+07', '2026-03-08 14:00:00+07', '2026-03-10 10:00:00+07'),
    ('00000000-0000-0000-0000-000000000484', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000473', 6, 4, 1, 1, 0, 0, 2, 5, 'LOW_STOCK', 1, '2026-03-10 10:10:00+07', '2026-03-08 14:00:00+07', '2026-03-10 10:10:00+07'),
    ('00000000-0000-0000-0000-000000000485', '00000000-0000-0000-0000-000000000462', '00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000475', 3, 3, 0, 0, 0, 0, 1, 2, 'AVAILABLE', 1, '2026-03-07 16:30:00+07', '2026-03-07 16:30:00+07', '2026-03-07 16:30:00+07'),
    ('00000000-0000-0000-0000-000000000486', '00000000-0000-0000-0000-000000000462', '00000000-0000-0000-0000-000000000443', '00000000-0000-0000-0000-000000000475', 4, 4, 0, 0, 0, 0, 1, 2, 'AVAILABLE', 1, '2026-03-14 08:00:00+07', '2026-03-02 09:00:00+07', '2026-03-14 08:00:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO stock_reservations (
    id, reservation_code, variant_id, warehouse_id, location_id, customer_id, source_service,
    source_reference_id, quantity, status, expires_at, created_by_user_id, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000491', 'INVRES-0001', '00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000473', '00000000-0000-0000-0000-000000000701', 'BORROW', '00000000-0000-0000-0000-000000000731', 1, 'ACTIVE',   '2026-03-15 18:00:00+07', '00000000-0000-0000-0000-000000000103', '2026-03-14 08:40:00+07', '2026-03-14 08:40:00+07'),
    ('00000000-0000-0000-0000-000000000492', 'INVRES-0002', '00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000472', '00000000-0000-0000-0000-000000000702', 'BORROW', '00000000-0000-0000-0000-000000000732', 1, 'RELEASED', '2026-03-15 18:00:00+07', '00000000-0000-0000-0000-000000000103', '2026-03-13 09:20:00+07', '2026-03-13 12:00:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO purchase_orders (
    id, po_number, supplier_id, warehouse_id, status, ordered_by_user_id,
    approved_by_user_id, order_date, expected_date, note, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000501', 'PO-0001', '00000000-0000-0000-0000-000000000451', '00000000-0000-0000-0000-000000000461', 'PARTIALLY_RECEIVED', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000101', '2026-03-01', '2026-03-10', 'March replenishment order.', '2026-03-01 11:00:00+07', '2026-03-08 15:00:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO purchase_order_items (
    id, purchase_order_id, variant_id, ordered_qty, received_qty, unit_cost, note
) VALUES
    ('00000000-0000-0000-0000-000000000511', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000441', 20, 12, 85000,  'Priority title for SQL shelf.'),
    ('00000000-0000-0000-0000-000000000512', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000442', 10, 6, 120000, 'Starter amount for ML shelf.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO goods_receipts (
    id, receipt_number, purchase_order_id, warehouse_id, source_type, source_reference_id,
    status, received_by_user_id, received_at, note, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000521', 'GR-0001', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000461', 'PURCHASE_ORDER', '00000000-0000-0000-0000-000000000501', 'POSTED', '00000000-0000-0000-0000-000000000103', '2026-03-08 14:00:00+07', 'First partial receipt for PO-0001.', '2026-03-08 14:00:00+07', '2026-03-08 14:05:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO goods_receipt_items (
    id, goods_receipt_id, variant_id, location_id, quantity, unit_cost, condition_grade, note
) VALUES
    ('00000000-0000-0000-0000-000000000531', '00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000472', 12, 85000,  'NEW', 'Placed on shelf A-01-01-01.'),
    ('00000000-0000-0000-0000-000000000532', '00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000473', 6, 120000, 'NEW', 'Placed on shelf B-01-02-01.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO outbound_orders (
    id, outbound_number, warehouse_id, outbound_type, status, requested_by_user_id,
    approved_by_user_id, processed_by_user_id, external_reference, requested_at,
    completed_at, note, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000541', 'OUT-0001', '00000000-0000-0000-0000-000000000461', 'DISPOSAL', 'COMPLETED', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000103', 'DAMAGED-BOOK-01', '2026-03-09 11:00:00+07', '2026-03-09 11:30:00+07', 'Disposed one damaged copy.', '2026-03-09 11:00:00+07', '2026-03-09 11:30:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO outbound_order_items (
    id, outbound_order_id, variant_id, source_location_id, quantity, processed_qty, note
) VALUES
    ('00000000-0000-0000-0000-000000000551', '00000000-0000-0000-0000-000000000541', '00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000473', 1, 1, 'Removed damaged item from ML shelf.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO transfer_orders (
    id, transfer_number, from_warehouse_id, to_warehouse_id, status, requested_by_user_id,
    approved_by_user_id, shipped_by_user_id, received_by_user_id, requested_at,
    shipped_at, received_at, note, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000561', 'TR-0001', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000462', 'RECEIVED', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000102', '2026-03-05 09:00:00+07', '2026-03-06 08:30:00+07', '2026-03-07 16:30:00+07', 'Move two SQL copies to Ha Noi branch.', '2026-03-05 09:00:00+07', '2026-03-07 16:30:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO transfer_order_items (
    id, transfer_order_id, variant_id, from_location_id, to_location_id, quantity, shipped_qty, received_qty, note
) VALUES
    ('00000000-0000-0000-0000-000000000571', '00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000472', '00000000-0000-0000-0000-000000000475', 2, 2, 2, 'Balanced stock between HCM and Ha Noi.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO stock_audits (
    id, audit_number, warehouse_id, status, created_by_user_id, reviewed_by_user_id,
    started_at, completed_at, note, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000581', 'AUD-0001', '00000000-0000-0000-0000-000000000461', 'COMPLETED', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000102', '2026-03-12 08:00:00+07', '2026-03-12 10:00:00+07', 'Cycle count for top shelves.', '2026-03-12 08:00:00+07', '2026-03-12 10:00:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO stock_audit_lines (
    id, stock_audit_id, variant_id, location_id, expected_qty, counted_qty, variance_qty, adjustment_posted, note
) VALUES
    ('00000000-0000-0000-0000-000000000591', '00000000-0000-0000-0000-000000000581', '00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000472', 12, 12, 0, FALSE, 'Counts matched system.'),
    ('00000000-0000-0000-0000-000000000592', '00000000-0000-0000-0000-000000000581', '00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000473', 6, 5, -1, TRUE, 'One copy sent to disposal.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO stock_movements (
    id, movement_number, movement_type, movement_status, warehouse_id, variant_id, inventory_unit_id,
    from_location_id, to_location_id, quantity, unit_cost, reason_code, source_service, reference_type,
    reference_id, correlation_id, idempotency_key, created_by_user_id, metadata, created_at
) VALUES
    ('00000000-0000-0000-0000-000000000601', 'MOV-0001', 'INBOUND',  'POSTED', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000441', NULL, NULL, '00000000-0000-0000-0000-000000000472', 12, 85000,  'PO_RECEIPT',   'INVENTORY', 'GOODS_RECEIPT',    '00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-000000000901', 'idem-mov-0001', '00000000-0000-0000-0000-000000000103', '{"note":"initial receipt for SQL title"}'::jsonb, '2026-03-08 14:00:00+07'),
    ('00000000-0000-0000-0000-000000000602', 'MOV-0002', 'INBOUND',  'POSTED', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000442', NULL, NULL, '00000000-0000-0000-0000-000000000473', 6, 120000, 'PO_RECEIPT',   'INVENTORY', 'GOODS_RECEIPT',    '00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-000000000902', 'idem-mov-0002', '00000000-0000-0000-0000-000000000103', '{"note":"initial receipt for ML title"}'::jsonb,  '2026-03-08 14:05:00+07'),
    ('00000000-0000-0000-0000-000000000603', 'MOV-0003', 'TRANSFER', 'POSTED', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000441', NULL, '00000000-0000-0000-0000-000000000472', '00000000-0000-0000-0000-000000000475', 2, 85000,  'BRANCH_REBALANCE','INVENTORY', 'TRANSFER_ORDER',  '00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000903', 'idem-mov-0003', '00000000-0000-0000-0000-000000000103', '{"to_warehouse":"WH-HN-01"}'::jsonb, '2026-03-06 08:30:00+07'),
    ('00000000-0000-0000-0000-000000000604', 'MOV-0004', 'BORROW',   'POSTED', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000481', '00000000-0000-0000-0000-000000000473', NULL, 1, 120000, 'CUSTOMER_LOAN', 'BORROW',    'LOAN_TRANSACTION', '00000000-0000-0000-0000-000000000741', '00000000-0000-0000-0000-000000000904', 'idem-mov-0004', '00000000-0000-0000-0000-000000000103', '{"customer_id":"00000000-0000-0000-0000-000000000701"}'::jsonb, '2026-03-10 09:05:00+07'),
    ('00000000-0000-0000-0000-000000000605', 'MOV-0005', 'RESERVE',  'POSTED', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000442', NULL, '00000000-0000-0000-0000-000000000473', '00000000-0000-0000-0000-000000000473', 1, 0,      'LOAN_RESERVATION','BORROW',    'LOAN_RESERVATION', '00000000-0000-0000-0000-000000000731', '00000000-0000-0000-0000-000000000905', 'idem-mov-0005', '00000000-0000-0000-0000-000000000103', '{"customer_id":"00000000-0000-0000-0000-000000000701"}'::jsonb, '2026-03-09 16:00:00+07'),
    ('00000000-0000-0000-0000-000000000606', 'MOV-0006', 'OUTBOUND', 'POSTED', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000442', NULL, '00000000-0000-0000-0000-000000000473', NULL, 1, 120000, 'DAMAGED_COPY',  'INVENTORY', 'OUTBOUND_ORDER',   '00000000-0000-0000-0000-000000000541', '00000000-0000-0000-0000-000000000906', 'idem-mov-0006', '00000000-0000-0000-0000-000000000103', '{"reason":"damaged"}'::jsonb, '2026-03-09 11:30:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO stock_alerts (
    id, warehouse_id, variant_id, alert_type, alert_level, threshold_value, current_value,
    status, first_triggered_at, acknowledged_by_user_id, acknowledged_at, resolved_at, payload
) VALUES
    ('00000000-0000-0000-0000-000000000611', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000442', 'LOW_STOCK', 'WARN',     5, 4, 'OPEN',         '2026-03-14 08:35:00+07', NULL, NULL, NULL, '{"message":"ML title below reorder point"}'::jsonb),
    ('00000000-0000-0000-0000-000000000612', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000442', 'DAMAGED',   'CRITICAL', 1, 1, 'ACKNOWLEDGED', '2026-03-09 11:20:00+07', '00000000-0000-0000-0000-000000000102', '2026-03-09 11:25:00+07', NULL, '{"message":"One damaged copy disposed"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory_audit_logs (
    id, actor_user_id, action_name, entity_type, entity_id, before_data, after_data, created_at
) VALUES
    ('00000000-0000-0000-0000-000000000621', '00000000-0000-0000-0000-000000000102', 'APPROVE_TRANSFER', 'TRANSFER_ORDER', '00000000-0000-0000-0000-000000000561', '{"status":"REQUESTED"}'::jsonb, '{"status":"RECEIVED"}'::jsonb, '2026-03-07 16:30:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO integration_outbox (
    id, aggregate_type, aggregate_id, event_type, payload, headers, status, retry_count, occurred_at, published_at
) VALUES
    ('00000000-0000-0000-0000-000000000631', 'STOCK_BALANCE', '00000000-0000-0000-0000-000000000484', 'inventory.stock.low', '{"warehouse_id":"00000000-0000-0000-0000-000000000461","variant_id":"00000000-0000-0000-0000-000000000442","available_qty":4}'::jsonb, '{"trace_id":"inv-demo-001"}'::jsonb, 'PUBLISHED', 0, '2026-03-14 08:35:00+07', '2026-03-14 08:35:02+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO integration_inbox (
    id, source_service, event_id, event_type, payload, status, error_message, received_at, processed_at
) VALUES
    ('00000000-0000-0000-0000-000000000632', 'borrow', '00000000-0000-0000-0000-000000000811', 'borrow.loan.created', '{"loan_id":"00000000-0000-0000-0000-000000000741","warehouse_id":"00000000-0000-0000-0000-000000000461"}'::jsonb, 'PROCESSED', NULL, '2026-03-10 09:05:00+07', '2026-03-10 09:05:01+07')
ON CONFLICT (id) DO NOTHING;

COMMIT;

\connect borrow_db
BEGIN;

INSERT INTO customers (
    id, customer_code, full_name, email, phone, birth_date, address, status,
    total_fine_balance, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000701', 'CUS-0001', 'Nguyen Van An', 'an.customer@smartbook.local', '0912000001', '1999-05-20', 'Thu Duc, HCM City', 'ACTIVE', 10000, '2026-03-01 12:00:00+07', '2026-03-14 08:50:00+07'),
    ('00000000-0000-0000-0000-000000000702', 'CUS-0002', 'Tran Thu Ha',   'ha.customer@smartbook.local', '0912000002', '2001-11-02', 'Ba Dinh, Ha Noi',   'ACTIVE', 0,     '2026-03-02 09:00:00+07', '2026-03-13 11:00:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO membership_plans (
    id, code, name, description, max_active_loans, max_loan_days,
    max_renewal_count, reservation_hold_hours, fine_per_day,
    lost_item_fee_multiplier, is_active, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000711', 'PLAN-BASIC',   'Basic Member',   'Standard borrowing plan.', 3, 14, 1, 24, 5000, 1.20, TRUE, '2026-03-01 12:10:00+07', '2026-03-01 12:10:00+07'),
    ('00000000-0000-0000-0000-000000000712', 'PLAN-PREMIUM', 'Premium Member', 'Extended limits for active users.', 5, 21, 2, 48, 3000, 1.00, TRUE, '2026-03-01 12:11:00+07', '2026-03-01 12:11:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO customer_memberships (
    id, customer_id, plan_id, card_number, start_date, end_date, status,
    max_active_loans_override, max_loan_days_override, note, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000721', '00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000712', 'CARD-0001', '2026-03-01', '2027-02-28', 'ACTIVE', NULL, NULL, 'Premium launch member.', '2026-03-01 12:15:00+07', '2026-03-01 12:15:00+07'),
    ('00000000-0000-0000-0000-000000000722', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000711', 'CARD-0002', '2026-03-02', '2027-03-01', 'ACTIVE', NULL, NULL, 'Basic branch member.', '2026-03-02 09:10:00+07', '2026-03-02 09:10:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO customer_preferences (
    customer_id, notify_email, notify_sms, notify_in_app, preferred_language, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000701', TRUE, FALSE, TRUE, 'vi', '2026-03-01 12:20:00+07'),
    ('00000000-0000-0000-0000-000000000702', TRUE, TRUE,  TRUE, 'en', '2026-03-02 09:20:00+07')
ON CONFLICT (customer_id) DO NOTHING;

INSERT INTO loan_reservations (
    id, reservation_number, customer_id, variant_id, inventory_unit_id, warehouse_id,
    pickup_location_id, quantity, source_channel, status, reserved_at, expires_at,
    notes, created_by_user_id, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000731', 'RSV-0001', '00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000481', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000473', 1, 'WEB',    'CONVERTED_TO_LOAN', '2026-03-09 16:00:00+07', '2026-03-10 16:00:00+07', 'Reserved online then checked out at counter.', '00000000-0000-0000-0000-000000000103', '2026-03-10 09:00:00+07'),
    ('00000000-0000-0000-0000-000000000732', 'RSV-0002', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000441', NULL, '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000472', 1, 'MOBILE', 'READY_FOR_PICKUP',  '2026-03-13 09:20:00+07', '2026-03-15 09:20:00+07', 'Waiting for pickup at HCM central library.', '00000000-0000-0000-0000-000000000103', '2026-03-13 09:20:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO loan_transactions (
    id, loan_number, customer_id, warehouse_id, handled_by_user_id, source_reservation_id,
    borrow_date, due_date, closed_at, status, total_items, notes, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000741', 'LOAN-0001', '00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000731', '2026-03-10 09:00:00+07', '2026-03-24 09:00:00+07', NULL, 'BORROWED', 2, 'One active item and one returned item for demo.', '2026-03-10 09:00:00+07', '2026-03-18 16:00:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO loan_items (
    id, loan_id, variant_id, inventory_unit_id, item_barcode, due_date, return_date,
    returned_to_warehouse_id, returned_to_location_id, item_condition_on_checkout,
    item_condition_on_return, status, fine_amount, lost_fee_amount, notes
) VALUES
    ('00000000-0000-0000-0000-000000000751', '00000000-0000-0000-0000-000000000741', '00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000481', 'UNIT-ML-0001', '2026-03-24 09:00:00+07', NULL, NULL, NULL, 'GOOD', NULL, 'BORROWED', 0, 0, 'Active borrowed unit.'),
    ('00000000-0000-0000-0000-000000000752', '00000000-0000-0000-0000-000000000741', '00000000-0000-0000-0000-000000000441', NULL, 'BC-DB-001', '2026-03-20 09:00:00+07', '2026-03-18 15:30:00+07', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000472', 'GOOD', 'GOOD', 'RETURNED', 15000, 0, 'Returned early but with overdue fine already issued from prior extension scenario.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO loan_renewals (
    id, loan_item_id, renewed_by_user_id, renewed_at, old_due_date, new_due_date, renewal_count, reason
) VALUES
    ('00000000-0000-0000-0000-000000000761', '00000000-0000-0000-0000-000000000751', '00000000-0000-0000-0000-000000000103', '2026-03-14 08:45:00+07', '2026-03-20 09:00:00+07', '2026-03-24 09:00:00+07', 1, 'Approved first renewal for premium member.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO fines (
    id, customer_id, loan_item_id, fine_type, amount, waived_amount, status,
    issued_by_user_id, issued_at, paid_at, waived_by_user_id, note
) VALUES
    ('00000000-0000-0000-0000-000000000771', '00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000752', 'OVERDUE', 15000, 0, 'PARTIALLY_PAID', '00000000-0000-0000-0000-000000000103', '2026-03-18 15:35:00+07', NULL, NULL, 'Demo fine for overdue handling.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO fine_payments (
    id, fine_id, payment_method, amount, transaction_reference, paid_by_user_id, paid_at, note
) VALUES
    ('00000000-0000-0000-0000-000000000781', '00000000-0000-0000-0000-000000000771', 'CASH', 5000, 'PAY-CASH-0001', '00000000-0000-0000-0000-000000000103', '2026-03-18 15:40:00+07', 'Partial payment at service counter.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO customer_notifications (
    id, customer_id, channel, template_code, subject, body, reference_type, reference_id,
    status, scheduled_at, sent_at, read_at, metadata
) VALUES
    ('00000000-0000-0000-0000-000000000791', '00000000-0000-0000-0000-000000000701', 'EMAIL', 'LOAN_RENEWED', 'Loan renewed successfully', 'Your due date has been extended to 2026-03-24.', 'LOAN_ITEM', '00000000-0000-0000-0000-000000000751', 'SENT', '2026-03-14 08:46:00+07', '2026-03-14 08:46:10+07', NULL, '{"priority":"normal"}'::jsonb),
    ('00000000-0000-0000-0000-000000000792', '00000000-0000-0000-0000-000000000702', 'IN_APP', 'READY_PICKUP',  'Reservation ready',         'Your reserved SQL title is ready for pickup.', 'LOAN_RESERVATION', '00000000-0000-0000-0000-000000000732', 'READ', '2026-03-13 10:00:00+07', '2026-03-13 10:00:05+07', '2026-03-13 10:10:00+07', '{"priority":"high"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO borrow_audit_logs (
    id, actor_user_id, action_name, entity_type, entity_id, before_data, after_data, created_at
) VALUES
    ('00000000-0000-0000-0000-000000000801', '00000000-0000-0000-0000-000000000103', 'CREATE_LOAN', 'LOAN_TRANSACTION', '00000000-0000-0000-0000-000000000741', NULL, '{"status":"BORROWED","total_items":2}'::jsonb, '2026-03-10 09:00:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO integration_outbox (
    id, aggregate_type, aggregate_id, event_type, payload, headers, status, retry_count, occurred_at, published_at
) VALUES
    ('00000000-0000-0000-0000-000000000811', 'LOAN_TRANSACTION', '00000000-0000-0000-0000-000000000741', 'borrow.loan.created', '{"loan_id":"00000000-0000-0000-0000-000000000741","customer_id":"00000000-0000-0000-0000-000000000701"}'::jsonb, '{"trace_id":"borrow-demo-001"}'::jsonb, 'PUBLISHED', 0, '2026-03-10 09:00:00+07', '2026-03-10 09:00:03+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO integration_inbox (
    id, source_service, event_id, event_type, payload, status, error_message, received_at, processed_at
) VALUES
    ('00000000-0000-0000-0000-000000000812', 'inventory', '00000000-0000-0000-0000-000000000605', 'inventory.stock.reserved', '{"reservation_id":"00000000-0000-0000-0000-000000000491","variant_id":"00000000-0000-0000-0000-000000000442"}'::jsonb, 'PROCESSED', NULL, '2026-03-09 16:00:01+07', '2026-03-09 16:00:02+07')
ON CONFLICT (id) DO NOTHING;

COMMIT;

\connect ai_db
BEGIN;

INSERT INTO model_versions (
    id, model_name, version_label, task_type, is_active, metrics, created_at
) VALUES
    ('00000000-0000-0000-0000-000000000901', 'ocr-reader',   '1.0.0', 'OCR',      TRUE, '{"precision":0.94,"recall":0.91}'::jsonb, '2026-03-01 13:00:00+07'),
    ('00000000-0000-0000-0000-000000000902', 'book-matcher', '1.1.0', 'MATCHING', TRUE, '{"precision":0.97,"recall":0.93}'::jsonb, '2026-03-01 13:05:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_assets (
    id, storage_provider, object_key, original_file_name, mime_type, file_size,
    checksum_sha256, uploaded_by_user_id, uploaded_at
) VALUES
    ('00000000-0000-0000-0000-000000000911', 'LOCAL', 'uploads/2026/03/ml-book-front.jpg', 'ml-book-front.jpg', 'image/jpeg', 245120, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '00000000-0000-0000-0000-000000000103', '2026-03-14 08:20:00+07'),
    ('00000000-0000-0000-0000-000000000912', 'LOCAL', 'uploads/2026/03/sql-book-front.jpg','sql-book-front.jpg','image/jpeg', 198552, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '00000000-0000-0000-0000-000000000103', '2026-03-14 08:22:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO recognition_jobs (
    id, job_number, asset_id, requested_by_user_id, warehouse_id, source_type,
    status, model_version_id, correlation_id, error_message, started_at,
    completed_at, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000921', 'AIJOB-0001', '00000000-0000-0000-0000-000000000911', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000461', 'IMAGE_UPLOAD', 'COMPLETED',  '00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-000000000921', NULL, '2026-03-14 08:21:00+07', '2026-03-14 08:21:10+07', '2026-03-14 08:20:30+07', '2026-03-14 08:21:10+07'),
    ('00000000-0000-0000-0000-000000000922', 'AIJOB-0002', '00000000-0000-0000-0000-000000000912', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000461', 'BARCODE_SCAN',  'PROCESSING', '00000000-0000-0000-0000-000000000902', '00000000-0000-0000-0000-000000000922', NULL, '2026-03-14 08:23:00+07', NULL,                    '2026-03-14 08:22:30+07', '2026-03-14 08:23:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO recognition_results (
    id, job_id, extracted_isbn10, extracted_isbn13, barcode_value, extracted_title,
    extracted_authors, extracted_publisher, extracted_publish_year, confidence_score,
    raw_ocr_text, normalized_payload, google_books_payload, matched_book_id, matched_variant_id,
    review_status, human_verified, verified_by_user_id, verified_at, notes, created_at, updated_at
) VALUES
    ('00000000-0000-0000-0000-000000000931', '00000000-0000-0000-0000-000000000921', '6040000002', '9786040000002', 'BC-ML-001', 'Intro to Machine Learning', 'Le Minh', 'Data Press', 2024, 0.9732, 'Intro to Machine Learning / Le Minh / Data Press', '{"isbn13":"9786040000002","title":"Intro to Machine Learning"}'::jsonb, '{"source":"demo"}'::jsonb, '00000000-0000-0000-0000-000000000432', '00000000-0000-0000-0000-000000000442', 'VERIFIED', TRUE, '00000000-0000-0000-0000-000000000101', '2026-03-14 08:22:00+07', 'Result verified by admin.', '2026-03-14 08:21:10+07', '2026-03-14 08:22:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO recognition_feedback (
    id, job_id, result_id, reviewed_by_user_id, accepted, corrected_isbn13,
    corrected_title, corrected_payload, comment, created_at
) VALUES
    ('00000000-0000-0000-0000-000000000941', '00000000-0000-0000-0000-000000000921', '00000000-0000-0000-0000-000000000931', '00000000-0000-0000-0000-000000000101', TRUE, '9786040000002', 'Intro to Machine Learning', '{"matched_variant_id":"00000000-0000-0000-0000-000000000442"}'::jsonb, 'Auto match looked correct after manual review.', '2026-03-14 08:22:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_audit_logs (
    id, actor_user_id, action_name, entity_type, entity_id, before_data, after_data, created_at
) VALUES
    ('00000000-0000-0000-0000-000000000951', '00000000-0000-0000-0000-000000000101', 'VERIFY_RESULT', 'RECOGNITION_RESULT', '00000000-0000-0000-0000-000000000931', '{"review_status":"PENDING_REVIEW"}'::jsonb, '{"review_status":"VERIFIED"}'::jsonb, '2026-03-14 08:22:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO integration_outbox (
    id, aggregate_type, aggregate_id, event_type, payload, headers, status, retry_count, occurred_at, published_at
) VALUES
    ('00000000-0000-0000-0000-000000000961', 'RECOGNITION_RESULT', '00000000-0000-0000-0000-000000000931', 'ai.recognition.verified', '{"job_id":"00000000-0000-0000-0000-000000000921","matched_variant_id":"00000000-0000-0000-0000-000000000442"}'::jsonb, '{"trace_id":"ai-demo-001"}'::jsonb, 'PUBLISHED', 0, '2026-03-14 08:22:00+07', '2026-03-14 08:22:02+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO integration_inbox (
    id, source_service, event_id, event_type, payload, status, error_message, received_at, processed_at
) VALUES
    ('00000000-0000-0000-0000-000000000962', 'inventory', '00000000-0000-0000-0000-000000000631', 'inventory.stock.low', '{"variant_id":"00000000-0000-0000-0000-000000000442"}'::jsonb, 'PROCESSED', NULL, '2026-03-14 08:35:03+07', '2026-03-14 08:35:05+07')
ON CONFLICT (id) DO NOTHING;

COMMIT;

\connect analytics_db
BEGIN;

INSERT INTO forecast_runs (
    id, run_name, model_name, model_version, warehouse_id, target_month, status,
    triggered_by_user_id, parameters, metrics, started_at, completed_at, note
) VALUES
    ('00000000-0000-0000-0000-00000000a001', 'forecast-apr-2026-hcm', 'demand-forecast', '0.9.0', '00000000-0000-0000-0000-000000000461', '2026-04-01', 'COMPLETED', '00000000-0000-0000-0000-000000000102', '{"horizon_days":30,"algorithm":"xgboost"}'::jsonb, '{"mae":2.1,"mape":0.12}'::jsonb, '2026-03-14 06:00:00+07', '2026-03-14 06:05:00+07', 'Daily forecast run for HCM library.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO demand_forecasts (
    id, run_id, variant_id, warehouse_id, target_month, predicted_demand_qty,
    confidence_lower, confidence_upper, recommended_reorder_qty, calculated_at
) VALUES
    ('00000000-0000-0000-0000-00000000a011', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000461', '2026-04-01', 9, 7, 11, 4, '2026-03-14 06:05:00+07'),
    ('00000000-0000-0000-0000-00000000a012', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000461', '2026-04-01', 12, 10, 14, 8, '2026-03-14 06:05:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO location_heatmaps (
    id, warehouse_id, location_id, period_start, period_end, pick_frequency,
    putaway_frequency, score, category, last_updated
) VALUES
    ('00000000-0000-0000-0000-00000000a021', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000472', '2026-03-01', '2026-03-14', 34, 12, 0.8700, 'HOT',  '2026-03-14 06:06:00+07'),
    ('00000000-0000-0000-0000-00000000a022', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000473', '2026-03-01', '2026-03-14', 18, 8,  0.5200, 'WARM', '2026-03-14 06:06:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO stock_kpi_snapshots (
    id, warehouse_id, snapshot_date, total_titles, total_units, available_units,
    reserved_units, borrowed_units, out_of_stock_titles, low_stock_titles,
    ageing_titles, turnover_ratio, created_at
) VALUES
    ('00000000-0000-0000-0000-00000000a031', '00000000-0000-0000-0000-000000000461', '2026-03-14', 3, 18, 14, 2, 2, 0, 1, 0, 1.4200, '2026-03-14 06:07:00+07'),
    ('00000000-0000-0000-0000-00000000a032', '00000000-0000-0000-0000-000000000462', '2026-03-14', 2, 7, 7, 0, 0, 0, 0, 1, 0.6800, '2026-03-14 06:07:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ageing_stock_snapshots (
    id, warehouse_id, variant_id, snapshot_date, days_in_stock, on_hand_qty, inventory_value, ageing_bucket
) VALUES
    ('00000000-0000-0000-0000-00000000a041', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000441', '2026-03-14', 6, 12, 1020000, '0_30'),
    ('00000000-0000-0000-0000-00000000a042', '00000000-0000-0000-0000-000000000462', '00000000-0000-0000-0000-000000000443', '2026-03-14', 40, 4, 240000, '31_60')
ON CONFLICT (id) DO NOTHING;

INSERT INTO purchase_recommendations (
    id, run_id, warehouse_id, variant_id, suggested_qty, reason_text, priority_score,
    status, created_at, reviewed_by_user_id, reviewed_at
) VALUES
    ('00000000-0000-0000-0000-00000000a051', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000442', 8, 'Forecast demand is above current available stock.', 0.9600, 'REVIEWED', '2026-03-14 06:08:00+07', '00000000-0000-0000-0000-000000000102', '2026-03-14 07:00:00+07'),
    ('00000000-0000-0000-0000-00000000a052', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000441', 4, 'Branch transfer reduced HCM coverage.', 0.7800, 'GENERATED', '2026-03-14 06:08:00+07', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO relocation_recommendations (
    id, warehouse_id, variant_id, from_location_id, to_location_id, heat_score_before,
    heat_score_after, reason_text, status, created_at, reviewed_by_user_id, reviewed_at
) VALUES
    ('00000000-0000-0000-0000-00000000a061', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000472', '00000000-0000-0000-0000-000000000473', 0.8700, 0.6200, 'Move one SQL title closer to combined pick zone for balanced load.', 'GENERATED', '2026-03-14 06:09:00+07', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO analytics_query_logs (
    id, requested_by_user_id, source_channel, query_name, request_payload, response_payload,
    latency_ms, status, created_at
) VALUES
    ('00000000-0000-0000-0000-00000000a071', '00000000-0000-0000-0000-000000000102', 'DASHBOARD', 'low_stock_and_forecast', '{"warehouse_id":"00000000-0000-0000-0000-000000000461"}'::jsonb, '{"records":2}'::jsonb, 184, 'SUCCESS', '2026-03-14 07:05:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO integration_outbox (
    id, aggregate_type, aggregate_id, event_type, payload, headers, status, retry_count, occurred_at, published_at
) VALUES
    ('00000000-0000-0000-0000-00000000a081', 'FORECAST_RUN', '00000000-0000-0000-0000-00000000a001', 'analytics.forecast.completed', '{"run_id":"00000000-0000-0000-0000-00000000a001","warehouse_id":"00000000-0000-0000-0000-000000000461"}'::jsonb, '{"trace_id":"ana-demo-001"}'::jsonb, 'PUBLISHED', 0, '2026-03-14 06:05:00+07', '2026-03-14 06:05:03+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO integration_inbox (
    id, source_service, event_id, event_type, payload, status, error_message, received_at, processed_at
) VALUES
    ('00000000-0000-0000-0000-00000000a082', 'inventory', '00000000-0000-0000-0000-000000000631', 'inventory.stock.low', '{"warehouse_id":"00000000-0000-0000-0000-000000000461","variant_id":"00000000-0000-0000-0000-000000000442"}'::jsonb, 'PROCESSED', NULL, '2026-03-14 08:35:04+07', '2026-03-14 08:35:06+07')
ON CONFLICT (id) DO NOTHING;

COMMIT;

\connect chatbot_db
BEGIN;

INSERT INTO chat_sessions (
    id, session_code, started_by_type, started_by_user_id, started_by_customer_id, channel,
    title, status, context, started_at, closed_at
) VALUES
    ('00000000-0000-0000-0000-00000000b001', 'CHAT-ADMIN-0001', 'USER',     '00000000-0000-0000-0000-000000000102', NULL,                            'ADMIN', 'Weekly inventory check', 'OPEN',   '{"warehouse_id":"00000000-0000-0000-0000-000000000461"}'::jsonb, '2026-03-14 08:05:00+07', NULL),
    ('00000000-0000-0000-0000-00000000b002', 'CHAT-CUS-0001',   'CUSTOMER', NULL,                            '00000000-0000-0000-0000-000000000701', 'WEB',   'Loan due date help',     'CLOSED', '{"customer_id":"00000000-0000-0000-0000-000000000701"}'::jsonb, '2026-03-13 20:10:00+07', '2026-03-13 20:15:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO chat_messages (
    id, session_id, sender_type, sender_user_id, sender_customer_id, content_type,
    content, model_name, prompt_tokens, completion_tokens, tool_calls, citations, created_at
) VALUES
    ('00000000-0000-0000-0000-00000000b011', '00000000-0000-0000-0000-00000000b001', 'USER',     '00000000-0000-0000-0000-000000000102', NULL,                            'TEXT',  'Show low stock items in HCM central library.', NULL,           NULL, NULL, '[]'::jsonb, '[]'::jsonb, '2026-03-14 08:05:00+07'),
    ('00000000-0000-0000-0000-00000000b012', '00000000-0000-0000-0000-00000000b001', 'BOT',      NULL,                            NULL,                            'TABLE', '1 item below reorder point: SKU-ML-001 with available_qty = 4.', 'gpt-5.4-thinking', 610, 142, '[{"tool":"sql","name":"low_stock_query"}]'::jsonb, '[{"source":"stock_balances","id":"00000000-0000-0000-0000-000000000484"}]'::jsonb, '2026-03-14 08:05:02+07'),
    ('00000000-0000-0000-0000-00000000b013', '00000000-0000-0000-0000-00000000b002', 'CUSTOMER', NULL,                            '00000000-0000-0000-0000-000000000701', 'TEXT',  'When is my due date for the machine learning book?', NULL,           NULL, NULL, '[]'::jsonb, '[]'::jsonb, '2026-03-13 20:10:00+07'),
    ('00000000-0000-0000-0000-00000000b014', '00000000-0000-0000-0000-00000000b002', 'BOT',      NULL,                            NULL,                            'TEXT',  'Your current due date is 2026-03-24 09:00:00+07.', 'gpt-5.4-thinking', 320, 74, '[{"tool":"sql","name":"loan_due_date_query"}]'::jsonb, '[{"source":"loan_items","id":"00000000-0000-0000-0000-000000000751"}]'::jsonb, '2026-03-13 20:10:03+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO chat_query_logs (
    id, session_id, user_message_id, sql_text, data_source, intent, status,
    latency_ms, error_message, created_at
) VALUES
    ('00000000-0000-0000-0000-00000000b021', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000b011', 'SELECT * FROM stock_balances WHERE warehouse_id = ''00000000-0000-0000-0000-000000000461'' AND status = ''LOW_STOCK'';', 'analytics_db', 'LOW_STOCK_CHECK', 'SUCCESS', 96, NULL, '2026-03-14 08:05:01+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO chat_saved_reports (
    id, session_id, title, report_type, payload, created_by_user_id, created_at
) VALUES
    ('00000000-0000-0000-0000-00000000b031', '00000000-0000-0000-0000-00000000b001', 'Low stock overview', 'KPI', '{"warehouse_id":"00000000-0000-0000-0000-000000000461","items":[{"variant_id":"00000000-0000-0000-0000-000000000442","available_qty":4}]}'::jsonb, '00000000-0000-0000-0000-000000000102', '2026-03-14 08:06:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO chat_feedback (
    id, message_id, rating, comment, created_by_user_id, created_by_customer_id, created_at
) VALUES
    ('00000000-0000-0000-0000-00000000b041', '00000000-0000-0000-0000-00000000b014', 5, 'The chatbot answered the due date clearly.', NULL, '00000000-0000-0000-0000-000000000701', '2026-03-13 20:11:00+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO integration_outbox (
    id, aggregate_type, aggregate_id, event_type, payload, headers, status, retry_count, occurred_at, published_at
) VALUES
    ('00000000-0000-0000-0000-00000000b051', 'CHAT_SESSION', '00000000-0000-0000-0000-00000000b001', 'chatbot.report.saved', '{"report_id":"00000000-0000-0000-0000-00000000b031","session_id":"00000000-0000-0000-0000-00000000b001"}'::jsonb, '{"trace_id":"chat-demo-001"}'::jsonb, 'PUBLISHED', 0, '2026-03-14 08:06:00+07', '2026-03-14 08:06:01+07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO integration_inbox (
    id, source_service, event_id, event_type, payload, status, error_message, received_at, processed_at
) VALUES
    ('00000000-0000-0000-0000-00000000b052', 'analytics', '00000000-0000-0000-0000-00000000a081', 'analytics.forecast.completed', '{"run_id":"00000000-0000-0000-0000-00000000a001","warehouse_id":"00000000-0000-0000-0000-000000000461"}'::jsonb, 'PROCESSED', NULL, '2026-03-14 06:05:04+07', '2026-03-14 06:05:05+07')
ON CONFLICT (id) DO NOTHING;

COMMIT;
-- ------------------------------------------------------------
-- Borrow harden demo seeds (Phase 1/2 validation)
-- ------------------------------------------------------------

\connect auth_db
BEGIN;

INSERT INTO permissions (code, module_name, action_name, description)
VALUES
    ('borrow.read', 'borrow', 'read', 'View customers, reservations and loans'),
    ('borrow.write', 'borrow', 'write', 'Create reservations, loans and returns')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('borrow.read', 'borrow.write')
WHERE r.code IN ('MANAGER', 'STAFF')
ON CONFLICT DO NOTHING;

COMMIT;

\connect borrow_db
BEGIN;

INSERT INTO membership_plans (
    id, code, name, description, max_active_loans, max_loan_days,
    max_renewal_count, reservation_hold_hours, fine_per_day,
    lost_item_fee_multiplier, is_active
) VALUES
    ('00000000-0000-0000-0000-000000000713', 'PLAN-LIMIT-ONE', 'Limit One Plan', 'Used for membership limit test case.', 1, 7, 0, 12, 4000, 1.00, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO customers (
    id, customer_code, full_name, email, phone, status, total_fine_balance
) VALUES
    ('00000000-0000-0000-0000-000000000703', 'CUS-HARDEN-01', 'Le Borrow Active', 'borrow.active@smartbook.local', '0912000003', 'ACTIVE', 0),
    ('00000000-0000-0000-0000-000000000704', 'CUS-HARDEN-02', 'Le Borrow Fine', 'borrow.fine@smartbook.local', '0912000004', 'ACTIVE', 25000),
    ('00000000-0000-0000-0000-000000000705', 'CUS-HARDEN-03', 'Le Borrow Limited', 'borrow.limit@smartbook.local', '0912000005', 'ACTIVE', 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO customer_preferences (customer_id)
VALUES
    ('00000000-0000-0000-0000-000000000703'),
    ('00000000-0000-0000-0000-000000000704'),
    ('00000000-0000-0000-0000-000000000705')
ON CONFLICT (customer_id) DO NOTHING;

INSERT INTO customer_memberships (
    id, customer_id, plan_id, card_number, start_date, end_date, status
) VALUES
    ('00000000-0000-0000-0000-000000000723', '00000000-0000-0000-0000-000000000703', '00000000-0000-0000-0000-000000000712', 'CARD-HARDEN-01', CURRENT_DATE - INTERVAL '3 day', CURRENT_DATE + INTERVAL '180 day', 'ACTIVE'),
    ('00000000-0000-0000-0000-000000000724', '00000000-0000-0000-0000-000000000704', '00000000-0000-0000-0000-000000000712', 'CARD-HARDEN-02', CURRENT_DATE - INTERVAL '3 day', CURRENT_DATE + INTERVAL '180 day', 'ACTIVE'),
    ('00000000-0000-0000-0000-000000000725', '00000000-0000-0000-0000-000000000705', '00000000-0000-0000-0000-000000000713', 'CARD-HARDEN-03', CURRENT_DATE - INTERVAL '3 day', CURRENT_DATE + INTERVAL '180 day', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

INSERT INTO loan_transactions (
    id, loan_number, customer_id, warehouse_id, handled_by_user_id, borrow_date, due_date, status, total_items, notes
) VALUES
    ('00000000-0000-0000-0000-000000000742', 'LOAN-HARDEN-01', '00000000-0000-0000-0000-000000000705', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000103', NOW() - INTERVAL '1 day', NOW() + INTERVAL '6 day', 'BORROWED', 1, 'Seeded active loan for membership limit test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO loan_items (
    id, loan_id, variant_id, due_date, status, item_condition_on_checkout
) VALUES
    ('00000000-0000-0000-0000-000000000753', '00000000-0000-0000-0000-000000000742', '00000000-0000-0000-0000-000000000441', NOW() + INTERVAL '6 day', 'BORROWED', 'GOOD')
ON CONFLICT (id) DO NOTHING;

COMMIT;

\connect inventory_db
BEGIN;

INSERT INTO book_variants (
    id, book_id, sku, isbn13, internal_barcode, cover_type, language_code,
    publish_year, condition_grade, unit_cost, list_price, replacement_cost,
    is_borrowable, is_sellable, is_track_by_unit, is_active
) VALUES
    ('00000000-0000-0000-0000-000000000449', '00000000-0000-0000-0000-000000000431', 'SKU-DB-OUT-001', '9786040000099', 'BC-DB-OUT-001', 'PAPERBACK', 'en', 2024, 'GOOD', 70000, 99000, 120000, TRUE, FALSE, FALSE, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO stock_balances (
    id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty,
    damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at
) VALUES
    ('00000000-0000-0000-0000-000000000487', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000449', '00000000-0000-0000-0000-000000000472', 0, 0, 0, 0, 0, 0, 0, 1, 'OUT_OF_STOCK', 1, NOW())
ON CONFLICT (id) DO NOTHING;

COMMIT;



-- Extended Seed Data V2 (Includes Warehouses & Locations)
SET client_encoding = 'UTF8';
\connect inventory_db
BEGIN;
INSERT INTO warehouses (id, code, name, warehouse_type, address_line1, district, province, country, manager_user_id, is_active) VALUES ('00000000-0000-0000-0000-000000000560', 'WH-DN-01', 'Da Nang Branch', 'BRANCH', '123 Main St', 'Hai Chau', 'Da Nang', 'Vietnam', '00000000-0000-0000-0000-000000000101', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO warehouse_settings (warehouse_id, reservation_hold_hours, allow_negative_stock, default_low_stock_threshold, enable_cycle_count, created_at, updated_at) VALUES ('00000000-0000-0000-0000-000000000560', 24, FALSE, 5, TRUE, NOW(), NOW()) ON CONFLICT DO NOTHING;
INSERT INTO warehouses (id, code, name, warehouse_type, address_line1, district, province, country, manager_user_id, is_active) VALUES ('00000000-0000-0000-0000-000000000561', 'WH-CT-01', 'Can Tho Branch', 'BRANCH', '123 Main St', 'Ninh Kieu', 'Can Tho', 'Vietnam', '00000000-0000-0000-0000-000000000101', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO warehouse_settings (warehouse_id, reservation_hold_hours, allow_negative_stock, default_low_stock_threshold, enable_cycle_count, created_at, updated_at) VALUES ('00000000-0000-0000-0000-000000000561', 24, FALSE, 5, TRUE, NOW(), NOW()) ON CONFLICT DO NOTHING;
INSERT INTO warehouses (id, code, name, warehouse_type, address_line1, district, province, country, manager_user_id, is_active) VALUES ('00000000-0000-0000-0000-000000000562', 'WH-HP-01', 'Hai Phong Branch', 'BRANCH', '123 Main St', 'Ngo Quyen', 'Hai Phong', 'Vietnam', '00000000-0000-0000-0000-000000000101', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO warehouse_settings (warehouse_id, reservation_hold_hours, allow_negative_stock, default_low_stock_threshold, enable_cycle_count, created_at, updated_at) VALUES ('00000000-0000-0000-0000-000000000562', 24, FALSE, 5, TRUE, NOW(), NOW()) ON CONFLICT DO NOTHING;
INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, barcode, capacity_qty, is_pickable, is_active) VALUES ('8f1d331a-1125-4867-ac86-eabde18d798e', '00000000-0000-0000-0000-000000000560', NULL, 'RCV-EXT', 'RECEIVING', 'LOC-RCV-560', 500, FALSE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, zone, barcode, is_pickable, is_active) VALUES ('370a3849-27e2-4eeb-b973-5166d5830699', '00000000-0000-0000-0000-000000000560', NULL, 'A', 'ZONE', 'A', 'LOC-Z-A-560', FALSE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, zone, shelf, barcode, is_pickable, is_active) VALUES ('f7e3ba02-f6c7-44d5-aba2-48a0bddd3f7b', '00000000-0000-0000-0000-000000000560', '370a3849-27e2-4eeb-b973-5166d5830699', 'A-01', 'SHELF', 'A', '01', 'LOC-S-A01-560', FALSE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, zone, aisle, shelf, bin, barcode, capacity_qty, is_pickable, is_active) VALUES ('b81f781d-6a9e-4b55-8f91-6fcdaee0a8d1', '00000000-0000-0000-0000-000000000560', 'f7e3ba02-f6c7-44d5-aba2-48a0bddd3f7b', 'A-01-01', 'SHELF_COMPARTMENT', 'A', NULL, '01', '01', 'LOC-A0101-560', 100, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, zone, aisle, shelf, bin, barcode, capacity_qty, is_pickable, is_active) VALUES ('2b2e2b82-11fa-445d-ae15-109707356294', '00000000-0000-0000-0000-000000000560', 'f7e3ba02-f6c7-44d5-aba2-48a0bddd3f7b', 'A-01-02', 'SHELF_COMPARTMENT', 'A', NULL, '01', '02', 'LOC-A0102-560', 100, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, zone, aisle, shelf, bin, barcode, capacity_qty, is_pickable, is_active) VALUES ('c2789e7e-61ae-4bbd-b086-b05954066b5b', '00000000-0000-0000-0000-000000000560', 'f7e3ba02-f6c7-44d5-aba2-48a0bddd3f7b', 'A-01-03', 'SHELF_COMPARTMENT', 'A', NULL, '01', '03', 'LOC-A0103-560', 100, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, barcode, capacity_qty, is_pickable, is_active) VALUES ('21791406-7fdd-4fe0-991f-b80c8d856da1', '00000000-0000-0000-0000-000000000561', NULL, 'RCV-EXT', 'RECEIVING', 'LOC-RCV-561', 500, FALSE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, zone, barcode, is_pickable, is_active) VALUES ('58fa272c-8e2e-4a2a-8122-613286c78abf', '00000000-0000-0000-0000-000000000561', NULL, 'A', 'ZONE', 'A', 'LOC-Z-A-561', FALSE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, zone, shelf, barcode, is_pickable, is_active) VALUES ('4198390f-0eb3-4500-8a13-de914b968b57', '00000000-0000-0000-0000-000000000561', '58fa272c-8e2e-4a2a-8122-613286c78abf', 'A-01', 'SHELF', 'A', '01', 'LOC-S-A01-561', FALSE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, zone, aisle, shelf, bin, barcode, capacity_qty, is_pickable, is_active) VALUES ('f1e42190-7a65-46a7-80d4-87fbc53d61cb', '00000000-0000-0000-0000-000000000561', '4198390f-0eb3-4500-8a13-de914b968b57', 'A-01-01', 'SHELF_COMPARTMENT', 'A', NULL, '01', '01', 'LOC-A0101-561', 100, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, zone, aisle, shelf, bin, barcode, capacity_qty, is_pickable, is_active) VALUES ('ad5d1615-055e-47a7-ad7d-da1db097a38a', '00000000-0000-0000-0000-000000000561', '4198390f-0eb3-4500-8a13-de914b968b57', 'A-01-02', 'SHELF_COMPARTMENT', 'A', NULL, '01', '02', 'LOC-A0102-561', 100, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, zone, aisle, shelf, bin, barcode, capacity_qty, is_pickable, is_active) VALUES ('efd6193c-de37-48e7-b8e1-77675d7c7f91', '00000000-0000-0000-0000-000000000561', '4198390f-0eb3-4500-8a13-de914b968b57', 'A-01-03', 'SHELF_COMPARTMENT', 'A', NULL, '01', '03', 'LOC-A0103-561', 100, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, barcode, capacity_qty, is_pickable, is_active) VALUES ('ceb65db9-7a38-4909-88bf-ef11d8946160', '00000000-0000-0000-0000-000000000562', NULL, 'RCV-EXT', 'RECEIVING', 'LOC-RCV-562', 500, FALSE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, zone, barcode, is_pickable, is_active) VALUES ('874c381b-a2b4-4cee-af80-5d8e88731b1e', '00000000-0000-0000-0000-000000000562', NULL, 'A', 'ZONE', 'A', 'LOC-Z-A-562', FALSE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, zone, shelf, barcode, is_pickable, is_active) VALUES ('8cd8407c-7072-4483-8363-d544b07c2e7f', '00000000-0000-0000-0000-000000000562', '874c381b-a2b4-4cee-af80-5d8e88731b1e', 'A-01', 'SHELF', 'A', '01', 'LOC-S-A01-562', FALSE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, zone, aisle, shelf, bin, barcode, capacity_qty, is_pickable, is_active) VALUES ('211339a3-4933-45ec-8d2f-d4a56e28f98c', '00000000-0000-0000-0000-000000000562', '8cd8407c-7072-4483-8363-d544b07c2e7f', 'A-01-01', 'SHELF_COMPARTMENT', 'A', NULL, '01', '01', 'LOC-A0101-562', 100, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, zone, aisle, shelf, bin, barcode, capacity_qty, is_pickable, is_active) VALUES ('e1e84ad1-8e41-44d5-81af-3f91068eb5a0', '00000000-0000-0000-0000-000000000562', '8cd8407c-7072-4483-8363-d544b07c2e7f', 'A-01-02', 'SHELF_COMPARTMENT', 'A', NULL, '01', '02', 'LOC-A0102-562', 100, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, zone, aisle, shelf, bin, barcode, capacity_qty, is_pickable, is_active) VALUES ('fa4eca3a-0db2-47dd-a84a-9574b45bc710', '00000000-0000-0000-0000-000000000562', '8cd8407c-7072-4483-8363-d544b07c2e7f', 'A-01-03', 'SHELF_COMPARTMENT', 'A', NULL, '01', '03', 'LOC-A0103-562', 100, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO books (id, book_code, title, description, publisher_id, edition, published_date, page_count, country_of_origin, default_language, is_active) VALUES ('00000000-0000-0000-0000-000000000800', 'BOOK-EXT-000', 'Clean Code','Extended description for Clean Code', '00000000-0000-0000-0000-000000000402', '1st', '2020-01-01', 300, 'USA', 'en', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO book_authors (book_id, author_id, author_order) VALUES ('00000000-0000-0000-0000-000000000800', '00000000-0000-0000-0000-000000000412', 1) ON CONFLICT DO NOTHING;
INSERT INTO book_categories (book_id, category_id) VALUES ('00000000-0000-0000-0000-000000000800', '00000000-0000-0000-0000-000000000423') ON CONFLICT DO NOTHING;
INSERT INTO book_variants (id, book_id, sku, isbn13, internal_barcode, cover_type, language_code, publish_year, condition_grade, unit_cost, list_price, replacement_cost, is_borrowable, is_sellable, is_track_by_unit, is_active) VALUES ('00000000-0000-0000-0000-000000000900', '00000000-0000-0000-0000-000000000800', 'SKU-EXT-000', '9780000000000', 'BC-EXT-000', 'PAPERBACK', 'en', 2020, 'NEW', 100000, 150000, 200000, TRUE, TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('1ea4d2e5-d18f-454f-92a3-bddb164c2ec8', '00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000900', 'f1e42190-7a65-46a7-80d4-87fbc53d61cb', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('57e962da-4e3d-4218-b379-758d3942d85e', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000900', '00000000-0000-0000-0000-000000000472', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('0c57aa81-ab8e-4415-9996-26eaafda2ca3', '00000000-0000-0000-0000-000000000562', '00000000-0000-0000-0000-000000000900', '211339a3-4933-45ec-8d2f-d4a56e28f98c', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO books (id, book_code, title, description, publisher_id, edition, published_date, page_count, country_of_origin, default_language, is_active) VALUES ('00000000-0000-0000-0000-000000000801', 'BOOK-EXT-001', 'Design Patterns','Extended description for Design Patterns', '00000000-0000-0000-0000-000000000402', '1st', '2021-01-01', 310, 'USA', 'en', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO book_authors (book_id, author_id, author_order) VALUES ('00000000-0000-0000-0000-000000000801', '00000000-0000-0000-0000-000000000413', 1) ON CONFLICT DO NOTHING;
INSERT INTO book_categories (book_id, category_id) VALUES ('00000000-0000-0000-0000-000000000801', '00000000-0000-0000-0000-000000000423') ON CONFLICT DO NOTHING;
INSERT INTO book_variants (id, book_id, sku, isbn13, internal_barcode, cover_type, language_code, publish_year, condition_grade, unit_cost, list_price, replacement_cost, is_borrowable, is_sellable, is_track_by_unit, is_active) VALUES ('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-000000000801', 'SKU-EXT-001', '9780000000001', 'BC-EXT-001', 'PAPERBACK', 'en', 2021, 'NEW', 100000, 150000, 200000, TRUE, TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('76484150-4a07-4e2f-b113-2c12ca60b949', '00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000901', 'efd6193c-de37-48e7-b8e1-77675d7c7f91', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('0077aadd-3aca-4bb3-a1c3-be1a50fc3089', '00000000-0000-0000-0000-000000000562', '00000000-0000-0000-0000-000000000901', 'e1e84ad1-8e41-44d5-81af-3f91068eb5a0', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('7259aced-5cdd-45f4-8d0e-03b0c4dd4495', '00000000-0000-0000-0000-000000000562', '00000000-0000-0000-0000-000000000901', '211339a3-4933-45ec-8d2f-d4a56e28f98c', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO books (id, book_code, title, description, publisher_id, edition, published_date, page_count, country_of_origin, default_language, is_active) VALUES ('00000000-0000-0000-0000-000000000802', 'BOOK-EXT-002', 'Refactoring','Extended description for Refactoring', '00000000-0000-0000-0000-000000000402', '1st', '2022-01-01', 320, 'USA', 'en', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO book_authors (book_id, author_id, author_order) VALUES ('00000000-0000-0000-0000-000000000802', '00000000-0000-0000-0000-000000000412', 1) ON CONFLICT DO NOTHING;
INSERT INTO book_categories (book_id, category_id) VALUES ('00000000-0000-0000-0000-000000000802', '00000000-0000-0000-0000-000000000423') ON CONFLICT DO NOTHING;
INSERT INTO book_variants (id, book_id, sku, isbn13, internal_barcode, cover_type, language_code, publish_year, condition_grade, unit_cost, list_price, replacement_cost, is_borrowable, is_sellable, is_track_by_unit, is_active) VALUES ('00000000-0000-0000-0000-000000000902', '00000000-0000-0000-0000-000000000802', 'SKU-EXT-002', '9780000000002', 'BC-EXT-002', 'PAPERBACK', 'en', 2022, 'NEW', 100000, 150000, 200000, TRUE, TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('e1cc2aed-23d3-407a-821f-8f6295a7bb54', '00000000-0000-0000-0000-000000000562', '00000000-0000-0000-0000-000000000902', '211339a3-4933-45ec-8d2f-d4a56e28f98c', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('5d4e5ad3-8189-4dad-98b2-150a61ca994e', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000902', '00000000-0000-0000-0000-000000000472', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('e9802550-f124-4ac9-a7e6-442fde815cc1', '00000000-0000-0000-0000-000000000560', '00000000-0000-0000-0000-000000000902', 'c2789e7e-61ae-4bbd-b086-b05954066b5b', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO books (id, book_code, title, description, publisher_id, edition, published_date, page_count, country_of_origin, default_language, is_active) VALUES ('00000000-0000-0000-0000-000000000803', 'BOOK-EXT-003', 'Clean Architecture','Extended description for Clean Architecture', '00000000-0000-0000-0000-000000000401', '1st', '2023-01-01', 330, 'USA', 'en', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO book_authors (book_id, author_id, author_order) VALUES ('00000000-0000-0000-0000-000000000803', '00000000-0000-0000-0000-000000000411', 1) ON CONFLICT DO NOTHING;
INSERT INTO book_categories (book_id, category_id) VALUES ('00000000-0000-0000-0000-000000000803', '00000000-0000-0000-0000-000000000423') ON CONFLICT DO NOTHING;
INSERT INTO book_variants (id, book_id, sku, isbn13, internal_barcode, cover_type, language_code, publish_year, condition_grade, unit_cost, list_price, replacement_cost, is_borrowable, is_sellable, is_track_by_unit, is_active) VALUES ('00000000-0000-0000-0000-000000000903', '00000000-0000-0000-0000-000000000803', 'SKU-EXT-003', '9780000000003', 'BC-EXT-003', 'PAPERBACK', 'en', 2023, 'NEW', 100000, 150000, 200000, TRUE, TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('2a4a6651-3bbd-495e-80cb-f4de2842db02', '00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000903', 'f1e42190-7a65-46a7-80d4-87fbc53d61cb', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('b556490a-7d22-4bda-a520-2a2542971755', '00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000903', 'efd6193c-de37-48e7-b8e1-77675d7c7f91', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('8fcc5f8e-5393-4b50-92a4-962cb4256cd7', '00000000-0000-0000-0000-000000000562', '00000000-0000-0000-0000-000000000903', 'fa4eca3a-0db2-47dd-a84a-9574b45bc710', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO books (id, book_code, title, description, publisher_id, edition, published_date, page_count, country_of_origin, default_language, is_active) VALUES ('00000000-0000-0000-0000-000000000804', 'BOOK-EXT-004', 'Domain-Driven Design','Extended description for Domain-Driven Design', '00000000-0000-0000-0000-000000000401', '1st', '2024-01-01', 340, 'USA', 'en', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO book_authors (book_id, author_id, author_order) VALUES ('00000000-0000-0000-0000-000000000804', '00000000-0000-0000-0000-000000000413', 1) ON CONFLICT DO NOTHING;
INSERT INTO book_categories (book_id, category_id) VALUES ('00000000-0000-0000-0000-000000000804', '00000000-0000-0000-0000-000000000422') ON CONFLICT DO NOTHING;
INSERT INTO book_variants (id, book_id, sku, isbn13, internal_barcode, cover_type, language_code, publish_year, condition_grade, unit_cost, list_price, replacement_cost, is_borrowable, is_sellable, is_track_by_unit, is_active) VALUES ('00000000-0000-0000-0000-000000000904', '00000000-0000-0000-0000-000000000804', 'SKU-EXT-004', '9780000000004', 'BC-EXT-004', 'PAPERBACK', 'en', 2024, 'NEW', 100000, 150000, 200000, TRUE, TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('6e642ced-162f-402d-9f91-bd39dedc18d0', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000904', '00000000-0000-0000-0000-000000000472', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('41c043ff-2bad-4b3b-bbab-5dce92733da5', '00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000904', 'efd6193c-de37-48e7-b8e1-77675d7c7f91', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('1ee49a86-aede-483b-8158-6d55e03cdd8c', '00000000-0000-0000-0000-000000000560', '00000000-0000-0000-0000-000000000904', 'b81f781d-6a9e-4b55-8f91-6fcdaee0a8d1', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO books (id, book_code, title, description, publisher_id, edition, published_date, page_count, country_of_origin, default_language, is_active) VALUES ('00000000-0000-0000-0000-000000000805', 'BOOK-EXT-005', 'Designing Data-Intensive Applications','Extended description for Designing Data-Intensive Applications', '00000000-0000-0000-0000-000000000401', '1st', '2020-01-01', 350, 'USA', 'en', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO book_authors (book_id, author_id, author_order) VALUES ('00000000-0000-0000-0000-000000000805', '00000000-0000-0000-0000-000000000412', 1) ON CONFLICT DO NOTHING;
INSERT INTO book_categories (book_id, category_id) VALUES ('00000000-0000-0000-0000-000000000805', '00000000-0000-0000-0000-000000000421') ON CONFLICT DO NOTHING;
INSERT INTO book_variants (id, book_id, sku, isbn13, internal_barcode, cover_type, language_code, publish_year, condition_grade, unit_cost, list_price, replacement_cost, is_borrowable, is_sellable, is_track_by_unit, is_active) VALUES ('00000000-0000-0000-0000-000000000905', '00000000-0000-0000-0000-000000000805', 'SKU-EXT-005', '9780000000005', 'BC-EXT-005', 'PAPERBACK', 'en', 2020, 'NEW', 100000, 150000, 200000, TRUE, TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('f49f4568-a30f-4ddc-8128-0a2e4fc939ce', '00000000-0000-0000-0000-000000000562', '00000000-0000-0000-0000-000000000905', '211339a3-4933-45ec-8d2f-d4a56e28f98c', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('00068ac8-ddb6-4654-9a68-f0b4fc36f3ce', '00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000905', 'ad5d1615-055e-47a7-ad7d-da1db097a38a', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('3109b8de-b591-49b9-b568-0754d3e5c07c', '00000000-0000-0000-0000-000000000560', '00000000-0000-0000-0000-000000000905', 'c2789e7e-61ae-4bbd-b086-b05954066b5b', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO books (id, book_code, title, description, publisher_id, edition, published_date, page_count, country_of_origin, default_language, is_active) VALUES ('00000000-0000-0000-0000-000000000806', 'BOOK-EXT-006', 'The Pragmatic Programmer','Extended description for The Pragmatic Programmer', '00000000-0000-0000-0000-000000000401', '1st', '2021-01-01', 360, 'USA', 'en', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO book_authors (book_id, author_id, author_order) VALUES ('00000000-0000-0000-0000-000000000806', '00000000-0000-0000-0000-000000000412', 1) ON CONFLICT DO NOTHING;
INSERT INTO book_categories (book_id, category_id) VALUES ('00000000-0000-0000-0000-000000000806', '00000000-0000-0000-0000-000000000421') ON CONFLICT DO NOTHING;
INSERT INTO book_variants (id, book_id, sku, isbn13, internal_barcode, cover_type, language_code, publish_year, condition_grade, unit_cost, list_price, replacement_cost, is_borrowable, is_sellable, is_track_by_unit, is_active) VALUES ('00000000-0000-0000-0000-000000000906', '00000000-0000-0000-0000-000000000806', 'SKU-EXT-006', '9780000000006', 'BC-EXT-006', 'PAPERBACK', 'en', 2021, 'NEW', 100000, 150000, 200000, TRUE, TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('43820f68-6a81-4ded-9ec6-aefea08b9746', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000906', '00000000-0000-0000-0000-000000000472', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('7676024f-88d9-496a-8de2-4c7e128638fe', '00000000-0000-0000-0000-000000000562', '00000000-0000-0000-0000-000000000906', '211339a3-4933-45ec-8d2f-d4a56e28f98c', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('3734f936-bae1-4188-97cc-eeb7fe0af3f7', '00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000906', 'ad5d1615-055e-47a7-ad7d-da1db097a38a', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO books (id, book_code, title, description, publisher_id, edition, published_date, page_count, country_of_origin, default_language, is_active) VALUES ('00000000-0000-0000-0000-000000000807', 'BOOK-EXT-007', 'Introduction to Algorithms','Extended description for Introduction to Algorithms', '00000000-0000-0000-0000-000000000402', '1st', '2022-01-01', 370, 'USA', 'en', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO book_authors (book_id, author_id, author_order) VALUES ('00000000-0000-0000-0000-000000000807', '00000000-0000-0000-0000-000000000413', 1) ON CONFLICT DO NOTHING;
INSERT INTO book_categories (book_id, category_id) VALUES ('00000000-0000-0000-0000-000000000807', '00000000-0000-0000-0000-000000000423') ON CONFLICT DO NOTHING;
INSERT INTO book_variants (id, book_id, sku, isbn13, internal_barcode, cover_type, language_code, publish_year, condition_grade, unit_cost, list_price, replacement_cost, is_borrowable, is_sellable, is_track_by_unit, is_active) VALUES ('00000000-0000-0000-0000-000000000907', '00000000-0000-0000-0000-000000000807', 'SKU-EXT-007', '9780000000007', 'BC-EXT-007', 'PAPERBACK', 'en', 2022, 'NEW', 100000, 150000, 200000, TRUE, TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('437c7872-4ca0-48ff-b72b-1bc7cf28d9cd', '00000000-0000-0000-0000-000000000560', '00000000-0000-0000-0000-000000000907', 'b81f781d-6a9e-4b55-8f91-6fcdaee0a8d1', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('5c93e166-764e-40a5-bd9d-dadeb9e0efe4', '00000000-0000-0000-0000-000000000560', '00000000-0000-0000-0000-000000000907', '2b2e2b82-11fa-445d-ae15-109707356294', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('ede23d1e-c0d6-4673-99eb-111503fa2a2f', '00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000907', 'ad5d1615-055e-47a7-ad7d-da1db097a38a', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO books (id, book_code, title, description, publisher_id, edition, published_date, page_count, country_of_origin, default_language, is_active) VALUES ('00000000-0000-0000-0000-000000000808', 'BOOK-EXT-008', 'Deep Learning','Extended description for Deep Learning', '00000000-0000-0000-0000-000000000402', '1st', '2023-01-01', 380, 'USA', 'en', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO book_authors (book_id, author_id, author_order) VALUES ('00000000-0000-0000-0000-000000000808', '00000000-0000-0000-0000-000000000411', 1) ON CONFLICT DO NOTHING;
INSERT INTO book_categories (book_id, category_id) VALUES ('00000000-0000-0000-0000-000000000808', '00000000-0000-0000-0000-000000000422') ON CONFLICT DO NOTHING;
INSERT INTO book_variants (id, book_id, sku, isbn13, internal_barcode, cover_type, language_code, publish_year, condition_grade, unit_cost, list_price, replacement_cost, is_borrowable, is_sellable, is_track_by_unit, is_active) VALUES ('00000000-0000-0000-0000-000000000908', '00000000-0000-0000-0000-000000000808', 'SKU-EXT-008', '9780000000008', 'BC-EXT-008', 'PAPERBACK', 'en', 2023, 'NEW', 100000, 150000, 200000, TRUE, TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('72f615f9-3906-4e8d-b921-364e7213d116', '00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000908', 'efd6193c-de37-48e7-b8e1-77675d7c7f91', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('c6b187d2-a13b-4068-824b-f5501f8fd57f', '00000000-0000-0000-0000-000000000562', '00000000-0000-0000-0000-000000000908', '211339a3-4933-45ec-8d2f-d4a56e28f98c', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('02d855c2-f528-4ec9-8ae4-910bb41c1f27', '00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000908', 'ad5d1615-055e-47a7-ad7d-da1db097a38a', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO books (id, book_code, title, description, publisher_id, edition, published_date, page_count, country_of_origin, default_language, is_active) VALUES ('00000000-0000-0000-0000-000000000809', 'BOOK-EXT-009', 'Pattern Recognition and Machine Learning','Extended description for Pattern Recognition and Machine Learning', '00000000-0000-0000-0000-000000000402', '1st', '2024-01-01', 390, 'USA', 'en', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO book_authors (book_id, author_id, author_order) VALUES ('00000000-0000-0000-0000-000000000809', '00000000-0000-0000-0000-000000000413', 1) ON CONFLICT DO NOTHING;
INSERT INTO book_categories (book_id, category_id) VALUES ('00000000-0000-0000-0000-000000000809', '00000000-0000-0000-0000-000000000423') ON CONFLICT DO NOTHING;
INSERT INTO book_variants (id, book_id, sku, isbn13, internal_barcode, cover_type, language_code, publish_year, condition_grade, unit_cost, list_price, replacement_cost, is_borrowable, is_sellable, is_track_by_unit, is_active) VALUES ('00000000-0000-0000-0000-000000000909', '00000000-0000-0000-0000-000000000809', 'SKU-EXT-009', '9780000000009', 'BC-EXT-009', 'PAPERBACK', 'en', 2024, 'NEW', 100000, 150000, 200000, TRUE, TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('02228e8c-e025-44df-bfcd-380d5a994fb8', '00000000-0000-0000-0000-000000000462', '00000000-0000-0000-0000-000000000909', '00000000-0000-0000-0000-000000000475', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('82026afc-cc0b-462e-ae35-f3c7d1aba3f4', '00000000-0000-0000-0000-000000000560', '00000000-0000-0000-0000-000000000909', 'b81f781d-6a9e-4b55-8f91-6fcdaee0a8d1', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('d71e22f5-8a25-4eeb-8c92-366902223b4a', '00000000-0000-0000-0000-000000000562', '00000000-0000-0000-0000-000000000909', 'fa4eca3a-0db2-47dd-a84a-9574b45bc710', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO books (id, book_code, title, description, publisher_id, edition, published_date, page_count, country_of_origin, default_language, is_active) VALUES ('00000000-0000-0000-0000-000000000810', 'BOOK-EXT-010', 'Artificial Intelligence: A Modern Approach','Extended description for Artificial Intelligence: A Modern Approach', '00000000-0000-0000-0000-000000000402', '1st', '2020-01-01', 400, 'USA', 'en', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO book_authors (book_id, author_id, author_order) VALUES ('00000000-0000-0000-0000-000000000810', '00000000-0000-0000-0000-000000000412', 1) ON CONFLICT DO NOTHING;
INSERT INTO book_categories (book_id, category_id) VALUES ('00000000-0000-0000-0000-000000000810', '00000000-0000-0000-0000-000000000421') ON CONFLICT DO NOTHING;
INSERT INTO book_variants (id, book_id, sku, isbn13, internal_barcode, cover_type, language_code, publish_year, condition_grade, unit_cost, list_price, replacement_cost, is_borrowable, is_sellable, is_track_by_unit, is_active) VALUES ('00000000-0000-0000-0000-000000000910', '00000000-0000-0000-0000-000000000810', 'SKU-EXT-010', '9780000000010', 'BC-EXT-010', 'PAPERBACK', 'en', 2020, 'NEW', 100000, 150000, 200000, TRUE, TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('396ae2c8-7ec9-4a50-a861-8e5b60dfa82c', '00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000910', 'efd6193c-de37-48e7-b8e1-77675d7c7f91', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('3f372d7e-d809-47a5-af42-b5f138847dfb', '00000000-0000-0000-0000-000000000560', '00000000-0000-0000-0000-000000000910', '2b2e2b82-11fa-445d-ae15-109707356294', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('703473bc-75c1-4a4c-ba3e-81cb8aadceae', '00000000-0000-0000-0000-000000000562', '00000000-0000-0000-0000-000000000910', '211339a3-4933-45ec-8d2f-d4a56e28f98c', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO books (id, book_code, title, description, publisher_id, edition, published_date, page_count, country_of_origin, default_language, is_active) VALUES ('00000000-0000-0000-0000-000000000811', 'BOOK-EXT-011', 'Grokking Algorithms','Extended description for Grokking Algorithms', '00000000-0000-0000-0000-000000000401', '1st', '2021-01-01', 410, 'USA', 'en', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO book_authors (book_id, author_id, author_order) VALUES ('00000000-0000-0000-0000-000000000811', '00000000-0000-0000-0000-000000000413', 1) ON CONFLICT DO NOTHING;
INSERT INTO book_categories (book_id, category_id) VALUES ('00000000-0000-0000-0000-000000000811', '00000000-0000-0000-0000-000000000423') ON CONFLICT DO NOTHING;
INSERT INTO book_variants (id, book_id, sku, isbn13, internal_barcode, cover_type, language_code, publish_year, condition_grade, unit_cost, list_price, replacement_cost, is_borrowable, is_sellable, is_track_by_unit, is_active) VALUES ('00000000-0000-0000-0000-000000000911', '00000000-0000-0000-0000-000000000811', 'SKU-EXT-011', '9780000000011', 'BC-EXT-011', 'PAPERBACK', 'en', 2021, 'NEW', 100000, 150000, 200000, TRUE, TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('a8e27612-386b-4d8f-b27c-48880ab46938', '00000000-0000-0000-0000-000000000560', '00000000-0000-0000-0000-000000000911', 'b81f781d-6a9e-4b55-8f91-6fcdaee0a8d1', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('5e0a865c-990e-4e55-bfaa-634cf7be1e6a', '00000000-0000-0000-0000-000000000560', '00000000-0000-0000-0000-000000000911', 'c2789e7e-61ae-4bbd-b086-b05954066b5b', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('ee9f4b88-553f-4422-af7d-f2f1c1bac779', '00000000-0000-0000-0000-000000000462', '00000000-0000-0000-0000-000000000911', '00000000-0000-0000-0000-000000000475', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO books (id, book_code, title, description, publisher_id, edition, published_date, page_count, country_of_origin, default_language, is_active) VALUES ('00000000-0000-0000-0000-000000000812', 'BOOK-EXT-012', 'Site Reliability Engineering','Extended description for Site Reliability Engineering', '00000000-0000-0000-0000-000000000402', '1st', '2022-01-01', 420, 'USA', 'en', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO book_authors (book_id, author_id, author_order) VALUES ('00000000-0000-0000-0000-000000000812', '00000000-0000-0000-0000-000000000411', 1) ON CONFLICT DO NOTHING;
INSERT INTO book_categories (book_id, category_id) VALUES ('00000000-0000-0000-0000-000000000812', '00000000-0000-0000-0000-000000000421') ON CONFLICT DO NOTHING;
INSERT INTO book_variants (id, book_id, sku, isbn13, internal_barcode, cover_type, language_code, publish_year, condition_grade, unit_cost, list_price, replacement_cost, is_borrowable, is_sellable, is_track_by_unit, is_active) VALUES ('00000000-0000-0000-0000-000000000912', '00000000-0000-0000-0000-000000000812', 'SKU-EXT-012', '9780000000012', 'BC-EXT-012', 'PAPERBACK', 'en', 2022, 'NEW', 100000, 150000, 200000, TRUE, TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('ef68fcaa-be88-4c17-8f91-d378ee499a5d', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000912', '00000000-0000-0000-0000-000000000472', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('b1aafa0b-d308-4138-af69-36cfa202b6e7', '00000000-0000-0000-0000-000000000560', '00000000-0000-0000-0000-000000000912', 'c2789e7e-61ae-4bbd-b086-b05954066b5b', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('fbb6b8d5-ad81-4af1-8d9e-3c7d58fe7d19', '00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000912', 'ad5d1615-055e-47a7-ad7d-da1db097a38a', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO books (id, book_code, title, description, publisher_id, edition, published_date, page_count, country_of_origin, default_language, is_active) VALUES ('00000000-0000-0000-0000-000000000813', 'BOOK-EXT-013', 'Building Microservices','Extended description for Building Microservices', '00000000-0000-0000-0000-000000000402', '1st', '2023-01-01', 430, 'USA', 'en', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO book_authors (book_id, author_id, author_order) VALUES ('00000000-0000-0000-0000-000000000813', '00000000-0000-0000-0000-000000000413', 1) ON CONFLICT DO NOTHING;
INSERT INTO book_categories (book_id, category_id) VALUES ('00000000-0000-0000-0000-000000000813', '00000000-0000-0000-0000-000000000422') ON CONFLICT DO NOTHING;
INSERT INTO book_variants (id, book_id, sku, isbn13, internal_barcode, cover_type, language_code, publish_year, condition_grade, unit_cost, list_price, replacement_cost, is_borrowable, is_sellable, is_track_by_unit, is_active) VALUES ('00000000-0000-0000-0000-000000000913', '00000000-0000-0000-0000-000000000813', 'SKU-EXT-013', '9780000000013', 'BC-EXT-013', 'PAPERBACK', 'en', 2023, 'NEW', 100000, 150000, 200000, TRUE, TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('2b28af12-238d-4964-a2dc-8b3e7f1bdca9', '00000000-0000-0000-0000-000000000560', '00000000-0000-0000-0000-000000000913', 'b81f781d-6a9e-4b55-8f91-6fcdaee0a8d1', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('45b09eb3-8be5-4a64-8dc2-013f3ef2fee1', '00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000913', 'ad5d1615-055e-47a7-ad7d-da1db097a38a', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('85e084b9-2252-4e56-8b29-f9ad45470f67', '00000000-0000-0000-0000-000000000562', '00000000-0000-0000-0000-000000000913', 'fa4eca3a-0db2-47dd-a84a-9574b45bc710', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO books (id, book_code, title, description, publisher_id, edition, published_date, page_count, country_of_origin, default_language, is_active) VALUES ('00000000-0000-0000-0000-000000000814', 'BOOK-EXT-014', 'Kubernetes Up and Running','Extended description for Kubernetes Up and Running', '00000000-0000-0000-0000-000000000402', '1st', '2024-01-01', 440, 'USA', 'en', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO book_authors (book_id, author_id, author_order) VALUES ('00000000-0000-0000-0000-000000000814', '00000000-0000-0000-0000-000000000411', 1) ON CONFLICT DO NOTHING;
INSERT INTO book_categories (book_id, category_id) VALUES ('00000000-0000-0000-0000-000000000814', '00000000-0000-0000-0000-000000000421') ON CONFLICT DO NOTHING;
INSERT INTO book_variants (id, book_id, sku, isbn13, internal_barcode, cover_type, language_code, publish_year, condition_grade, unit_cost, list_price, replacement_cost, is_borrowable, is_sellable, is_track_by_unit, is_active) VALUES ('00000000-0000-0000-0000-000000000914', '00000000-0000-0000-0000-000000000814', 'SKU-EXT-014', '9780000000014', 'BC-EXT-014', 'PAPERBACK', 'en', 2024, 'NEW', 100000, 150000, 200000, TRUE, TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('c264e06e-5011-4bf8-acff-7a2790d67ea9', '00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000914', 'efd6193c-de37-48e7-b8e1-77675d7c7f91', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('411dbf7d-5f9c-4bd4-b343-e1b0d33e5375', '00000000-0000-0000-0000-000000000560', '00000000-0000-0000-0000-000000000914', '2b2e2b82-11fa-445d-ae15-109707356294', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('2d0c7aca-bc1d-4eb2-b3bb-7a9ca70b0e87', '00000000-0000-0000-0000-000000000562', '00000000-0000-0000-0000-000000000914', 'e1e84ad1-8e41-44d5-81af-3f91068eb5a0', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;
COMMIT;
\connect borrow_db
BEGIN;
INSERT INTO customers (id, customer_code, full_name, email, phone, status, total_fine_balance) VALUES ('00000000-0000-0000-0000-000000000800', 'CUS-EXT-000', 'Vo Anh', 'vo.anh@smartbook.local', '0913000000', 'ACTIVE', 0) ON CONFLICT DO NOTHING;
INSERT INTO customer_memberships (id, customer_id, plan_id, card_number, start_date, end_date, status) VALUES ('00000000-0000-0000-0000-000000000800', '00000000-0000-0000-0000-000000000800', '00000000-0000-0000-0000-000000000711', 'CARD-EXT-000', CURRENT_DATE - INTERVAL '10 day', CURRENT_DATE + INTERVAL '355 day', 'ACTIVE') ON CONFLICT DO NOTHING;
INSERT INTO loan_transactions (id, loan_number, customer_id, warehouse_id, handled_by_user_id, borrow_date, due_date, status, total_items, notes) VALUES ('00000000-0000-0000-0000-000000000900', 'LOAN-EXT-000', '00000000-0000-0000-0000-000000000800', '00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000103', NOW() - INTERVAL '0 day', NOW() + INTERVAL '14 day', 'BORROWED', 1, 'Extended seeded loan') ON CONFLICT DO NOTHING;
INSERT INTO loan_items (id, loan_id, variant_id, due_date, status, item_condition_on_checkout) VALUES ('6231c852-d7a2-466b-9981-d4d32d6fe6e4', '00000000-0000-0000-0000-000000000900', '00000000-0000-0000-0000-000000000908', NOW() + INTERVAL '14 day', 'BORROWED', 'GOOD') ON CONFLICT DO NOTHING;
INSERT INTO customers (id, customer_code, full_name, email, phone, status, total_fine_balance) VALUES ('00000000-0000-0000-0000-000000000801', 'CUS-EXT-001', 'Hoang Lan', 'hoang.lan@smartbook.local', '0913000001', 'ACTIVE', 0) ON CONFLICT DO NOTHING;
INSERT INTO customer_memberships (id, customer_id, plan_id, card_number, start_date, end_date, status) VALUES ('00000000-0000-0000-0000-000000000801', '00000000-0000-0000-0000-000000000801', '00000000-0000-0000-0000-000000000711', 'CARD-EXT-001', CURRENT_DATE - INTERVAL '10 day', CURRENT_DATE + INTERVAL '355 day', 'ACTIVE') ON CONFLICT DO NOTHING;
INSERT INTO customers (id, customer_code, full_name, email, phone, status, total_fine_balance) VALUES ('00000000-0000-0000-0000-000000000802', 'CUS-EXT-002', 'Doan Du', 'doan.du@smartbook.local', '0913000002', 'ACTIVE', 0) ON CONFLICT DO NOTHING;
INSERT INTO customer_memberships (id, customer_id, plan_id, card_number, start_date, end_date, status) VALUES ('00000000-0000-0000-0000-000000000802', '00000000-0000-0000-0000-000000000802', '00000000-0000-0000-0000-000000000711', 'CARD-EXT-002', CURRENT_DATE - INTERVAL '10 day', CURRENT_DATE + INTERVAL '355 day', 'ACTIVE') ON CONFLICT DO NOTHING;
INSERT INTO loan_transactions (id, loan_number, customer_id, warehouse_id, handled_by_user_id, borrow_date, due_date, status, total_items, notes) VALUES ('00000000-0000-0000-0000-000000000902', 'LOAN-EXT-002', '00000000-0000-0000-0000-000000000802', '00000000-0000-0000-0000-000000000560', '00000000-0000-0000-0000-000000000103', NOW() - INTERVAL '2 day', NOW() + INTERVAL '12 day', 'BORROWED', 1, 'Extended seeded loan') ON CONFLICT DO NOTHING;
INSERT INTO loan_items (id, loan_id, variant_id, due_date, status, item_condition_on_checkout) VALUES ('0e6f12b7-a0b1-46b5-97db-d04a6b2d3c9e', '00000000-0000-0000-0000-000000000902', '00000000-0000-0000-0000-000000000913', NOW() + INTERVAL '12 day', 'BORROWED', 'GOOD') ON CONFLICT DO NOTHING;
INSERT INTO customers (id, customer_code, full_name, email, phone, status, total_fine_balance) VALUES ('00000000-0000-0000-0000-000000000803', 'CUS-EXT-003', 'Qieu Phong', 'qieu.phong@smartbook.local', '0913000003', 'ACTIVE', 0) ON CONFLICT DO NOTHING;
INSERT INTO customer_memberships (id, customer_id, plan_id, card_number, start_date, end_date, status) VALUES ('00000000-0000-0000-0000-000000000803', '00000000-0000-0000-0000-000000000803', '00000000-0000-0000-0000-000000000711', 'CARD-EXT-003', CURRENT_DATE - INTERVAL '10 day', CURRENT_DATE + INTERVAL '355 day', 'ACTIVE') ON CONFLICT DO NOTHING;
INSERT INTO customers (id, customer_code, full_name, email, phone, status, total_fine_balance) VALUES ('00000000-0000-0000-0000-000000000804', 'CUS-EXT-004', 'Doan P', 'doan.p@smartbook.local', '0913000004', 'ACTIVE', 0) ON CONFLICT DO NOTHING;
INSERT INTO customer_memberships (id, customer_id, plan_id, card_number, start_date, end_date, status) VALUES ('00000000-0000-0000-0000-000000000804', '00000000-0000-0000-0000-000000000804', '00000000-0000-0000-0000-000000000711', 'CARD-EXT-004', CURRENT_DATE - INTERVAL '10 day', CURRENT_DATE + INTERVAL '355 day', 'ACTIVE') ON CONFLICT DO NOTHING;
INSERT INTO loan_transactions (id, loan_number, customer_id, warehouse_id, handled_by_user_id, borrow_date, due_date, status, total_items, notes) VALUES ('00000000-0000-0000-0000-000000000904', 'LOAN-EXT-004', '00000000-0000-0000-0000-000000000804', '00000000-0000-0000-0000-000000000560', '00000000-0000-0000-0000-000000000103', NOW() - INTERVAL '4 day', NOW() + INTERVAL '10 day', 'BORROWED', 1, 'Extended seeded loan') ON CONFLICT DO NOTHING;
INSERT INTO loan_items (id, loan_id, variant_id, due_date, status, item_condition_on_checkout) VALUES ('9c686331-d7e3-4342-bdc7-a415035785b4', '00000000-0000-0000-0000-000000000904', '00000000-0000-0000-0000-000000000910', NOW() + INTERVAL '10 day', 'BORROWED', 'GOOD') ON CONFLICT DO NOTHING;
INSERT INTO customers (id, customer_code, full_name, email, phone, status, total_fine_balance) VALUES ('00000000-0000-0000-0000-000000000805', 'CUS-EXT-005', 'Le Loi', 'le.loi@smartbook.local', '0913000005', 'ACTIVE', 0) ON CONFLICT DO NOTHING;
INSERT INTO customer_memberships (id, customer_id, plan_id, card_number, start_date, end_date, status) VALUES ('00000000-0000-0000-0000-000000000805', '00000000-0000-0000-0000-000000000805', '00000000-0000-0000-0000-000000000711', 'CARD-EXT-005', CURRENT_DATE - INTERVAL '10 day', CURRENT_DATE + INTERVAL '355 day', 'ACTIVE') ON CONFLICT DO NOTHING;
INSERT INTO customers (id, customer_code, full_name, email, phone, status, total_fine_balance) VALUES ('00000000-0000-0000-0000-000000000806', 'CUS-EXT-006', 'Nguyen Trai', 'nguyen.trai@smartbook.local', '0913000006', 'ACTIVE', 0) ON CONFLICT DO NOTHING;
INSERT INTO customer_memberships (id, customer_id, plan_id, card_number, start_date, end_date, status) VALUES ('00000000-0000-0000-0000-000000000806', '00000000-0000-0000-0000-000000000806', '00000000-0000-0000-0000-000000000711', 'CARD-EXT-006', CURRENT_DATE - INTERVAL '10 day', CURRENT_DATE + INTERVAL '355 day', 'ACTIVE') ON CONFLICT DO NOTHING;
INSERT INTO loan_transactions (id, loan_number, customer_id, warehouse_id, handled_by_user_id, borrow_date, due_date, status, total_items, notes) VALUES ('00000000-0000-0000-0000-000000000906', 'LOAN-EXT-006', '00000000-0000-0000-0000-000000000806', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000103', NOW() - INTERVAL '6 day', NOW() + INTERVAL '8 day', 'BORROWED', 1, 'Extended seeded loan') ON CONFLICT DO NOTHING;
INSERT INTO loan_items (id, loan_id, variant_id, due_date, status, item_condition_on_checkout) VALUES ('4c8b07c4-ceba-4d5d-b6b0-6b4ad7b6b77c', '00000000-0000-0000-0000-000000000906', '00000000-0000-0000-0000-000000000902', NOW() + INTERVAL '8 day', 'BORROWED', 'GOOD') ON CONFLICT DO NOTHING;
INSERT INTO customers (id, customer_code, full_name, email, phone, status, total_fine_balance) VALUES ('00000000-0000-0000-0000-000000000807', 'CUS-EXT-007', 'Tran Hung Dao', 'tran.hung.dao@smartbook.local', '0913000007', 'ACTIVE', 0) ON CONFLICT DO NOTHING;
INSERT INTO customer_memberships (id, customer_id, plan_id, card_number, start_date, end_date, status) VALUES ('00000000-0000-0000-0000-000000000807', '00000000-0000-0000-0000-000000000807', '00000000-0000-0000-0000-000000000711', 'CARD-EXT-007', CURRENT_DATE - INTERVAL '10 day', CURRENT_DATE + INTERVAL '355 day', 'ACTIVE') ON CONFLICT DO NOTHING;
INSERT INTO customers (id, customer_code, full_name, email, phone, status, total_fine_balance) VALUES ('00000000-0000-0000-0000-000000000808', 'CUS-EXT-008', 'Ly Thuong Kiet', 'ly.thuong.kiet@smartbook.local', '0913000008', 'ACTIVE', 0) ON CONFLICT DO NOTHING;
INSERT INTO customer_memberships (id, customer_id, plan_id, card_number, start_date, end_date, status) VALUES ('00000000-0000-0000-0000-000000000808', '00000000-0000-0000-0000-000000000808', '00000000-0000-0000-0000-000000000711', 'CARD-EXT-008', CURRENT_DATE - INTERVAL '10 day', CURRENT_DATE + INTERVAL '355 day', 'ACTIVE') ON CONFLICT DO NOTHING;
INSERT INTO loan_transactions (id, loan_number, customer_id, warehouse_id, handled_by_user_id, borrow_date, due_date, status, total_items, notes) VALUES ('00000000-0000-0000-0000-000000000908', 'LOAN-EXT-008', '00000000-0000-0000-0000-000000000808', '00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000103', NOW() - INTERVAL '8 day', NOW() + INTERVAL '6 day', 'BORROWED', 1, 'Extended seeded loan') ON CONFLICT DO NOTHING;
INSERT INTO loan_items (id, loan_id, variant_id, due_date, status, item_condition_on_checkout) VALUES ('1f3b79df-8cc0-438c-b5fe-0dffcea04175', '00000000-0000-0000-0000-000000000908', '00000000-0000-0000-0000-000000000901', NOW() + INTERVAL '6 day', 'BORROWED', 'GOOD') ON CONFLICT DO NOTHING;
INSERT INTO customers (id, customer_code, full_name, email, phone, status, total_fine_balance) VALUES ('00000000-0000-0000-0000-000000000809', 'CUS-EXT-009', 'Ngo Quyen', 'ngo.quyen@smartbook.local', '0913000009', 'ACTIVE', 0) ON CONFLICT DO NOTHING;
INSERT INTO customer_memberships (id, customer_id, plan_id, card_number, start_date, end_date, status) VALUES ('00000000-0000-0000-0000-000000000809', '00000000-0000-0000-0000-000000000809', '00000000-0000-0000-0000-000000000711', 'CARD-EXT-009', CURRENT_DATE - INTERVAL '10 day', CURRENT_DATE + INTERVAL '355 day', 'ACTIVE') ON CONFLICT DO NOTHING;
COMMIT;
