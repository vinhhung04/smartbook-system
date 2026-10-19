-- Closes the loans of titles that were removed from the catalog
-- (data/smartbook_catalog_base_fix.sql deletes the base titles that have no
-- real cover). Run by scripts/close-removed-title-loans.mjs, which first loads
-- every variant id that still exists in inventory_db into the temp table
-- sb_live_variants inside the same transaction; a loan line whose variant is
-- not there belongs to a removed title.
--
-- For each such line still out (BORROWED / OVERDUE, not returned):
--   - the line is closed the way a return closes it (status RETURNED,
--     return_date now) with the note "Sách đã gỡ khỏi danh mục";
--   - its loan is closed (RETURNED, closed_at) once no line of it is still out,
--     exactly as POST /loans/:id/return does; loans that still hold a book of
--     the catalog keep their status;
--   - the unpaid / partly paid fines of that line are waived for what is left
--     (as POST /fines/:id/waive does: waived_amount += remaining, WAIVED), and
--     every touched customer's total_fine_balance is recomputed.
-- Lines already returned, LOST lines and their fines are history and are left
-- as they are. Every change is written to borrow_audit_logs (actor = system).
-- Then: wishlists / availability alerts / reviews of removed books are dropped,
-- fully covered fines are marked PAID and every total_fine_balance recomputed.
-- Idempotent: a second run finds nothing left to change.
-- (Also loads sb_live_books: the book ids still in the catalog.)

CREATE TEMP TABLE sb_closing ON COMMIT DROP AS
  SELECT li.id, li.loan_id, li.status AS old_status
  FROM loan_items li
  WHERE li.status IN ('BORROWED', 'OVERDUE')
    AND li.return_date IS NULL
    AND NOT EXISTS (SELECT 1 FROM sb_live_variants v WHERE v.id = li.variant_id);

UPDATE loan_items li
SET status = 'RETURNED',
    return_date = now(),
    notes = concat_ws(' · ', NULLIF(li.notes, ''), 'Sách đã gỡ khỏi danh mục')
FROM sb_closing c
WHERE li.id = c.id;

CREATE TEMP TABLE sb_closed_loans ON COMMIT DROP AS
  SELECT lt.id, lt.status AS old_status
  FROM loan_transactions lt
  WHERE lt.id IN (SELECT loan_id FROM sb_closing)
    AND NOT EXISTS (
      SELECT 1 FROM loan_items li
      WHERE li.loan_id = lt.id AND li.status IN ('BORROWED', 'OVERDUE', 'RESERVED')
    );

UPDATE loan_transactions lt
SET status = 'RETURNED', closed_at = now(), updated_at = now()
FROM sb_closed_loans c
WHERE lt.id = c.id;

INSERT INTO borrow_audit_logs (action_name, entity_type, entity_id, before_data, after_data)
SELECT 'CLOSE_REMOVED_TITLE_LINES', 'LOAN_TRANSACTION', c.loan_id,
       jsonb_build_object('item_statuses', jsonb_agg(c.old_status), 'loan_status', max(lc.old_status)),
       jsonb_build_object('closed_item_ids', jsonb_agg(c.id), 'loan_closed', bool_or(lc.id IS NOT NULL),
                          'reason', 'Sách đã gỡ khỏi danh mục')
FROM sb_closing c
LEFT JOIN sb_closed_loans lc ON lc.id = c.loan_id
GROUP BY c.loan_id;

-- Fines still owed on the lines closed above (the note marks them, so a later
-- run still finds lines it closed before but waives nothing twice).
CREATE TEMP TABLE sb_waive ON COMMIT DROP AS
  SELECT f.id, f.customer_id, f.status AS old_status, f.waived_amount AS old_waived,
         GREATEST(f.amount - f.waived_amount - COALESCE(p.paid, 0), 0) AS remaining
  FROM fines f
  JOIN loan_items li ON li.id = f.loan_item_id
  LEFT JOIN (SELECT fine_id, SUM(amount) AS paid FROM fine_payments GROUP BY fine_id) p ON p.fine_id = f.id
  WHERE li.notes LIKE '%Sách đã gỡ khỏi danh mục%'
    AND NOT EXISTS (SELECT 1 FROM sb_live_variants v WHERE v.id = li.variant_id)
    AND f.status IN ('UNPAID', 'PARTIALLY_PAID')
    AND f.amount - f.waived_amount - COALESCE(p.paid, 0) > 0;

