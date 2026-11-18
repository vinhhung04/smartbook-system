SET lock_timeout = '5s';
SET statement_timeout = '30s';
CREATE INDEX author_aliases_normalized_alias_status_idx ON author_aliases(normalized_alias, status);
CREATE INDEX publisher_aliases_normalized_alias_status_idx ON publisher_aliases(normalized_alias, status);
RESET lock_timeout;
RESET statement_timeout;
