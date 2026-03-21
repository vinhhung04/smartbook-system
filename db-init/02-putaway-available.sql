-- Add available counter on locations for putaway flow.
-- Safe to run multiple times.
\connect inventory_db;

ALTER TABLE public.locations
ADD COLUMN IF NOT EXISTS available INTEGER NOT NULL DEFAULT 0;

-- Normalize any existing NULLs just in case.
UPDATE public.locations
SET available = 0
WHERE available IS NULL;
