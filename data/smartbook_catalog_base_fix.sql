-- Corrects the base demo catalog that `prisma db seed` writes
-- (services/inventory-service/prisma/seed.js): Vietnamese text stored without
-- diacritics, and authors linked to the wrong books (Project Hail Mary -> To Hoai,
-- Tư Duy Phản Biện -> Xuan Dieu, Số đỏ / Chiếc lá cuối cùng -> Nam Cao, ...).
--
-- Applied by scripts/seed-catalog-enrichment.mjs right after the enrichment
-- seed, so it runs on every `pnpm demo:seed` and `pnpm demo:upgrade`.
-- Idempotent and keyed by book_code / category slug / author name (ids differ
-- between databases): re-running it, or re-running seed.js before it, converges
-- on the same result.
--
-- The base titles that have no real cover photo (BK-001..005, 008, 009,
-- EXT-001, EXT-002 and the imported "Dế mèn phiêu lưu ký") are removed from the
-- catalog altogether at the end: every public book has a real cover. Their past
-- loans in borrow_db stay as history (the book shows as no longer catalogued).

BEGIN;

-- Finds or creates the author `p_new`, folds every author named like one of
-- `p_old` (case-insensitive) into it - links and aliases included - and sets
-- the biography when one is given.
CREATE FUNCTION pg_temp.sb_author(p_old text[], p_new text, p_bio text) RETURNS uuid AS $$
DECLARE
  target uuid;
  other uuid;
BEGIN
  SELECT id INTO target FROM authors WHERE full_name = p_new;
  IF target IS NULL THEN
    SELECT id INTO target FROM authors
      WHERE lower(btrim(full_name)) = ANY (SELECT lower(o) FROM unnest(p_old) o)
      ORDER BY created_at, id LIMIT 1;
    IF target IS NULL THEN
      INSERT INTO authors (full_name, biography) VALUES (p_new, p_bio) RETURNING id INTO target;
    ELSE
      UPDATE authors SET full_name = p_new WHERE id = target;
    END IF;
  END IF;

  FOR other IN
    SELECT id FROM authors
    WHERE id <> target AND lower(btrim(full_name)) = ANY (SELECT lower(o) FROM unnest(p_old) o)
  LOOP
    INSERT INTO book_authors (book_id, author_id, author_order)
      SELECT book_id, target, author_order FROM book_authors WHERE author_id = other
      ON CONFLICT DO NOTHING;
    DELETE FROM book_authors WHERE author_id = other;
    DELETE FROM author_aliases a WHERE a.author_id = other
      AND EXISTS (SELECT 1 FROM author_aliases t WHERE t.author_id = target AND t.normalized_alias = a.normalized_alias);
    UPDATE author_aliases SET author_id = target WHERE author_id = other;
    DELETE FROM authors WHERE id = other;
  END LOOP;

  IF p_bio IS NOT NULL THEN
    UPDATE authors SET biography = p_bio, updated_at = now()
      WHERE id = target AND biography IS DISTINCT FROM p_bio;
  END IF;
  RETURN target;
END;
$$ LANGUAGE plpgsql;

-- Makes `p_authors` (in order) the exact author list of the book `p_code`.
CREATE FUNCTION pg_temp.sb_book_authors(p_code text, p_authors text[]) RETURNS void AS $$
DECLARE
  book uuid;
BEGIN
  SELECT id INTO book FROM books WHERE book_code = p_code;
  IF book IS NULL THEN RETURN; END IF;
  DELETE FROM book_authors ba WHERE ba.book_id = book
    AND ba.author_id NOT IN (SELECT a.id FROM authors a WHERE a.full_name = ANY (p_authors));
  INSERT INTO book_authors (book_id, author_id, author_order)
    SELECT book, a.id, array_position(p_authors, a.full_name)
    FROM authors a WHERE a.full_name = ANY (p_authors)
    ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Makes `p_slugs` the exact category list of the book `p_code`.
CREATE FUNCTION pg_temp.sb_book_categories(p_code text, p_slugs text[]) RETURNS void AS $$
DECLARE
  book uuid;
BEGIN
  SELECT id INTO book FROM books WHERE book_code = p_code;
  IF book IS NULL THEN RETURN; END IF;
  DELETE FROM book_categories bc WHERE bc.book_id = book
    AND bc.category_id NOT IN (SELECT c.id FROM categories c WHERE c.slug = ANY (p_slugs));
  INSERT INTO book_categories (book_id, category_id)
    SELECT book, c.id FROM categories c WHERE c.slug = ANY (p_slugs)
    ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Removes the documents listed in sb_touched_docs that no longer have a single
