const { randomUUID } = require('node:crypto');

const UNSAFE_PLACEHOLDERS = new Set([
  'change-me',
  'password',
  'admin',
  'your-secret-key',
  'smartbook_shared_jwt_secret',
  'smartbook_internal_key',
]);

function requireEnv(environment, names) {
  const values = {};
  for (const name of names) {
    const value = String(environment[name] || '').trim();
    if (!value) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    if (UNSAFE_PLACEHOLDERS.has(value.toLowerCase())) {
      throw new Error(`Environment variable ${name} uses an unsafe placeholder`);
    }
    values[name] = value;
  }
  return values;
}

function createCorsOptions(rawOrigins) {
  const allowedOrigins = new Set(
    String(rawOrigins || 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  return {
    credentials: false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
  };
}

function createRequestContext(serviceName) {
  return (req, res, next) => {
    const incoming = String(req.headers?.['x-request-id'] || '').trim();
    const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(incoming)
      ? incoming
      : randomUUID();
    req.requestId = requestId;
    req.serviceName = serviceName;
    req.headers['x-request-id'] = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  };
}

function createRateLimiter({ max = 100, windowMs = 60_000, key, now = Date.now } = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const currentTime = now();
    const clientKey = key
      ? key(req)
      : String(req.headers?.['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
    let bucket = buckets.get(clientKey);
    if (!bucket || bucket.resetAt <= currentTime) {
      bucket = { count: 0, resetAt: currentTime + windowMs };
      buckets.set(clientKey, bucket);
    }
    bucket.count += 1;
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      return res.status(429).json({
        message: 'Too many requests',
        code: 'RATE_LIMITED',
        request_id: req.requestId || null,
      });
    }
    if (buckets.size > 10_000) {
      for (const [storedKey, stored] of buckets) {
        if (stored.resetAt <= currentTime) buckets.delete(storedKey);
      }
    }
    return next();
  };
}

function securityHeaders(_req, res, next) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

module.exports = {
  createCorsOptions,
  createRateLimiter,
  createRequestContext,
  requireEnv,
  securityHeaders,
};
