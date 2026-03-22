-- Load merged seed data (sample + extended) for all databases.
-- Kept at step 03 so older scripts that run 00->03 still get full seed data.
\i /seed-data/smartbook_merged_seed.sql