-- line, with the picking/packing tasks of an emptied outbound order. A staff
-- task that pointed at an emptied document keeps its text, without the link.
CREATE FUNCTION pg_temp.sb_drop_emptied_documents() RETURNS void AS $$
BEGIN
  DELETE FROM picking_tasks p WHERE p.id IN (SELECT id FROM sb_touched_docs WHERE kind = 'picking_task')
    AND NOT EXISTS (SELECT 1 FROM picking_task_items i WHERE i.picking_task_id = p.id);
  DELETE FROM packing_tasks p WHERE p.id IN (SELECT id FROM sb_touched_docs WHERE kind = 'packing_task')
    AND NOT EXISTS (SELECT 1 FROM packing_task_items i WHERE i.packing_task_id = p.id);

  CREATE TEMP TABLE sb_emptied ON COMMIT DROP AS
    SELECT t.kind, t.id FROM sb_touched_docs t
    WHERE (t.kind = 'goods_receipt' AND NOT EXISTS (SELECT 1 FROM goods_receipt_items i WHERE i.goods_receipt_id = t.id))
       OR (t.kind = 'purchase_order' AND NOT EXISTS (SELECT 1 FROM purchase_order_items i WHERE i.purchase_order_id = t.id))
       OR (t.kind = 'stock_audit' AND NOT EXISTS (SELECT 1 FROM stock_audit_lines i WHERE i.stock_audit_id = t.id))
       OR (t.kind = 'outbound_order' AND NOT EXISTS (SELECT 1 FROM outbound_order_items i WHERE i.outbound_order_id = t.id))
       OR (t.kind = 'supplier_invoice' AND NOT EXISTS (SELECT 1 FROM supplier_delivery_invoice_items i WHERE i.invoice_id = t.id))
       OR (t.kind = 'transfer_order' AND NOT EXISTS (SELECT 1 FROM transfer_order_items i WHERE i.transfer_order_id = t.id));

  UPDATE staff_tasks SET related_entity_type = NULL, related_entity_id = NULL, updated_at = now()
    WHERE related_entity_id IN (SELECT id FROM sb_emptied);
  DELETE FROM picking_tasks WHERE root_order_id IN (SELECT id FROM sb_emptied WHERE kind = 'outbound_order');
  DELETE FROM packing_tasks WHERE root_order_id IN (SELECT id FROM sb_emptied WHERE kind = 'outbound_order');
  DELETE FROM outbound_orders WHERE id IN (SELECT id FROM sb_emptied WHERE kind = 'outbound_order');
  DELETE FROM transfer_orders WHERE id IN (SELECT id FROM sb_emptied WHERE kind = 'transfer_order');
  DELETE FROM supplier_delivery_invoices WHERE id IN (SELECT id FROM sb_emptied WHERE kind = 'supplier_invoice');
  DELETE FROM goods_receipts WHERE id IN (SELECT id FROM sb_emptied WHERE kind = 'goods_receipt');
  DELETE FROM purchase_orders WHERE id IN (SELECT id FROM sb_emptied WHERE kind = 'purchase_order');
  DELETE FROM stock_audits WHERE id IN (SELECT id FROM sb_emptied WHERE kind = 'stock_audit');
  DROP TABLE sb_emptied;
END;
$$ LANGUAGE plpgsql;

-- ── categories ──
UPDATE categories c SET name = v.name, description = v.description, updated_at = now()
FROM (VALUES
  ('am-thuc', 'Ẩm thực', 'Sách nấu ăn, ẩm thực, phong cách sống'),
  ('kinh-te', 'Kinh tế', 'Sách kinh tế, kinh doanh, tài chính, đầu tư'),
  ('ky-nang-song', 'Kỹ năng sống', 'Sách kỹ năng sống, phát triển bản thân, tâm lý'),
  ('ky-thuat', 'Kỹ thuật - CNTT', 'Sách kỹ thuật, công nghệ thông tin, lập trình'),
  ('congtac-vien', 'Lịch sử - Chính trị', 'Sách lịch sử, chính trị, xã hội'),
  ('nuoi-day-con', 'Nuôi dạy con', 'Sách nuôi dạy con, giáo dục trẻ em'),
  ('thieu-nhi', 'Thiếu nhi', 'Sách tranh, truyện cho trẻ em'),
  ('truyen-ngan', 'Truyện ngắn', 'Truyện ngắn, truyện dài, tiểu luận'),
  ('van-hoc-nuoc-ngoai', 'Văn học nước ngoài', 'Tác phẩm văn học nước ngoài, kinh điển và đương đại'),
  ('van-hoc-viet-nam', 'Văn học Việt Nam', 'Tác phẩm văn học Việt Nam, từ cổ điển đến hiện đại')
) AS v(slug, name, description)
WHERE c.slug = v.slug AND (c.name, c.description) IS DISTINCT FROM (v.name, v.description);

