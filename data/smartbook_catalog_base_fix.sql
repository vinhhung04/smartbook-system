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
-- Where the real author of a demo title is unknown, the wrong link is removed
-- (the UI then shows "Chưa rõ tác giả") instead of inventing one.

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
SELECT pg_temp.sb_author(ARRAY[]::text[], 'Vũ Trọng Phụng',
  'Vũ Trọng Phụng (1912–1939) là nhà văn hiện thực trào phúng, tác giả “Số đỏ”, “Giông tố”.');
SELECT pg_temp.sb_author(ARRAY[]::text[], 'O. Henry',
  'O. Henry (1862–1910) là nhà văn Mỹ, bậc thầy truyện ngắn, tác giả “Chiếc lá cuối cùng”, “Món quà của các đạo sĩ”.');
SELECT pg_temp.sb_author(ARRAY[]::text[], 'Andy Weir', NULL);
SELECT pg_temp.sb_author(ARRAY['Joses Mauro De Vasconcelos'], 'José Mauro de Vasconcelos', NULL);
SELECT pg_temp.sb_author(ARRAY['Malcolm Gladwel'], 'Malcolm Gladwell', NULL);

-- ── books ──
UPDATE books b SET title = v.title, subtitle = v.subtitle, description = v.description, updated_at = now()
FROM (VALUES
  ('BK-001', 'Số đỏ', 'Tiểu thuyết',
   'Tiểu thuyết trào phúng của Vũ Trọng Phụng (1936) theo chân Xuân Tóc Đỏ, một kẻ lang thang leo lên giới thượng lưu nhờ thời cuộc, phơi bày lối sống “Âu hóa” lố lăng của xã hội thành thị thời Pháp thuộc.'),
  ('BK-002', 'Chiếc lá cuối cùng', 'Truyện ngắn',
   'Truyện ngắn nổi tiếng của O. Henry về cụ Bơ-men, người họa sĩ già vẽ chiếc lá thường xuân trong đêm mưa bão để giữ lại niềm tin sống cho Giôn-xi.'),
  ('BK-003', 'Thuyền bạc nhỏ', 'Tuyển tập thơ',
   'Tuyển tập thơ về tình yêu, tuổi trẻ, quê hương và con người.'),
  ('BK-004', 'Tấm Cám', 'Cổ tích Việt Nam',
   'Truyện cổ tích dân gian Việt Nam về cô Tấm hiền lành vượt qua sự hãm hại của mẹ con Cám, gửi gắm niềm tin “ở hiền gặp lành”.'),
  ('BK-005', 'Tôi thấy hoa vàng trên cỏ xanh', 'Tiểu thuyết',
   'Tiểu thuyết của Nguyễn Nhật Ánh về tuổi thơ của hai anh em Thiều và Tường ở một làng quê nghèo miền Trung: tình anh em, mối tình đầu và những bài học trưởng thành.'),
  ('BK-006', 'Norwegian Wood', 'A Novel',
   'A coming-of-age novel by Haruki Murakami. Set in late 1960s Tokyo, it follows Toru Watanabe as he navigates love, loss, and the transition to adulthood.'),
  ('BK-007', 'One Hundred Years of Solitude', 'Cien años de soledad',
   'Gabriel García Márquez''s masterpiece about seven generations of the Buendía family in the mythical town of Macondo.'),
  ('BK-008', 'Cho tôi xin một vé đi tuổi thơ', 'Truyện dài',
   'Truyện dài của Nguyễn Nhật Ánh nhìn thế giới qua đôi mắt cu Mùi và nhóm bạn, gợi lại những trò nghịch ngợm, mơ mộng và triết lý hồn nhiên của tuổi thơ.'),
  ('BK-009', 'Đặc trưng tâm lý học của người Việt', 'Tâm lý học ứng dụng',
   'Cuốn sách về tâm lý học người Việt, phân tích tâm lý, hành vi và tính cách của người Việt trong đời sống hiện đại.'),
  ('BK-010', 'Kafka on the Shore', 'A Novel',
   'A Haruki Murakami novel told in two parallel stories: Kafka Tamura, a fifteen-year-old runaway, and Nakata, an elderly man who can talk with cats.')
) AS v(code, title, subtitle, description)
WHERE b.book_code = v.code
  AND (b.title, b.subtitle, b.description) IS DISTINCT FROM (v.title, v.subtitle, v.description);

SELECT pg_temp.sb_book_authors('BK-001', ARRAY['Vũ Trọng Phụng']);
SELECT pg_temp.sb_book_authors('BK-002', ARRAY['O. Henry']);
SELECT pg_temp.sb_book_authors('BK-003', ARRAY['Xuân Diệu']);
SELECT pg_temp.sb_book_authors('BK-004', ARRAY[]::text[]);          -- folk tale
SELECT pg_temp.sb_book_authors('BK-005', ARRAY['Nguyễn Nhật Ánh']);
SELECT pg_temp.sb_book_authors('BK-006', ARRAY['Haruki Murakami']);
SELECT pg_temp.sb_book_authors('BK-007', ARRAY['Gabriel García Márquez']);
SELECT pg_temp.sb_book_authors('BK-008', ARRAY['Nguyễn Nhật Ánh']);
SELECT pg_temp.sb_book_authors('BK-009', ARRAY[]::text[]);          -- author unknown
SELECT pg_temp.sb_book_authors('BK-010', ARRAY['Haruki Murakami']);
SELECT pg_temp.sb_book_authors('BK-EXT-001', ARRAY['Tô Hoài']);
SELECT pg_temp.sb_book_authors('BK-EXT-002', ARRAY[]::text[]);      -- author unknown
SELECT pg_temp.sb_book_authors('BK-EXT-003', ARRAY['Andy Weir']);

SELECT pg_temp.sb_book_categories('BK-002', ARRAY['van-hoc-nuoc-ngoai', 'truyen-ngan']);
SELECT pg_temp.sb_book_categories('BK-008', ARRAY['van-hoc-viet-nam']);
SELECT pg_temp.sb_book_categories('BK-EXT-001', ARRAY['van-hoc-viet-nam', 'thieu-nhi']);
SELECT pg_temp.sb_book_categories('BK-EXT-002', ARRAY['ky-nang-song']);
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
