const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { revocationGuard } = require('@smartbook/shared/token-revocation');
const { canonicalRoles } = require('@smartbook/shared/roles');
const { checkTokenRevocation } = require('../lib/token-revocation');

// Monitoring is an administrator capability. ADMIN keeps access even on a
// database whose permission rows predate monitoring (no production seed needed);
// the dedicated permissions let other roles be granted read or manage rights.
const PERMISSIONS = {
  read: ['monitoring.incidents.read', 'monitoring.incidents.manage', 'monitoring.settings.manage'],
  manage: ['monitoring.incidents.manage'],
  settings: ['monitoring.settings.manage'],
};

async function authenticateToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Access token required', code: 'UNAUTHORIZED' });
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (_error) {
    return res.status(401).json({ message: 'Invalid or expired token', code: 'UNAUTHORIZED' });
  }
  if (revocationGuard(req, res, await checkTokenRevocation(payload))) return undefined;
  req.user = {
    id: String(payload.sub || payload.id || ''),
    name: payload.username || payload.email || null,
    roles: Array.isArray(payload.roles) ? canonicalRoles(payload.roles.map(role => String(role).toUpperCase())) : [],
    permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
    isSuperuser: payload.is_superuser === true || payload.is_superuser === 'true',
  };
  return next();
}

function can(user, level) {
  if (!user) return false;
  if (user.isSuperuser || user.roles.includes('ADMIN')) return true;
  return PERMISSIONS[level].some(permission => user.permissions.includes(permission));
}

function authorize(level) {
  return (req, res, next) => (can(req.user, level)
    ? next()
    : res.status(403).json({ message: 'Bạn không có quyền thực hiện thao tác này', code: 'FORBIDDEN' }));
}

/** Alert sources (Grafana, healthcheck.sh) authenticate with MONITORING_INGEST_TOKEN. */
function requireIngestToken(req, res, next) {
  const expected = String(process.env.MONITORING_INGEST_TOKEN || '');
  const header = String(req.headers.authorization || '');
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = crypto.createHash('sha256').update(presented).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  if (expected.length < 24 || !presented || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ message: 'invalid ingest credentials', code: 'UNAUTHORIZED' });
  }
  return next();
}

module.exports = { authenticateToken, authorize, can, requireIngestToken, PERMISSIONS };
