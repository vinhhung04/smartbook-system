const jwt = require('jsonwebtoken');

const LEGACY_ROLE_MAP = {
  MANAGER: 'WAREHOUSE_MANAGER',
  STAFF: 'WAREHOUSE_STAFF',
  WAREHOUSE_OPERATOR: 'WAREHOUSE_STAFF',
  CUSTOMER_SERVICE: 'LIBRARIAN',
};

function normalizeRoles(roles = []) {
  return roles.map((r) => LEGACY_ROLE_MAP[r] || r);
}

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
  const raw = Array.isArray(user.roles) ? user.roles.map((role) => String(role).toUpperCase()) : [];
  return normalizeRoles(raw);
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

function authorizeManagerRead(permissions = []) {
  return authorizeManagerDecision(permissions);
}

function authorizeManagerDecision(permissions = ['inventory.operation.decide']) {
  const requirePermission = authorizeAnyPermission(permissions);
  const requireRole = authorizeAnyRole(['WAREHOUSE_MANAGER', 'ADMIN']);

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

function authorizeTaskRead(permissions = ['inventory.task.read']) {
  const requirePermission = authorizeAnyPermission(permissions);
  const requireRole = authorizeAnyRole([
    'WAREHOUSE_STAFF',
    'WAREHOUSE_MANAGER',
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

function authorizeTaskProgress(permissions = ['inventory.task.progress']) {
  return authorizeTaskRead(permissions);
}

module.exports = {
  authenticateToken,
  authorizeAnyPermission,
  authorizeAnyRole,
  authorizeManagerDecision,
  authorizeManagerRead,
  authorizePurchaseManager,
  authorizeTaskRead,
  authorizeTaskProgress,
};
