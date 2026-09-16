const { randomUUID } = require('node:crypto');

const UNSAFE_PLACEHOLDERS = new Set([
  'change-me',
  'password',
  'admin',
  'your-secret-key',
  'smartbook_shared_jwt_secret',
  'smartbook_internal_key',
  'generate_jwt_secret',
  'generate_internal_key',
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

function createRequestLogger(serviceName, { log = console.log, now = Date.now } = {}) {
  return (req, res, next) => {
    const startedAt = now();
    res.once('finish', () => {
      log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: serviceName,
        request_id: req.requestId || null,
        method: req.method,
        path: req.originalUrl || req.url,
        status: res.statusCode,
        latency_ms: Math.max(0, now() - startedAt),
        user_id: req.user?.id || req.user?.sub || null,
      }));
    });
    next();
  };
}

// X-Forwarded-For is appended-to by each hop it passes through, so the entries closest to
// the right end are the ones OUR reverse proxies added (trustworthy); anything further left
// (including the leftmost entry) is client-supplied and trivially spoofable. `trustedProxyHops`
// is the number of reverse proxies sitting in front of this service (e.g. 1 for api-gateway
// behind a single nginx edge, 2 for a service sitting behind nginx + api-gateway) — we skip
// that many entries from the right and trust the one after that as the real client IP.
function resolveClientIp(req, trustedProxyHops = 0) {
  const remoteAddress = req.socket?.remoteAddress || req.ip || 'unknown';
  if (!trustedProxyHops || trustedProxyHops < 1) return remoteAddress;

  const forwardedFor = String(req.headers?.['x-forwarded-for'] || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (forwardedFor.length === 0) return remoteAddress;

  const index = forwardedFor.length - trustedProxyHops;
  return index >= 0 ? forwardedFor[index] : forwardedFor[0];
}

function createRateLimiter({ max = 100, windowMs = 60_000, key, trustedProxyHops = 0, now = Date.now } = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const currentTime = now();
    const clientKey = key ? key(req) : resolveClientIp(req, trustedProxyHops);
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
  createRequestLogger,
  requireEnv,
  resolveClientIp,
  securityHeaders,
};
