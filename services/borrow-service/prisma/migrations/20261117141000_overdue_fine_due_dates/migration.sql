-- Renewal changes the due-date basis. Preserve old financial periods rather
-- than suppressing the new overdue days with the previous deadline's counter.
ALTER TABLE fines ADD COLUMN accrual_due_date timestamptz;
ALTER TABLE overdue_fine_episodes ADD COLUMN due_date timestamptz;
UPDATE overdue_fine_episodes ep SET due_date=li.due_date FROM loan_items li WHERE li.id=ep.loan_item_id;
UPDATE fines f SET accrual_due_date=li.due_date FROM loan_items li WHERE li.id=f.loan_item_id AND f.fine_type='OVERDUE';
