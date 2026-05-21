const jwt = require('jsonwebtoken');
const redis = require('../../lib/redis');

const JWT_SECRET = process.env.JWT_SECRET || 'smartbook_shared_jwt_secret';

// Check if token is blacklisted
async function isTokenBlacklisted(tokenId) {
  const key = `blacklist:token:${tokenId}`;
  const result = await redis.get(key);
  return result !== null;
}

// Blacklist a token
async function blacklistToken(tokenId, expiresInSeconds) {
  const key = `blacklist:token:${tokenId}`;
  await redis.set(key, '1', expiresInSeconds);
}

// Auth middleware
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if token is blacklisted
    if (decoded.jti) {
      const isBlacklisted = await isTokenBlacklisted(decoded.jti);
      if (isBlacklisted) {
        return res.status(401).json({ error: 'Token has been revoked' });
      }
    }

    req.user = decoded;
    req.token = token;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Generate token with unique ID
function generateToken(user, expiresIn = '24h') {
  const jti = `${user.id}-${Date.now()}`;
  return {
    token: jwt.sign(
      {
        sub: user.id,
        username: user.username,
        email: user.email,
        roles: user.roles,
        is_superuser: user.is_superuser,
        jti: jti
      },
      JWT_SECRET,
      { expiresIn }
    ),
    jti: jti
  };
}

// Revoke current token (logout)
async function revokeToken(req, res) {
  try {
    const decoded = req.user;
    if (decoded && decoded.jti) {
      // Get token expiry to set correct TTL in Redis
      const decoded2 = jwt.decode(req.token);
      const expiresIn = decoded2.exp - Math.floor(Date.now() / 1000);

      if (expiresIn > 0) {
        await blacklistToken(decoded.jti, expiresIn);
        return res.json({ message: 'Token revoked successfully' });
      }
    }
    res.json({ message: 'Token already expired' });
  } catch (err) {
    console.error('[Auth] Revoke token error:', err);
    res.status(500).json({ error: 'Failed to revoke token' });
  }
}

module.exports = {
  authMiddleware,
  generateToken,
  revokeToken,
  blacklistToken,
  isTokenBlacklisted
};
