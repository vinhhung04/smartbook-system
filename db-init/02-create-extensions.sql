-- Create extensions needed for each database
-- Run this after databases are created but before Prisma schema push

-- For inventory_db
\c inventory_db
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- For borrow_db
\c borrow_db
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- For auth_db
\c auth_db
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Back to inventory (default)
\c inventory
