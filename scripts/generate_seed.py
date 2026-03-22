import uuid
import random
import datetime
from pathlib import Path

MERGED_SEED_PATH = Path("data/smartbook_merged_seed.sql")
AUTO_BEGIN_MARKER = "-- BEGIN: AUTO-GENERATED EXTENDED SEED"
AUTO_END_MARKER = "-- END: AUTO-GENERATED EXTENDED SEED"
LEGACY_EXTENDED_HEADER = "-- Extended Seed Data V2 (Includes Warehouses & Locations)"


def write_to_merged_seed(sql_lines):
    generated_block = "\n".join([
        AUTO_BEGIN_MARKER,
        *sql_lines,
        AUTO_END_MARKER,
    ]) + "\n"

    if MERGED_SEED_PATH.exists():
        content = MERGED_SEED_PATH.read_text(encoding="utf-8")

        if AUTO_BEGIN_MARKER in content and AUTO_END_MARKER in content:
            start_idx = content.index(AUTO_BEGIN_MARKER)
            end_idx = content.index(AUTO_END_MARKER) + len(AUTO_END_MARKER)
            updated = content[:start_idx] + generated_block + content[end_idx:]
        elif LEGACY_EXTENDED_HEADER in content:
            start_idx = content.index(LEGACY_EXTENDED_HEADER)
            updated = content[:start_idx].rstrip() + "\n\n" + generated_block
        else:
            updated = content.rstrip() + "\n\n" + generated_block
    else:
        updated = generated_block

    MERGED_SEED_PATH.write_text(updated, encoding="utf-8")

def generate_sql():
    sql = []
    sql.append("-- Extended Seed Data")
    sql.append("SET client_encoding = 'UTF8';")

    # inventory_db
    sql.append("\\connect inventory_db")
    sql.append("BEGIN;")

    warehouse_hcm = '00000000-0000-0000-0000-000000000461'
    warehouse_hn = '00000000-0000-0000-0000-000000000462'
    publisher_ids = ['00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000402']
    category_ids = ['00000000-0000-0000-0000-000000000421', '00000000-0000-0000-0000-000000000422', '00000000-0000-0000-0000-000000000423']
    author_ids = ['00000000-0000-0000-0000-000000000411', '00000000-0000-0000-0000-000000000412', '00000000-0000-0000-0000-000000000413']
    locations_hcm = ['00000000-0000-0000-0000-000000000472', '00000000-0000-0000-0000-000000000473']
    locations_hn = ['00000000-0000-0000-0000-000000000475']

    books = []
    variants = []
    
    # 1. Books
    titles = [
        "Clean Code", "Design Patterns", "Refactoring", "Clean Architecture", 
        "Domain-Driven Design", "Designing Data-Intensive Applications", 
        "The Pragmatic Programmer", "Introduction to Algorithms",
        "Deep Learning", "Pattern Recognition and Machine Learning", 
        "Artificial Intelligence: A Modern Approach", "Grokking Algorithms",
        "Site Reliability Engineering", "Building Microservices", 
        "Kubernetes Up and Running"
    ]
    
    for i, title in enumerate(titles):
        book_id = f'00000000-0000-0000-0000-0000000008{i:02d}'
        pub_id = random.choice(publisher_ids)
        sql.append(f"INSERT INTO books (id, book_code, title, description, publisher_id, edition, published_date, page_count, country_of_origin, default_language, is_active) VALUES ('{book_id}', 'BOOK-EXT-{i:03d}', '{title}','Extended description for {title}', '{pub_id}', '1st', '{2020+i%5}-01-01', {300+i*10}, 'USA', 'en', TRUE) ON CONFLICT DO NOTHING;")
        books.append(book_id)
        
        # authors
        sql.append(f"INSERT INTO book_authors (book_id, author_id, author_order) VALUES ('{book_id}', '{random.choice(author_ids)}', 1) ON CONFLICT DO NOTHING;")
        
        # categories 
        sql.append(f"INSERT INTO book_categories (book_id, category_id) VALUES ('{book_id}', '{random.choice(category_ids)}') ON CONFLICT DO NOTHING;")
        
        # variants
        variant_id = f'00000000-0000-0000-0000-0000000009{i:02d}'
        variants.append(variant_id)
        isbn = f'978000000{i:04d}'
        sql.append(f"INSERT INTO book_variants (id, book_id, sku, isbn13, internal_barcode, cover_type, language_code, publish_year, condition_grade, unit_cost, list_price, replacement_cost, is_borrowable, is_sellable, is_track_by_unit, is_active) VALUES ('{variant_id}', '{book_id}', 'SKU-EXT-{i:03d}', '{isbn}', 'BC-EXT-{i:03d}', 'PAPERBACK', 'en', {2020+i%5}, 'NEW', 100000, 150000, 200000, TRUE, TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING;")
        
        # stock_balances for HCM
        sql.append(f"INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('{uuid.uuid4()}', '{warehouse_hcm}', '{variant_id}', '{random.choice(locations_hcm)}', 10, 10, 0, 0, 0, 0, 2, 5, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;")
        
        # stock_balances for HN
        sql.append(f"INSERT INTO stock_balances (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, reserved_qty, borrowed_qty, damaged_qty, in_transit_qty, safety_stock_qty, reorder_point, status, version, last_movement_at) VALUES ('{uuid.uuid4()}', '{warehouse_hn}', '{variant_id}', '{random.choice(locations_hn)}', 5, 5, 0, 0, 0, 0, 2, 3, 'AVAILABLE', 1, NOW()) ON CONFLICT DO NOTHING;")

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
        
        # Membership
        mem_id = f'00000000-0000-0000-0000-0000000008{i:02d}'
        sql.append(f"INSERT INTO customer_memberships (id, customer_id, plan_id, card_number, start_date, end_date, status) VALUES ('{mem_id}', '{cust_id}', '{plan_id}', 'CARD-EXT-{i:03d}', CURRENT_DATE - INTERVAL '10 day', CURRENT_DATE + INTERVAL '355 day', 'ACTIVE') ON CONFLICT DO NOTHING;")
        
        # Loans
        # Add a loan for every customer
        if i % 2 == 0:
            loan_id = f'00000000-0000-0000-0000-0000000009{i:02d}'
            staff_id = '00000000-0000-0000-0000-000000000103'
            sql.append(f"INSERT INTO loan_transactions (id, loan_number, customer_id, warehouse_id, handled_by_user_id, borrow_date, due_date, status, total_items, notes) VALUES ('{loan_id}', 'LOAN-EXT-{i:03d}', '{cust_id}', '{warehouse_hcm}', '{staff_id}', NOW() - INTERVAL '{i} day', NOW() + INTERVAL '{14-i} day', 'BORROWED', 1, 'Extended seeded loan') ON CONFLICT DO NOTHING;")
            
            # Loan Item
            loan_item_id = str(uuid.uuid4())
            var_id = random.choice(variants)
            sql.append(f"INSERT INTO loan_items (id, loan_id, variant_id, due_date, status, item_condition_on_checkout) VALUES ('{loan_item_id}', '{loan_id}', '{var_id}', NOW() + INTERVAL '{14-i} day', 'BORROWED', 'GOOD') ON CONFLICT DO NOTHING;")

    sql.append("COMMIT;")
    
    write_to_merged_seed(sql)

if __name__ == '__main__':
    generate_sql()
