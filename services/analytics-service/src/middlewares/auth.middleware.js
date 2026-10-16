const jwt = require('jsonwebtoken');
const { isTokenRevoked } = require('../lib/token-revocation');

async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (_error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
  // A logged-out / locked / re-roled account is refused here too, not only at
  // auth-service and inventory (Copilot 3.2 audit: revoked tokens still read
  // /analytics/* through the gateway).
  if (await isTokenRevoked(payload)) {
    return res.status(401).json({ message: 'Token has been revoked' });
  }
  req.user = {
    ...payload,
    id: payload.id || payload.sub,
    permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
    roles: Array.isArray(payload.roles) ? payload.roles : [],
  };
  return next();
}

function authorizeAnyPermission(permissions = []) {
  return (req, res, next) => {
    const user = req.user || {};

    if (user.is_superuser === true || user.is_superuser === 'true') {
      return next();
    }

    const userPermissions = new Set(Array.isArray(user.permissions) ? user.permissions : []);
    const allowed = permissions.some((permission) => userPermissions.has(permission));

    if (!allowed) {
      return res.status(403).json({ message: 'Insufficient permission' });
    }

    return next();
  };
}

module.exports = {
  authenticateToken,
  authorizeAnyPermission,
};
