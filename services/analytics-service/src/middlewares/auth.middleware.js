const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = {
      ...payload,
      id: payload.id || payload.sub,
      permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
      roles: Array.isArray(payload.roles) ? payload.roles : [],
    };
    req.auth = req.user;
    return next();
  } catch (_error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
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

function authorizeAllPermissions(permissions = []) {
  return (req, res, next) => {
    const user = req.user || req.auth || {};

    if (user.is_superuser === true || user.is_superuser === 'true') {
      return next();
    }

    const userPermissions = new Set(Array.isArray(user.permissions) ? user.permissions : []);
    const allowed = permissions.every((permission) => userPermissions.has(permission));

    if (!allowed) {
      return res.status(403).json({ message: 'Insufficient permission' });
    }

    return next();
  };
}

module.exports = {
  authenticateToken,
  authorizeAnyPermission,
  authorizeAllPermissions,
};