-- ── publishers (skipped where the accented name already exists as another row) ──
UPDATE publishers p SET name = v.name, address = v.address, updated_at = now()
FROM (VALUES
  ('KIM-DONG', 'Nhà xuất bản Kim Đồng', '45 Hàm Nghi, Quận 1, TP.HCM'),
  ('NXB-GD', 'Nhà xuất bản Giáo dục', '81 Trần Hưng Đạo, Hoàn Kiếm, Hà Nội'),
  ('NXB-TRE', 'Nhà xuất bản Trẻ', '123 Nguyễn Du, Quận 1, TP.HCM'),
  ('FIRSTNEWS', 'First News - Trí Việt', '56 Nguyễn Cửu Vân, Bình Thạnh, TP.HCM')
) AS v(code, name, address)
WHERE p.code = v.code AND p.name IS DISTINCT FROM v.name
  AND NOT EXISTS (SELECT 1 FROM publishers o WHERE o.name = v.name AND o.code <> v.code);

-- ── authors ──
SELECT pg_temp.sb_author(ARRAY['Nam Cao'], 'Nam Cao',
  'Nam Cao (1915–1951) là nhà văn hiện thực xuất sắc của văn học Việt Nam, tác giả “Chí Phèo”, “Lão Hạc”, “Đời thừa”.');
SELECT pg_temp.sb_author(ARRAY['Xuan Dieu'], 'Xuân Diệu',
  'Xuân Diệu (1916–1985) là nhà thơ lớn của phong trào Thơ mới, tác giả các tập “Thơ thơ”, “Gửi hương cho gió”.');
SELECT pg_temp.sb_author(ARRAY['To Hoai'], 'Tô Hoài',
  'Tô Hoài (1920–2014) là nhà văn Việt Nam, tác giả “Dế Mèn phiêu lưu ký”, “Vợ chồng A Phủ”.');
SELECT pg_temp.sb_author(ARRAY['Ngo Tat Lu', 'Ngo Tat To'], 'Ngô Tất Tố',
  'Ngô Tất Tố (1894–1954) là nhà văn, nhà báo hiện thực, tác giả “Tắt đèn”, “Lều chõng”.');
SELECT pg_temp.sb_author(ARRAY['Tran Dang Khoa'], 'Trần Đăng Khoa',
  'Trần Đăng Khoa (sinh 1958) là nhà thơ Việt Nam, nổi tiếng từ nhỏ với tập thơ “Góc sân và khoảng trời”.');
SELECT pg_temp.sb_author(ARRAY['Nguyen Nhat Anh'], 'Nguyễn Nhật Ánh',
  'Nguyễn Nhật Ánh (sinh 1955) là nhà văn Việt Nam, tác giả “Cho tôi xin một vé đi tuổi thơ”, “Tôi thấy hoa vàng trên cỏ xanh”, “Mắt biếc”.');
SELECT pg_temp.sb_author(ARRAY['Haruki Murakami'], 'Haruki Murakami',
  'Haruki Murakami (sinh 1949) là nhà văn Nhật Bản, tác giả “Rừng Na Uy”, “Kafka bên bờ biển”, “1Q84”.');
SELECT pg_temp.sb_author(ARRAY['Gabriel Garcia Marquez'], 'Gabriel García Márquez',
  'Gabriel García Márquez (1927–2014) là nhà văn Colombia, giải Nobel Văn học 1982, tác giả “Trăm năm cô đơn”, “Tình yêu thời thổ tả”.');
