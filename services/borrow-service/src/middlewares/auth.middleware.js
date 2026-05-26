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

function authorizeBorrowAdminRead(req, res, next) {
  if (req.user?.is_superuser) return next();

  const roles = getUserRoles(req.user);
  const permissions = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
  const roleAllowed = roles.some((role) => ['LIBRARIAN', 'MANAGER', 'ADMIN', 'CUSTOMER_SERVICE'].includes(role));
  const permissionAllowed = permissions.some((permission) => [
    'borrow.read',
    'borrow.customers.read',
    'borrow.loans.read',
  ].includes(permission));

  if (!roleAllowed || !permissionAllowed) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  return next();
}

function authorizeBorrowAdminWrite(req, res, next) {
  if (req.user?.is_superuser) return next();

  const roles = getUserRoles(req.user);
  const permissions = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
  const roleAllowed = roles.some((role) => ['LIBRARIAN', 'ADMIN', 'CUSTOMER_SERVICE'].includes(role));
  const permissionAllowed = permissions.some((permission) => [
    'borrow.write',
    'borrow.customers.write',
    'borrow.loans.write',
    'borrow.fines.manage',
    'borrow.fine.write',
    'borrow.membership.write',
  ].includes(permission));

  if (!roleAllowed || !permissionAllowed) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  return next();
}

function authorizeCustomerSelf(req, res, next) {
  if (req.user?.is_superuser) return next();

  const roles = getUserRoles(req.user);
  const permissions = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
  const isCustomer = roles.includes('CUSTOMER');
  const hasSelfPermission = permissions.some((permission) => [
    'customer.self.read',
    'customer.self.write',
  ].includes(permission));

  if (!isCustomer || !hasSelfPermission) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  return next();
}

module.exports = {
  authenticateToken,
  authorizeAnyPermission,
  authorizeAnyRole,
  authorizeBorrowAdminRead,
  authorizeBorrowAdminWrite,
  authorizeCustomerSelf,
};
