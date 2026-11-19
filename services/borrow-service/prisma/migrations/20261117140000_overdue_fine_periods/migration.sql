ALTER TABLE fines ADD COLUMN accrual_from_days integer,
  ADD COLUMN accrual_through_days integer,
  ADD COLUMN accrual_daily_rate numeric(10,2);

CREATE TABLE overdue_fine_episodes (
  loan_item_id uuid PRIMARY KEY REFERENCES loan_items(id) ON DELETE CASCADE,
  baseline_days integer NOT NULL DEFAULT 0 CHECK (baseline_days >= 0),
  policy_started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  waived_future boolean NOT NULL DEFAULT false,
  waived_at timestamptz,
  waived_by_user_id uuid,
  waiver_reason text,
  CHECK (NOT waived_future OR (waived_at IS NOT NULL AND waived_by_user_id IS NOT NULL AND length(trim(waiver_reason)) > 0))
);

-- Prospective rollout: existing financial amounts/status/payments remain intact.
-- Old records have no trustworthy day/rate snapshot. Establish today's cutoff;
-- future days receive new periods instead of silently backbilling old episodes.
INSERT INTO overdue_fine_episodes (loan_item_id, baseline_days)
SELECT DISTINCT li.id, GREATEST(0, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - (li.due_date AT TIME ZONE 'UTC')::date)
FROM loan_items li JOIN fines f ON f.loan_item_id=li.id AND f.fine_type='OVERDUE';
UPDATE fines f SET accrual_through_days = ep.baseline_days
FROM overdue_fine_episodes ep WHERE ep.loan_item_id=f.loan_item_id AND f.fine_type='OVERDUE';

ALTER TABLE fines ADD CONSTRAINT fines_accrual_days_order CHECK (
  (accrual_from_days IS NULL OR accrual_from_days >= 0)
  AND (accrual_through_days IS NULL OR accrual_through_days >= COALESCE(accrual_from_days, 0))
  AND (accrual_daily_rate IS NULL OR accrual_daily_rate >= 0)
);
