-- Create separate databases for each service
-- This runs in the postgres default database context

-- Note: CREATE DATABASE cannot be run inside a transaction block
-- so we use autocommit mode for these commands

-- Create auth_db if it doesn't exist
SELECT 'CREATE DATABASE auth_db'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'auth_db')\gexec

-- Create borrow_db if it doesn't exist
SELECT 'CREATE DATABASE borrow_db'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'borrow_db')\gexec

-- Create inventory_db if it doesn't exist
SELECT 'CREATE DATABASE inventory_db'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'inventory_db')\gexec
