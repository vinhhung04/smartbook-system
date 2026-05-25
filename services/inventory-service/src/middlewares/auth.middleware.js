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
    return next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(403).json({ message: 'Token expired' });
    }

    return res.status(403).json({ message: 'Invalid token' });
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

function getUserRoles(user = {}) {
  return Array.isArray(user.roles) ? user.roles.map((role) => String(role).toUpperCase()) : [];
}

function authorizeAnyRole(roles = []) {
  const allowedRoles = roles.map((role) => String(role).toUpperCase());
  return (req, res, next) => {
    const user = req.user || {};

    if (user.is_superuser) {
      return next();
    }

    const userRoles = getUserRoles(user);
    const allowed = allowedRoles.some((role) => userRoles.includes(role));

    if (!allowed) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return next();
  };
}

function authorizePurchaseManager(permissions = ['inventory.purchase.write']) {
  return authorizeManagerDecision(permissions);
}

function authorizeManagerDecision(permissions = ['inventory.operation.decide']) {
  const requirePermission = authorizeAnyPermission(permissions);
  const requireRole = authorizeAnyRole(['MANAGER', 'ADMIN']);

  return (req, res, next) => {
    if (req.user?.is_superuser) {
      return next();
    }

    return requireRole(req, res, (roleError) => {
      if (roleError) return next(roleError);
      return requirePermission(req, res, next);
    });
  };
}

function authorizeStaffTaskUpdate(permissions = ['inventory.task.update']) {
  const requirePermission = authorizeAnyPermission(permissions);
  const requireRole = authorizeAnyRole([
    'STAFF',
    'WAREHOUSE_STAFF',
    'WAREHOUSE_OPERATOR',
    'MANAGER',
    'ADMIN',
  ]);

  return (req, res, next) => {
    if (req.user?.is_superuser) {
      return next();
    }

    return requireRole(req, res, (roleError) => {
      if (roleError) return next(roleError);
      return requirePermission(req, res, next);
    });
  };
}

module.exports = {
  authenticateToken,
  authorizeAnyPermission,
  authorizeAnyRole,
  authorizeManagerDecision,
  authorizePurchaseManager,
  authorizeStaffTaskUpdate,
};
