'use strict';

// Role codes renamed after tokens were issued. A JWT carries the roles it was
// signed with (2 h, refresh tokens longer), so every service maps the old code
// when it reads a token; the database only holds the current codes.
const RENAMED_ROLE_CODES = Object.freeze({
  WAREHOUSE_MANAGER: 'MANAGER', // 2026-11-25: one manager role for warehouse work and library analytics
});

/** The roles of a verified token payload under their current codes (order kept, no duplicates). */
function canonicalRoles(roles) {
  if (!Array.isArray(roles)) return roles;
  return [...new Set(roles.map((role) => RENAMED_ROLE_CODES[String(role).toUpperCase()] || role))];
}

module.exports = { RENAMED_ROLE_CODES, canonicalRoles };
