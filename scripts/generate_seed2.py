import uuid
import random

def generate_sql():
    sql = []
    sql.append("-- Extended Seed Data V2 (Includes Warehouses & Locations)")
    sql.append("SET client_encoding = 'UTF8';")

    # inventory_db
    sql.append("\\connect inventory_db")
    sql.append("BEGIN;")

    manager_id = '00000000-0000-0000-0000-000000000101' # System Admin
    
    # 1. New Warehouses
    new_warehouses = []
    wh_data = [
        ("Da Nang Branch", "WH-DN-01", "Hai Chau", "Da Nang"),
        ("Can Tho Branch", "WH-CT-01", "Ninh Kieu", "Can Tho"),
        ("Hai Phong Branch", "WH-HP-01", "Ngo Quyen", "Hai Phong")
    ]
    for i, (name, code, district, province) in enumerate(wh_data):
        wh_id = f'00000000-0000-0000-0000-00000000056{i}'
        new_warehouses.append(wh_id)
        sql.append(f"INSERT INTO warehouses (id, code, name, warehouse_type, address_line1, district, province, country, manager_user_id, is_active) VALUES ('{wh_id}', '{code}', '{name}', 'BRANCH', '123 Main St', '{district}', '{province}', 'Vietnam', '{manager_id}', TRUE) ON CONFLICT DO NOTHING;")
        
        # Settings
        sql.append(f"INSERT INTO warehouse_settings (warehouse_id, reservation_hold_hours, allow_negative_stock, default_low_stock_threshold, enable_cycle_count, created_at, updated_at) VALUES ('{wh_id}', 24, FALSE, 5, TRUE, NOW(), NOW()) ON CONFLICT DO NOTHING;")

    # 2. New Locations/Shelves per new warehouse
    locations = []
    for i, wh_id in enumerate(new_warehouses):
        loc_id_rcv = str(uuid.uuid4())
        sql.append(f"INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, barcode, capacity_qty, is_pickable, is_active) VALUES ('{loc_id_rcv}', '{wh_id}', NULL, 'RCV-EXT', 'RECEIVING', 'LOC-RCV-{wh_id[-3:]}', 500, FALSE, TRUE) ON CONFLICT DO NOTHING;")
        
        zone_a_id = str(uuid.uuid4())
        sql.append(f"INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, zone, barcode, is_pickable, is_active) VALUES ('{zone_a_id}', '{wh_id}', NULL, 'A', 'ZONE', 'A', 'LOC-Z-A-{wh_id[-3:]}', FALSE, TRUE) ON CONFLICT DO NOTHING;")

        shelf_a1_id = str(uuid.uuid4())
        sql.append(f"INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, zone, shelf, barcode, is_pickable, is_active) VALUES ('{shelf_a1_id}', '{wh_id}', '{zone_a_id}', 'A-01', 'SHELF', 'A', '01', 'LOC-S-A01-{wh_id[-3:]}', FALSE, TRUE) ON CONFLICT DO NOTHING;")

        for j in range(3):
            loc_id = str(uuid.uuid4())
            locations.append((wh_id, loc_id))
            sql.append(f"INSERT INTO locations (id, warehouse_id, parent_location_id, location_code, location_type, zone, aisle, shelf, bin, barcode, capacity_qty, is_pickable, is_active) VALUES ('{loc_id}', '{wh_id}', '{shelf_a1_id}', 'A-01-0{j+1}', 'SHELF_COMPARTMENT', 'A', NULL, '01', '0{j+1}', 'LOC-A010{j+1}-{wh_id[-3:]}', 100, TRUE, TRUE) ON CONFLICT DO NOTHING;")

    # Books & Stock
    publisher_ids = ['00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000402']
    category_ids = ['00000000-0000-0000-0000-000000000421', '00000000-0000-0000-0000-000000000422', '00000000-0000-0000-0000-000000000423']
    author_ids = ['00000000-0000-0000-0000-000000000411', '00000000-0000-0000-0000-000000000412', '00000000-0000-0000-0000-000000000413']
    
    titles = [
        "Clean Code", "Design Patterns", "Refactoring", "Clean Architecture", 
        "Domain-Driven Design", "Designing Data-Intensive Applications", 
        "The Pragmatic Programmer", "Introduction to Algorithms",
        "Deep Learning", "Pattern Recognition and Machine Learning", 
        "Artificial Intelligence: A Modern Approach", "Grokking Algorithms",
        "Site Reliability Engineering", "Building Microservices", 
        "Kubernetes Up and Running"
    ]
    variants = []
    
    for i, title in enumerate(titles):
        book_id = f'00000000-0000-0000-0000-0000000008{i:02d}'
        pub_id = random.choice(publisher_ids)
        sql.append(f"INSERT INTO books (id, book_code, title, description, publisher_id, edition, published_date, page_count, country_of_origin, default_language, is_active) VALUES ('{book_id}', 'BOOK-EXT-{i:03d}', '{title}','Extended description for {title}', '{pub_id}', '1st', '{2020+i%5}-01-01', {300+i*10}, 'USA', 'en', TRUE) ON CONFLICT DO NOTHING;")
        
        sql.append(f"INSERT INTO book_authors (book_id, author_id, author_order) VALUES ('{book_id}', '{random.choice(author_ids)}', 1) ON CONFLICT DO NOTHING;")
        sql.append(f"INSERT INTO book_categories (book_id, category_id) VALUES ('{book_id}', '{random.choice(category_ids)}') ON CONFLICT DO NOTHING;")
        
        variant_id = f'00000000-0000-0000-0000-0000000009{i:02d}'
        variants.append(variant_id)
        isbn = f'978000000{i:04d}'
        sql.append(f"INSERT INTO book_variants (id, book_id, sku, isbn13, internal_barcode, cover_type, language_code, publish_year, condition_grade, unit_cost, list_price, replacement_cost, is_borrowable, is_sellable, is_track_by_unit, is_active) VALUES ('{variant_id}', '{book_id}', 'SKU-EXT-{i:03d}', '{isbn}', 'BC-EXT-{i:03d}', 'PAPERBACK', 'en', {2020+i%5}, 'NEW', 100000, 150000, 200000, TRUE, TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING;")
        
        # Distribute stock to random locations in new warehouses + existing HCM/HN
        existing_whs = [('00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000472'), 
                        ('00000000-0000-0000-0000-000000000462', '00000000-0000-0000-0000-000000000475')]
        all_locs = locations + existing_whs
        sampled_locs = random.sample(all_locs, 3) 
        
        for wh, loc in sampled_locs:
            sql.append(f"INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('{uuid.uuid4()}', '{wh}', '{variant_id}', '{loc}', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;")

    sql.append("COMMIT;")

    # borrow_db 
    sql.append("\\connect borrow_db")
    sql.append("BEGIN;")

    # Add customers
    customer_ids = []
    plan_id = '00000000-0000-0000-0000-000000000711' # PLAN-BASIC
    
    names = ["Vo Anh", "Hoang Lan", "Doan Du", "Qieu Phong", "Doan P", "Le Loi", "Nguyen Trai", "Tran Hung Dao", "Ly Thuong Kiet", "Ngo Quyen"]
    for i, name in enumerate(names):
        cust_id = f'00000000-0000-0000-0000-0000000008{i:02d}'
        customer_ids.append(cust_id)
        email = name.lower().replace(" ", ".") + "@smartbook.local"
        sql.append(f"INSERT INTO customers (id, customer_code, full_name, email, phone, status, total_fine_balance) VALUES ('{cust_id}', 'CUS-EXT-{i:03d}', '{name}', '{email}', '0913000{i:03d}', 'ACTIVE', 0) ON CONFLICT DO NOTHING;")
        
        mem_id = f'00000000-0000-0000-0000-0000000008{i:02d}'
        sql.append(f"INSERT INTO customer_memberships (id, customer_id, plan_id, card_number, start_date, end_date, status) VALUES ('{mem_id}', '{cust_id}', '{plan_id}', 'CARD-EXT-{i:03d}', CURRENT_DATE - INTERVAL '10 day', CURRENT_DATE + INTERVAL '355 day', 'ACTIVE') ON CONFLICT DO NOTHING;")
        
        if i % 2 == 0:
            loan_id = f'00000000-0000-0000-0000-0000000009{i:02d}'
            staff_id = '00000000-0000-0000-0000-000000000103'
            wh_id = random.choice([x[0] for x in locations] + ['00000000-0000-0000-0000-000000000461'])
            sql.append(f"INSERT INTO loan_transactions (id, loan_number, customer_id, warehouse_id, handled_by_user_id, borrow_date, due_date, status, total_items, notes) VALUES ('{loan_id}', 'LOAN-EXT-{i:03d}', '{cust_id}', '{wh_id}', '{staff_id}', NOW() - INTERVAL '{i} day', NOW() + INTERVAL '{14-i} day', 'BORROWED', 1, 'Extended seeded loan') ON CONFLICT DO NOTHING;")
            
            loan_item_id = str(uuid.uuid4())
            var_id = random.choice(variants)
            sql.append(f"INSERT INTO loan_items (id, loan_id, variant_id, due_date, status, item_condition_on_checkout) VALUES ('{loan_item_id}', '{loan_id}', '{var_id}', NOW() + INTERVAL '{14-i} day', 'BORROWED', 'GOOD') ON CONFLICT DO NOTHING;")

    sql.append("COMMIT;")
    
    with open("data/smartbook_extended_seed.sql", "w") as f:
        f.write("\n".join(sql))

if __name__ == '__main__':
    generate_sql()