SELECT pg_temp.sb_author(ARRAY[]::text[], 'Andy Weir', NULL);
SELECT pg_temp.sb_author(ARRAY['Joses Mauro De Vasconcelos'], 'José Mauro de Vasconcelos', NULL);
SELECT pg_temp.sb_author(ARRAY['Malcolm Gladwel'], 'Malcolm Gladwell', NULL);

-- ── books ──
UPDATE books b SET title = v.title, subtitle = v.subtitle, description = v.description, updated_at = now()
FROM (VALUES
  ('BK-006', 'Norwegian Wood', 'A Novel',
   'A coming-of-age novel by Haruki Murakami. Set in late 1960s Tokyo, it follows Toru Watanabe as he navigates love, loss, and the transition to adulthood.'),
  ('BK-007', 'One Hundred Years of Solitude', 'Cien años de soledad',
   'Gabriel García Márquez''s masterpiece about seven generations of the Buendía family in the mythical town of Macondo.'),
  ('BK-010', 'Kafka on the Shore', 'A Novel',
   'A Haruki Murakami novel told in two parallel stories: Kafka Tamura, a fifteen-year-old runaway, and Nakata, an elderly man who can talk with cats.')
) AS v(code, title, subtitle, description)
WHERE b.book_code = v.code
  AND (b.title, b.subtitle, b.description) IS DISTINCT FROM (v.title, v.subtitle, v.description);

SELECT pg_temp.sb_book_authors('BK-006', ARRAY['Haruki Murakami']);
SELECT pg_temp.sb_book_authors('BK-007', ARRAY['Gabriel García Márquez']);
SELECT pg_temp.sb_book_authors('BK-010', ARRAY['Haruki Murakami']);
SELECT pg_temp.sb_book_authors('BK-EXT-003', ARRAY['Andy Weir']);

SELECT pg_temp.sb_book_categories('BK-EXT-003', ARRAY['van-hoc-nuoc-ngoai']);

-- ── variants: real cover photos (Open Library) for the base titles whose ISBN
-- is real, so the books readers can borrow today are not all placeholders.
-- BK-006's seeded ISBN belonged to "The Wind-Up Bird Chronicle"; it now
-- carries Norwegian Wood's own (Vintage, 2000). Only set where still empty.
UPDATE book_variants SET isbn13 = '9780375704024', isbn10 = '0375704027', updated_at = now()
WHERE sku = 'SKU-BK006-PB-01' AND isbn13 = '9780679775430'
  AND NOT EXISTS (SELECT 1 FROM book_variants o WHERE o.isbn13 = '9780375704024');

UPDATE book_variants v SET cover_image_url = c.url, updated_at = now()
FROM (VALUES
  ('SKU-BK006-PB-01', 'https://covers.openlibrary.org/b/isbn/9780375704024-L.jpg'),
  ('SKU-BK007-PB-01', 'https://covers.openlibrary.org/b/isbn/9780060883287-L.jpg'),
  ('SKU-BK010-PB-01', 'https://covers.openlibrary.org/b/isbn/9780099458326-L.jpg'),
  ('SKU-EXT-003-PB', 'https://covers.openlibrary.org/b/isbn/9780593135204-L.jpg')
) AS c(sku, url)
WHERE v.sku = c.sku AND v.cover_image_url IS NULL;

-- ── remove the titles that have no real cover ──
-- Listed explicitly (never "every book without a cover"), so a book a librarian
-- imports later without a photo is never deleted by re-running this script.
CREATE TEMP TABLE sb_gone_books ON COMMIT DROP AS
  SELECT b.id FROM books b
  WHERE b.book_code IN ('BK-001', 'BK-002', 'BK-003', 'BK-004', 'BK-005', 'BK-008', 'BK-009', 'BK-EXT-001', 'BK-EXT-002')
     OR b.id IN (SELECT v.book_id FROM book_variants v WHERE v.sku = 'IMPORT-9786042125352');
CREATE TEMP TABLE sb_gone_variants ON COMMIT DROP AS
  SELECT v.id FROM book_variants v WHERE v.book_id IN (SELECT id FROM sb_gone_books);

