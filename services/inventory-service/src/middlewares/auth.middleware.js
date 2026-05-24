const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: 'Authorization header is required' });
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Invalid authorization format. Use Bearer <token>' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      ...payload,
      id: payload.id || payload.sub,
    };
    req.auth = req.user;
    return next();
  } catch (error) {
    return res.status(401).json({ message: error.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token' });
  }
}

function authorizeAnyPermission(permissions = []) {
  return (req, res, next) => {
    const user = req.user || {};

    if (user.is_superuser) {
      return next();
    }

    const userPermissions = Array.isArray(user.permissions) ? user.permissions : [];
    const allowed = permissions.some((permission) => userPermissions.includes(permission));

    if (!allowed) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return next();
  };
}

function authorizeAllPermissions(permissions = []) {
  return (req, res, next) => {
    const user = req.user || req.auth || {};

    if (user.is_superuser) {
      return next();
    }

    const userPermissions = Array.isArray(user.permissions) ? user.permissions : [];
    const allowed = permissions.every((permission) => userPermissions.includes(permission));

    if (!allowed) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return next();
  };
}

function authorizeAnyRole(roles = []) {
  return (req, res, next) => {
    const user = req.user || req.auth || {};

    if (user.is_superuser) {
      return next();
    }

    const userRoles = Array.isArray(user.roles) ? user.roles : [];
    const allowed = roles.some((role) => userRoles.includes(role));

    if (!allowed) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return next();
  };
}

function requireInternalServiceKey(req, res, next) {
  const expected = String(process.env.INTERNAL_SERVICE_KEY || '').trim();
  const provided = String(req.headers['x-internal-service-key'] || '').trim();

  if (!expected || provided !== expected) {
    return res.status(401).json({ message: 'Unauthorized internal call' });
  }

  return next();
}

module.exports = {
  authenticateToken,
  authorizeAnyPermission,
  authorizeAllPermissions,
  authorizeAnyRole,
  requireInternalServiceKey,
};
