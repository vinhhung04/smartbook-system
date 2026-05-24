const jwt = require('jsonwebtoken');

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

function authenticateToken(req, res, next) {
  try {
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: 'JWT_SECRET is not configured' });
    }

    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ message: 'Missing bearer token' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = payload;
    req.user = {
      ...payload,
      id: payload.id || payload.sub,
    };
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

function getAuth(req) {
  return req.auth || req.user || {};
}

function authorizeAnyPermission(permissions = []) {
  return (req, res, next) => {
    const auth = getAuth(req);

    if (auth.is_superuser) {
      return next();
    }

    const userPermissions = Array.isArray(auth.permissions) ? auth.permissions : [];
    const allowed = permissions.some((permission) => userPermissions.includes(permission));

    if (!allowed) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return next();
  };
}

function authorizeAllPermissions(permissions = []) {
  return (req, res, next) => {
    const auth = getAuth(req);

    if (auth.is_superuser) {
      return next();
    }

    const userPermissions = Array.isArray(auth.permissions) ? auth.permissions : [];
    const allowed = permissions.every((permission) => userPermissions.includes(permission));

    if (!allowed) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return next();
  };
}

function authorizeAnyRole(roles = []) {
  return (req, res, next) => {
    const auth = getAuth(req);

    if (auth.is_superuser) {
      return next();
    }

    const userRoles = Array.isArray(auth.roles) ? auth.roles : [];
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
