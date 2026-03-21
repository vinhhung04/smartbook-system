-- Load sample seed data for all databases
-- This runs after the main schema and extensions are applied
\i /docker-entrypoint-initdb.d/data/smartbook_sample_seed.sql
