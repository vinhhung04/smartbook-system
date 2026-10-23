const jwt = require('jsonwebtoken');
const { revocationGuard } = require('@smartbook/shared/token-revocation');
// Redis unreachable = revocation UNKNOWN, not "not revoked": reads continue,
// writes get 503 (packages/shared/runtime/token-revocation.cjs). Shared with
// lib/token-revocation.js so this service's own logouts are known first-hand.
const { revocationChecker: revocation } = require('../lib/token-revocation');

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

async function authenticateToken(req, res, next) {
  try {
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: 'JWT_SECRET is not configured' });
    }

    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ message: 'Missing bearer token' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Logout blacklists the jti; password change / admin status change writes a
    // per-user cutoff (auth.controller.js changePassword, iam.controller.js
    // updateUser) that invalidates every token issued before it.
    const revocationResult = await revocation.check(payload);
    // logout is allowed while revocation cannot be checked: it only gives access up
    const isLogout = /\/logout\/?(\?|$)/.test(req.originalUrl || req.url || '');
    if (revocationGuard(req, res, revocationResult, { allowWhenUnknown: isLogout })) return undefined;
    req.revocationState = revocationResult.state;

    req.auth = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

function authorizeAnyPermission(permissions = []) {
  return (req, res, next) => {
    const auth = req.auth || {};

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

module.exports = {
  authenticateToken,
  authorizeAnyPermission,
};