-- Documents that hold a line for those variants: once the lines are gone, the
-- ones left with no line at all are removed too (an empty PO or receipt is
-- noise, not history). Documents that still list other books are kept.
CREATE TEMP TABLE sb_touched_docs (kind text, id uuid) ON COMMIT DROP;
INSERT INTO sb_touched_docs
  SELECT 'goods_receipt', goods_receipt_id FROM goods_receipt_items WHERE variant_id IN (SELECT id FROM sb_gone_variants)
  UNION SELECT 'purchase_order', purchase_order_id FROM purchase_order_items WHERE variant_id IN (SELECT id FROM sb_gone_variants)
  UNION SELECT 'stock_audit', stock_audit_id FROM stock_audit_lines WHERE variant_id IN (SELECT id FROM sb_gone_variants)
  UNION SELECT 'outbound_order', outbound_order_id FROM outbound_order_items WHERE variant_id IN (SELECT id FROM sb_gone_variants)
  UNION SELECT 'supplier_invoice', invoice_id FROM supplier_delivery_invoice_items WHERE variant_id IN (SELECT id FROM sb_gone_variants)
  UNION SELECT 'picking_task', picking_task_id FROM picking_task_items WHERE variant_id IN (SELECT id FROM sb_gone_variants)
  UNION SELECT 'packing_task', packing_task_id FROM packing_task_items WHERE variant_id IN (SELECT id FROM sb_gone_variants)
  UNION SELECT 'transfer_order', transfer_order_id FROM transfer_order_items WHERE variant_id IN (SELECT id FROM sb_gone_variants);

-- Line items that point at those variants.
DELETE FROM supplier_delivery_invoice_items WHERE variant_id IN (SELECT id FROM sb_gone_variants)
  OR purchase_order_item_id IN (SELECT id FROM purchase_order_items WHERE variant_id IN (SELECT id FROM sb_gone_variants));
DELETE FROM supplier_shortage_report_items WHERE variant_id IN (SELECT id FROM sb_gone_variants);
DELETE FROM picking_task_items WHERE variant_id IN (SELECT id FROM sb_gone_variants)
  OR outbound_order_item_id IN (SELECT id FROM outbound_order_items WHERE variant_id IN (SELECT id FROM sb_gone_variants));
DELETE FROM packing_task_items WHERE variant_id IN (SELECT id FROM sb_gone_variants)
  OR outbound_order_item_id IN (SELECT id FROM outbound_order_items WHERE variant_id IN (SELECT id FROM sb_gone_variants));
DELETE FROM outbound_order_items WHERE variant_id IN (SELECT id FROM sb_gone_variants);
DELETE FROM purchase_order_items WHERE variant_id IN (SELECT id FROM sb_gone_variants);
DELETE FROM goods_receipt_items WHERE variant_id IN (SELECT id FROM sb_gone_variants);
DELETE FROM stock_audit_lines WHERE variant_id IN (SELECT id FROM sb_gone_variants);
DELETE FROM transfer_order_items WHERE variant_id IN (SELECT id FROM sb_gone_variants);
DELETE FROM stock_movements WHERE variant_id IN (SELECT id FROM sb_gone_variants);
SELECT pg_temp.sb_drop_emptied_documents();
-- Variants (cascading to balances, reservations, units, images, supplier links),
-- then the books (cascading to author/category links).
DELETE FROM book_variants WHERE id IN (SELECT id FROM sb_gone_variants);
DELETE FROM books WHERE id IN (SELECT id FROM sb_gone_books);

-- ── branches: addresses with diacritics and demo opening hours, shown on the
-- public site. Branch *names* stay as seeded: the frozen AI Copilot evaluation
-- sets (services/ai-service/eval) and their tests refer to them verbatim.
UPDATE warehouses w SET address_line1 = v.line1, ward = v.ward, district = v.district, province = v.province,
  opening_hours = COALESCE(w.opening_hours, v.hours), updated_at = now()
FROM (VALUES
  ('BR-HCM-01', '78 Lê Duẩn', 'Bến Nghé', 'Quận 1', 'TP. Hồ Chí Minh', 'Thứ 2 – Thứ 7: 8:00 – 20:00 · Chủ nhật: 8:00 – 17:00'),
  ('BR-HCM-02', '156 Võ Văn Tần', 'Võ Thị Sáu', 'Quận 3', 'TP. Hồ Chí Minh', 'Thứ 2 – Thứ 7: 8:00 – 20:00 · Chủ nhật: 8:00 – 17:00')
) AS v(code, line1, ward, district, province, hours)
WHERE w.code = v.code
  AND (w.address_line1, w.ward, w.district, w.province, w.opening_hours)
      IS DISTINCT FROM (v.line1, v.ward, v.district, v.province, COALESCE(w.opening_hours, v.hours));

COMMIT;