UPDATE fines f
SET waived_amount = f.waived_amount + w.remaining,
    status = 'WAIVED',
    note = concat_ws(' · ', NULLIF(f.note, ''), 'Miễn phạt: sách đã gỡ khỏi danh mục')
FROM sb_waive w
WHERE f.id = w.id;

INSERT INTO borrow_audit_logs (action_name, entity_type, entity_id, before_data, after_data)
SELECT 'WAIVE_FINE', 'FINE', w.id,
       jsonb_build_object('status', w.old_status, 'waived_amount', w.old_waived, 'remaining_balance', w.remaining),
       jsonb_build_object('status', 'WAIVED', 'waived_amount', w.old_waived + w.remaining, 'remaining_balance', 0,
                          'reason', 'Sách đã gỡ khỏi danh mục')
FROM sb_waive w;

-- Wishlists, availability alerts ("Báo khi có sách") and reviews of a book
-- that is no longer in the catalog: nothing can be borrowed, notified or shown
-- for them any more. Nothing references these rows.
CREATE TEMP TABLE sb_dropped ON COMMIT DROP AS SELECT 0 AS wishlists, 0 AS alerts, 0 AS reviews;
WITH gone AS (DELETE FROM book_wishlists w WHERE NOT EXISTS (SELECT 1 FROM sb_live_books b WHERE b.id = w.book_id) RETURNING 1)
UPDATE sb_dropped SET wishlists = (SELECT count(*) FROM gone);
WITH gone AS (DELETE FROM availability_alerts a WHERE NOT EXISTS (SELECT 1 FROM sb_live_books b WHERE b.id = a.book_id) RETURNING 1)
UPDATE sb_dropped SET alerts = (SELECT count(*) FROM gone);
WITH gone AS (DELETE FROM book_reviews r WHERE NOT EXISTS (SELECT 1 FROM sb_live_books b WHERE b.id = r.book_id) RETURNING 1)
UPDATE sb_dropped SET reviews = (SELECT count(*) FROM gone);

-- A fine whose payments already cover it is PAID (as recordFinePayment sets it).
CREATE TEMP TABLE sb_settled ON COMMIT DROP AS
  SELECT f.id, f.status AS old_status
  FROM fines f
  JOIN (SELECT fine_id, SUM(amount) AS paid, MAX(paid_at) AS last_paid_at FROM fine_payments GROUP BY fine_id) p ON p.fine_id = f.id
  WHERE f.status IN ('UNPAID', 'PARTIALLY_PAID') AND f.amount - f.waived_amount - p.paid <= 0;
UPDATE fines f SET status = 'PAID',
       paid_at = COALESCE(f.paid_at, (SELECT MAX(paid_at) FROM fine_payments fp WHERE fp.fine_id = f.id))
FROM sb_settled s WHERE f.id = s.id;

-- Every reader's balance by the rule of recomputeCustomerFineBalance
-- (services/borrow-service/src/services/fine.service.js). Seeded history writes
-- fines without it, so balances drift unless they are recomputed here.
CREATE TEMP TABLE sb_balance ON COMMIT DROP AS
  SELECT c.id, c.total_fine_balance AS old_balance,
         ROUND(COALESCE((
           SELECT SUM(GREATEST(f.amount - f.waived_amount - COALESCE((SELECT SUM(fp.amount) FROM fine_payments fp WHERE fp.fine_id = f.id), 0), 0))
           FROM fines f
           WHERE f.customer_id = c.id AND f.status NOT IN ('PAID', 'WAIVED')
         ), 0), 2) AS new_balance
  FROM customers c;
UPDATE customers c SET total_fine_balance = b.new_balance, updated_at = now()
FROM sb_balance b WHERE c.id = b.id AND c.total_fine_balance IS DISTINCT FROM b.new_balance;

SELECT (SELECT count(*) FROM sb_closing) AS lines_closed,
       (SELECT count(*) FROM sb_closed_loans) AS loans_closed,
       (SELECT count(*) FROM sb_waive) AS fines_waived,
       (SELECT COALESCE(SUM(remaining), 0) FROM sb_waive) AS amount_waived,
       (SELECT wishlists FROM sb_dropped) AS wishlists_dropped,
       (SELECT alerts FROM sb_dropped) AS alerts_dropped,
       (SELECT reviews FROM sb_dropped) AS reviews_dropped,
       (SELECT count(*) FROM sb_settled) AS fines_marked_paid,
       (SELECT count(*) FROM sb_balance WHERE old_balance IS DISTINCT FROM new_balance) AS balances_fixed;
