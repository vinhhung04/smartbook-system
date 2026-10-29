const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { sendEmail, deliverEmail, isEmailConfigured } = require('../lib/email-sender');
const { revokeUserTokensIssuedBefore, blacklistToken } = require('../lib/token-revocation');
const redis = require('../lib/redis');
const { createRefreshTokenService, RefreshTokenError } = require('../lib/refresh-tokens');
const { createEmailOtpService, OtpError, PURPOSES, resolveOtpSecret } = require('../lib/email-otp');
const { createPrismaOtpStore } = require('../lib/email-otp-store');

const refreshTokens = createRefreshTokenService({
  get: (key) => redis.getStrict(key),
  set: (key, value, ttl) => redis.setStrict(key, value, ttl),
  getDel: (key) => redis.getDelStrict(key),
  del: (key) => redis.delStrict(key),
});

const emailOtp = createEmailOtpService({
  store: createPrismaOtpStore(prisma),
  deliver: (to, data) => deliverEmail(to, 'EMAIL_OTP', data),
  secret: resolveOtpSecret(),
  lookupUser: (id) => prisma.user.findUnique({ where: { id }, select: { full_name: true, deleted_at: true } }),
});

// Accounts created by /auth/register before their email is confirmed. They can
// never receive a JWT or a refresh token (login answers with a verification challenge).
const PENDING_VERIFICATION = 'PENDING_VERIFICATION';

// REGISTRATION_EMAIL_VERIFICATION=off is an emergency switch back to the old
// behaviour (accounts active at once), e.g. while the SMTP provider is down.
function registrationVerificationRequired() {
  return String(process.env.REGISTRATION_EMAIL_VERIFICATION || 'required').trim().toLowerCase() !== 'off';
}

// STAFF_EMAIL_OTP_MODE:
//   off      (default) no second factor for anyone — the behaviour before this feature
//   optional accounts with email_otp_2fa_enabled must enter an emailed code
//   required every internal (non-customer, non-supplier) account must, plus the flagged ones
function staffOtpMode() {
  const mode = String(process.env.STAFF_EMAIL_OTP_MODE || 'off').trim().toLowerCase();
  return mode === 'optional' || mode === 'required' ? mode : 'off';
}

function isInternalStaff(user, roles) {
  return Boolean(user.is_superuser) || roles.some((role) => role !== 'CUSTOMER' && role !== 'SUPPLIER');
}

function requiresEmailOtp(user, roles) {
  const mode = staffOtpMode();
  if (mode === 'off') return false;
  if (user.email_otp_2fa_enabled) return true;
  return mode === 'required' && isInternalStaff(user, roles);
}

function sendOtpError(res, error, context) {
  if (error instanceof OtpError) {
    if (error.extra?.retry_after_seconds) res.setHeader?.('Retry-After', String(error.extra.retry_after_seconds));
    return res.status(error.status).json({ message: error.message, code: error.code, ...error.extra });
  }
  console.error(`${context} error:`, error);
  return res.status(500).json({ message: 'Internal server error' });
}

// Confirms the address the code was sent to. Runs in the transaction that consumes
// the challenge; if the account's email changed since, nothing is confirmed.
async function markEmailVerified(tx, challenge) {
  const rows = await tx.$queryRawUnsafe(
    `
    UPDATE users
       SET email_verified_at = COALESCE(email_verified_at, $3::timestamptz),
           status = CASE WHEN status = '${PENDING_VERIFICATION}' THEN 'ACTIVE' ELSE status END,
           updated_at = NOW()
     WHERE id = $1::uuid AND lower(email::text) = lower($2) AND deleted_at IS NULL
     RETURNING id
    `,
    challenge.user_id,
    challenge.email,
    challenge.consumed_at
  );
  if (!rows.length) {
    throw new OtpError('OTP_CHALLENGE_INVALID', 410, 'This verification session is no longer valid. Start again.');
  }
}

/** 202 with a challenge instead of a session; the client shows the code screen. */
async function respondWithChallenge(res, user, purpose, status) {
  try {
    const { challenge } = await emailOtp.issue({ user, purpose });
    return res.status(202).json({
      status,
      message: status === 'OTP_REQUIRED' ? 'Enter the code sent to your email to finish signing in' : 'Verify your email address to activate the account',
      challenge,
    });
  } catch (error) {
    return sendOtpError(res, error, 'login challenge');
  }
}

// Refresh tokens are only issued to clients that ask (the mobile app sends
// client: "mobile"); the web keeps its existing access-token-only session.
function wantsRefreshToken(req) {
  return String(req.body?.client || '').toLowerCase() === 'mobile';
}

function signAccessToken(user, roles, permissions) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      email: user.email,
      status: user.status,
      is_superuser: user.is_superuser,
      roles,
      permissions,
      jti: crypto.randomUUID(),
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '2h' }
  );
}

const FRONTEND_URL = String(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const MAX_FAILED_LOGIN_ATTEMPTS = Number(process.env.MAX_FAILED_LOGIN_ATTEMPTS || 5);
const BCRYPT_ROUNDS = 12;

const BORROW_SERVICE_INTERNAL_URL = String(
  process.env.BORROW_SERVICE_INTERNAL_URL || process.env.BORROW_SERVICE_URL || 'http://borrow-service:3005'
).replace(/\/$/, '');
const INTERNAL_SERVICE_KEY = String(process.env.INTERNAL_SERVICE_KEY || '').trim();

async function rollbackUserCreation(userId) {
  if (!userId) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `
      DELETE FROM user_roles
      WHERE user_id = $1::uuid
      `,
      userId
    );
    await tx.user.delete({ where: { id: userId } });
  });
}

function sanitizeUser(user) {
  const { password_hash, ...safeUser } = user;
  return safeUser;
}

// Maps legacy role codes to canonical codes for JWT backward compatibility.
const LEGACY_ROLE_MAP = {
  MANAGER: 'WAREHOUSE_MANAGER',
  STAFF: 'WAREHOUSE_STAFF',
  WAREHOUSE_OPERATOR: 'WAREHOUSE_STAFF',
  CUSTOMER_SERVICE: 'LIBRARIAN',
};

function normalizeRoles(roles = []) {
  return roles.map((r) => LEGACY_ROLE_MAP[r] || r);
}

function normalizeIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

async function getUserRolesAndPermissions(userId) {
  const roleRows = await prisma.$queryRawUnsafe(
    `
      SELECT DISTINCT r.code
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1::uuid
        AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
      ORDER BY r.code ASC
    `,
    userId
  );

  const permissionRows = await prisma.$queryRawUnsafe(
    `
      SELECT DISTINCT p.code
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = $1::uuid
        AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
      ORDER BY p.code ASC
    `,
    userId
  );

  const roles = roleRows.map((r) => r.code);
  const permissions = new Set(permissionRows.map((p) => p.code));

  if (roles.includes('CUSTOMER')) {
    permissions.add('inventory.catalog.read');
    permissions.add('customer.self.read');
    permissions.add('customer.self.write');
  }

  return {
    roles,
    permissions: Array.from(permissions.values()),
  };
}

async function register(req, res) {
  try {
    const username = String(req.body?.username || '').trim();
    const email = normalizeIdentifier(req.body?.email);
    const password = String(req.body?.password || '');
    const full_name = String(req.body?.full_name || '').trim();

    if (!username || !email || !password || !full_name) {
      return res.status(400).json({ message: 'username, email, password, full_name are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const existingUser = await prisma.$queryRawUnsafe(
      `
      SELECT id
      FROM users
      WHERE lower(username::text) = lower($1)
         OR lower(email::text) = lower($2)
      LIMIT 1
      `,
      username,
      email
    );

    if (existingUser.length) {
      return res.status(409).json({ message: 'Email or username already exists' });
    }

    const verificationRequired = registrationVerificationRequired();
    // Without a mail server the account could never be activated: refuse up front
    // instead of leaving a pending account behind.
    if (verificationRequired && !isEmailConfigured()) {
      return res.status(503).json({ message: 'Email delivery is unavailable. Registration is temporarily closed.', code: 'EMAIL_DELIVERY_UNAVAILABLE' });
    }

    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const createdUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username,
          email,
          password_hash,
          full_name,
          status: verificationRequired ? PENDING_VERIFICATION : 'ACTIVE',
        },
      });

      await tx.role.upsert({
        where: { code: 'CUSTOMER' },
        update: {},
        create: {
          code: 'CUSTOMER',
          name: 'Customer',
        },
      });

      await tx.$executeRawUnsafe(
        `
        INSERT INTO user_roles (user_id, role_id)
        SELECT $1::uuid, r.id
        FROM roles r
        WHERE r.code = 'CUSTOMER'
        ON CONFLICT DO NOTHING
        `,
        user.id
      );

      await tx.$executeRawUnsafe(
        `
        INSERT INTO permissions (code, module_name, action_name, description)
        VALUES
          ('inventory.catalog.read', 'inventory', 'read', 'View catalog and variants'),
          ('customer.self.read', 'customer', 'read', 'View own customer portal resources'),
          ('customer.self.write', 'customer', 'write', 'Update own customer profile and self-service requests')
        ON CONFLICT (code) DO NOTHING
        `
      );

      await tx.$executeRawUnsafe(
        `
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM roles r
        JOIN permissions p
          ON p.code IN ('inventory.catalog.read', 'customer.self.read', 'customer.self.write')
        WHERE r.code = 'CUSTOMER'
        ON CONFLICT DO NOTHING
        `
      );

      return user;
    });

    try {
      const provisionResponse = await fetch(`${BORROW_SERVICE_INTERNAL_URL}/internal/customers/provision`, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: {
          'Content-Type': 'application/json',
          'x-internal-service-key': INTERNAL_SERVICE_KEY,
          ...(req.requestId ? { 'x-request-id': req.requestId } : {}),
        },
        body: JSON.stringify({
          user_id: createdUser.id,
          email: createdUser.email,
          full_name: createdUser.full_name,
        }),
      });

      if (!provisionResponse.ok) {
        const provisionBody = await provisionResponse.text();
        console.error('register provision failed:', provisionResponse.status, provisionBody);
        await rollbackUserCreation(createdUser.id);
        return res.status(502).json({ message: 'Unable to create customer profile. Please try again.' });
      }
    } catch (provisionError) {
      console.error('register provision error:', provisionError);
      await rollbackUserCreation(createdUser.id);
      return res.status(502).json({ message: 'Unable to create customer profile. Please try again.' });
    }

    if (!verificationRequired) {
      return res.status(201).json({ status: 'REGISTERED', message: 'Register successful' });
    }

    // The account exists from here on. If the email cannot go out now, the client
    // still gets the challenge and can ask for the code again; logging in with the
    // password also starts a fresh challenge.
    let challenge = null;
    let emailDelivery = 'SENT';
    try {
      challenge = (await emailOtp.issue({ user: createdUser, purpose: PURPOSES.EMAIL_VERIFICATION })).challenge;
    } catch (error) {
      emailDelivery = 'FAILED';
      if (error instanceof OtpError) challenge = error.extra?.challenge || null;
      else console.error('register otp error:', error);
    }

    return res.status(201).json({
      status: 'VERIFICATION_REQUIRED',
      message: 'Register successful. Verify your email address to activate the account.',
      email_delivery: emailDelivery,
      challenge,
    });
  } catch (error) {
    console.error('register error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function me(req, res) {
  try {
    const userId = req.auth?.sub;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { roles, permissions } = await getUserRolesAndPermissions(user.id);
    return res.json({
      user: {
        ...sanitizeUser(user),
        roles,
        permissions,
      },
    });
  } catch (error) {
    console.error('me error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function listWarehouseStaff(req, res) {
  try {
    const roles = normalizeRoles(Array.isArray(req.auth?.roles) ? req.auth.roles.map((role) => String(role).toUpperCase()) : []);
    const canManageAssignments = Boolean(req.auth?.is_superuser) || roles.includes('ADMIN') || roles.includes('WAREHOUSE_MANAGER');

    if (!canManageAssignments) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const users = await prisma.$queryRawUnsafe(
      `
      SELECT DISTINCT
        u.id,
        u.username,
        u.full_name,
        u.email,
        u.status
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      WHERE u.deleted_at IS NULL
        AND u.status = 'ACTIVE'
        AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
        AND r.code = 'WAREHOUSE_STAFF'
      ORDER BY u.full_name ASC, u.username ASC
      `
    );

    return res.json({ data: users });
  } catch (error) {
    console.error('listWarehouseStaff error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function updateMe(req, res) {
  try {
    const userId = req.auth?.sub;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const full_name = req.body?.full_name;
    const email = req.body?.email;
    const phone = req.body?.phone;

    if (full_name !== undefined && String(full_name).trim().length < 2) {
      return res.status(400).json({ message: 'full_name must be at least 2 characters' });
    }

    if (email !== undefined) {
      const normalizedEmail = normalizeIdentifier(email);
      if (!normalizedEmail || !normalizedEmail.includes('@')) {
        return res.status(400).json({ message: 'Invalid email format' });
      }
    }

    if (phone !== undefined && phone !== null && String(phone).trim() && !/^[0-9+()\-\s]{6,30}$/.test(String(phone).trim())) {
      return res.status(400).json({ message: 'Invalid phone format' });
    }

    // A new address is unconfirmed until its own code is entered. Where the email is
    // a second factor, an attacker holding a session could otherwise redirect the
    // codes to themselves, so that change goes through an administrator.
    let emailChange = {};
    if (email !== undefined) {
      const nextEmail = normalizeIdentifier(email);
      const current = await prisma.user.findUnique({ where: { id: userId } });
      if (!current) return res.status(404).json({ message: 'User not found' });
      if (nextEmail !== normalizeIdentifier(current.email)) {
        const { roles } = await getUserRolesAndPermissions(userId);
        if (requiresEmailOtp(current, roles)) {
          return res.status(403).json({ message: 'This account uses email sign-in codes; ask an administrator to change its email.', code: 'EMAIL_CHANGE_REQUIRES_ADMIN' });
        }
        emailChange = { email: nextEmail, email_verified_at: null };
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(full_name !== undefined ? { full_name: String(full_name).trim() } : {}),
        ...emailChange,
        ...(phone !== undefined ? { phone: String(phone).trim() || null } : {}),
      },
    });

    const { roles, permissions } = await getUserRolesAndPermissions(updated.id);
    return res.json({
      message: 'Profile updated',
      user: {
        ...sanitizeUser(updated),
        roles,
        permissions,
      },
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Email already exists' });
    }
    console.error('update me error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function logout(req, res) {
  let recorded = true;
  try {
    const auth = req.auth;
    if (auth?.jti && auth?.exp) {
      recorded = await blacklistToken(auth.jti, auth.exp - Math.floor(Date.now() / 1000));
    }
  } catch (error) {
    recorded = false;
    console.error('logout revoke error:', error);
  }
  if (req.body?.refresh_token) {
    try {
      await refreshTokens.revoke(String(req.body.refresh_token));
    } catch (error) {
      recorded = false;
      console.error('logout refresh revoke error:', error);
    }
  }
  // PENDING: Redis was unreachable; the revocation is retried until it lands
  // (lib/token-revocation.js). The client must discard the token either way.
  return res.json({ message: 'Logout successful', token_revocation: recorded ? 'RECORDED' : 'PENDING' });
}

// POST /auth/refresh/revoke { refresh_token } — ends a mobile session even when the
// access token has already expired (so /auth/logout would be refused). Holding the
// refresh token is the proof; this can only take access away.
async function revokeRefresh(req, res) {
  const presented = req.body?.refresh_token;
  if (!presented || typeof presented !== 'string') {
    return res.status(400).json({ message: 'refresh_token is required' });
  }
  try {
    await refreshTokens.revoke(presented);
    return res.json({ message: 'Refresh token revoked' });
  } catch (error) {
    console.error('revokeRefresh error:', error.message);
    return res.status(503).json({ message: 'Token store unavailable', code: 'REFRESH_UNAVAILABLE' });
  }
}

// POST /auth/refresh { refresh_token } -> a new access token and a rotated refresh
// token. The user is re-read from the database, so a locked/deleted account or
// changed roles take effect here rather than being copied from the old token.
async function refresh(req, res) {
  const presented = req.body?.refresh_token;
  if (!presented || typeof presented !== 'string') {
    return res.status(400).json({ message: 'refresh_token is required' });
  }
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ message: 'JWT_SECRET is not configured' });
  }

  let record;
  try {
    record = await refreshTokens.consume(presented);
  } catch (error) {
    if (error instanceof RefreshTokenError) {
      return res.status(401).json({ message: 'Invalid refresh token', code: error.code === 'REUSED' ? 'REFRESH_TOKEN_REUSED' : 'REFRESH_TOKEN_INVALID' });
    }
    console.error('refresh: token store unavailable:', error.message);
    return res.status(503).json({ message: 'Không làm mới được phiên đăng nhập lúc này, vui lòng thử lại.', code: 'REFRESH_UNAVAILABLE' });
  }

  try {
    const cutoff = Number(await redis.getStrict(`user:tokens-valid-after:${record.user_id}`));
    if (Number.isFinite(cutoff) && cutoff > 0 && record.issued_at < cutoff) {
      await refreshTokens.revokeFamily(record.family_id);
      return res.status(401).json({ message: 'Invalid refresh token', code: 'REFRESH_TOKEN_REVOKED' });
    }

    const user = await prisma.user.findUnique({ where: { id: record.user_id } });
    if (!user || user.deleted_at || user.status !== 'ACTIVE') {
      await refreshTokens.revokeFamily(record.family_id);
      return res.status(401).json({ message: 'Invalid refresh token', code: 'REFRESH_TOKEN_REVOKED' });
    }

    const { roles, permissions } = await getUserRolesAndPermissions(user.id);
    // A session that began without the second factor the account now needs (2FA
    // turned on later, or STAFF_EMAIL_OTP_MODE raised) must sign in again.
    if (requiresEmailOtp(user, roles) && !record.mfa) {
      await refreshTokens.revokeFamily(record.family_id);
      return res.status(401).json({ message: 'Invalid refresh token', code: 'REFRESH_TOKEN_REVOKED' });
    }
    const token = signAccessToken(user, roles, permissions);
    const next = await refreshTokens.issue(user.id, record.family_id, { mfa: Boolean(record.mfa) });

    return res.json({
      message: 'Token refreshed',
      token,
      refresh_token: next.token,
      refresh_expires_at: next.expiresAt,
      user: { ...sanitizeUser(user), roles, permissions },
    });
  } catch (error) {
    console.error('refresh error:', error);
    return res.status(503).json({ message: 'Không làm mới được phiên đăng nhập lúc này, vui lòng thử lại.', code: 'REFRESH_UNAVAILABLE' });
  }
}

async function login(req, res) {
  try {
    const identifier = normalizeIdentifier(req.body?.username || req.body?.email || req.body?.identifier);
    const password = String(req.body?.password || '');

    if (!identifier || !password) {
      return res.status(400).json({ message: 'Identifier and password are required' });
    }

    const users = await prisma.$queryRawUnsafe(
      `
      SELECT *
      FROM users
      WHERE deleted_at IS NULL
        AND (
          lower(username::text) = lower($1)
          OR lower(email::text) = lower($1)
        )
      ORDER BY created_at DESC
      LIMIT 1
      `,
      identifier
    );

    const user = users[0];

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      const { failed_login_attempts } = await prisma.user.update({
        where: { id: user.id },
        data: { failed_login_attempts: { increment: 1 } },
        select: { failed_login_attempts: true },
      });

      if (failed_login_attempts >= MAX_FAILED_LOGIN_ATTEMPTS && user.status === 'ACTIVE') {
        await prisma.user.update({ where: { id: user.id }, data: { status: 'LOCKED' } });
        return res.status(403).json({ message: 'Account locked due to too many failed login attempts. Contact an administrator.' });
      }

      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Right password, email not confirmed yet: no session, a verification code instead.
    // Wrong passwords never reach this, so it reveals nothing to someone guessing.
    if (user.status === PENDING_VERIFICATION) {
      if (user.failed_login_attempts > 0) {
        await prisma.user.update({ where: { id: user.id }, data: { failed_login_attempts: 0 } });
      }
      return respondWithChallenge(res, user, PURPOSES.EMAIL_VERIFICATION, 'EMAIL_VERIFICATION_REQUIRED');
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ message: 'User is not active' });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: 'JWT_SECRET is not configured' });
    }

    if (user.failed_login_attempts > 0) {
      await prisma.user.update({ where: { id: user.id }, data: { failed_login_attempts: 0 } });
    }

    const { roles, permissions } = await getUserRolesAndPermissions(user.id);

    // Second factor: nothing that grants access (JWT, refresh token) is issued here.
    if (requiresEmailOtp(user, roles)) {
      return respondWithChallenge(res, user, PURPOSES.LOGIN_2FA, 'OTP_REQUIRED');
    }

    return issueSession(req, res, user, roles, permissions, { mfa: false });
  } catch (error) {
    console.error('login error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

/** The response of a completed login (unchanged contract; `status` is new and optional to read). */
async function issueSession(req, res, user, roles, permissions, { mfa }) {
  const token = signAccessToken(user, roles, permissions);

  let refresh = null;
  if (wantsRefreshToken(req)) {
    try {
      refresh = await refreshTokens.issue(user.id, undefined, { mfa });
    } catch (error) {
      // Redis down: the login still works, the app just has no refresh token and
      // asks for the password again when the access token expires.
      console.warn('login: refresh token not issued:', error.message);
    }
  }

  return res.json({
    status: 'AUTHENTICATED',
    message: 'Login successful',
    token,
    ...(refresh ? { refresh_token: refresh.token, refresh_expires_at: refresh.expiresAt } : {}),
    user: {
      ...sanitizeUser(user),
      roles,
      permissions,
    },
  });
}

// POST /auth/login/verify-otp { challenge_id, code, client? } — second step of a login
// that answered OTP_REQUIRED. Issues exactly what /auth/login would have.
async function verifyLoginOtp(req, res) {
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ message: 'JWT_SECRET is not configured' });
  }

  let challenge;
  try {
    challenge = await emailOtp.verify({
      challengeId: req.body?.challenge_id,
      purpose: PURPOSES.LOGIN_2FA,
      code: req.body?.code,
      apply: markEmailVerified,
    });
  } catch (error) {
    return sendOtpError(res, error, 'verifyLoginOtp');
  }

  try {
    // Re-read: the account may have been locked or deactivated while the code was in the mail.
    const user = await prisma.user.findUnique({ where: { id: challenge.user_id } });
    if (!user || user.deleted_at || user.status !== 'ACTIVE') {
      return res.status(403).json({ message: 'User is not active' });
    }

    // A password change (or lock, role change) after the password step started ends it.
    let cutoff;
    try {
      cutoff = Number(await redis.getStrict(`user:tokens-valid-after:${user.id}`));
    } catch (error) {
      console.error('verifyLoginOtp: revocation state unavailable:', error.message);
      return res.status(503).json({ message: 'Sign-in cannot be completed right now. Try again shortly.', code: 'AUTH_STATE_UNAVAILABLE' });
    }
    if (Number.isFinite(cutoff) && cutoff > Math.floor(new Date(challenge.created_at).getTime() / 1000)) {
      return res.status(410).json({ message: 'This verification session is no longer valid. Start again.', code: 'OTP_CHALLENGE_INVALID' });
    }

    const { roles, permissions } = await getUserRolesAndPermissions(user.id);
    return issueSession(req, res, user, roles, permissions, { mfa: true });
  } catch (error) {
    console.error('verifyLoginOtp error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

// POST /auth/email-otp/verify { challenge_id, code } — confirms the email of a new
// (or not yet verified) account. No session is issued: the client logs in next.
async function verifyEmailOtp(req, res) {
  try {
    await emailOtp.verify({
      challengeId: req.body?.challenge_id,
      purpose: PURPOSES.EMAIL_VERIFICATION,
      code: req.body?.code,
      apply: markEmailVerified,
    });
    return res.json({ status: 'VERIFIED', message: 'Email verified successfully' });
  } catch (error) {
    return sendOtpError(res, error, 'verifyEmailOtp');
  }
}

// POST /auth/email-otp/resend { challenge_id, purpose? } — a new code for the same
// challenge (cooldown, per-challenge and per-account limits in lib/email-otp.js).
async function resendEmailOtp(req, res) {
  const purpose = String(req.body?.purpose || PURPOSES.EMAIL_VERIFICATION).toUpperCase();
  if (!PURPOSES[purpose]) {
    return res.status(400).json({ message: 'Invalid purpose', code: 'VALIDATION_ERROR' });
  }
  try {
    const { challenge } = await emailOtp.resend({ challengeId: req.body?.challenge_id, purpose });
    return res.json({ status: 'OTP_SENT', message: 'A new code has been sent', challenge });
  } catch (error) {
    return sendOtpError(res, error, 'resendEmailOtp');
  }
}

async function changePassword(req, res) {
  try {
    const userId = req.auth?.sub;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ message: 'current_password and new_password are required' });
    if (new_password.length < 6) return res.status(400).json({ message: 'New password must be at least 6 characters' });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(400).json({ message: 'Current password is incorrect' });

    const newHash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);
    await prisma.user.update({ where: { id: userId }, data: { password_hash: newHash } });

    // Revoke every token issued before now for this user (not just the one used to make
    // this request) — otherwise a stolen token kept working for up to JWT_EXPIRES_IN after
    // the account "secured" itself. See auth.middleware.js authenticateToken.
    await revokeUserTokensIssuedBefore(userId);

    return res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('changePassword error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function requestPasswordReset(req, res) {
  try {
    const identifier = normalizeIdentifier(req.body?.identifier || req.body?.email || req.body?.username);
    const genericResponse = { message: 'If the account exists, a reset link has been sent' };

    if (!identifier) {
      return res.status(400).json({ message: 'identifier is required' });
    }

    const users = await prisma.$queryRawUnsafe(
      `
      SELECT id, email, full_name
      FROM users
      WHERE deleted_at IS NULL
        AND status = 'ACTIVE'
        AND (
          lower(username::text) = lower($1)
          OR lower(email::text) = lower($1)
        )
      LIMIT 1
      `,
      identifier
    );

    const user = users[0];
    if (!user) {
      return res.json(genericResponse);
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await prisma.passwordResetToken.create({
      data: {
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
      },
    });

    const resetUrl = `${FRONTEND_URL}/reset-password?token=${rawToken}`;
    sendEmail(user.email, 'PASSWORD_RESET_REQUESTED', { full_name: user.full_name, reset_url: resetUrl }).catch((err) => {
      console.error('requestPasswordReset email error:', err);
    });

    return res.json(genericResponse);
  } catch (error) {
    console.error('requestPasswordReset error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function confirmPasswordReset(req, res) {
  try {
    const token = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.new_password || '');

    if (!token || !newPassword) {
      return res.status(400).json({ message: 'token and new_password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const resetToken = await prisma.passwordResetToken.findUnique({ where: { token_hash: tokenHash } });

    if (!resetToken || resetToken.used_at || resetToken.expires_at < new Date()) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await prisma.$transaction([
      prisma.user.update({ where: { id: resetToken.user_id }, data: { password_hash: newHash } }),
      prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { used_at: new Date() } }),
    ]);

    return res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('confirmPasswordReset error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

// POST /auth/resend-verification (signed in) — accounts that are already active but
// never confirmed their address (existing accounts, or after an email change) get a
// code; it is entered through POST /auth/email-otp/verify like a new account's.
async function resendVerification(req, res) {
  try {
    const userId = req.auth?.sub;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.email_verified_at) {
      return res.json({ status: 'ALREADY_VERIFIED', message: 'Email already verified' });
    }

    const { challenge } = await emailOtp.issue({ user, purpose: PURPOSES.EMAIL_VERIFICATION });
    return res.json({ status: 'OTP_SENT', message: 'Verification code sent', challenge });
  } catch (error) {
    return sendOtpError(res, error, 'resendVerification');
  }
}

module.exports = {
  register,
  login,
  refresh,
  revokeRefresh,
  me,
  listWarehouseStaff,
  updateMe,
  logout,
  changePassword,
  requestPasswordReset,
  confirmPasswordReset,
  resendVerification,
  verifyEmailOtp,
  resendEmailOtp,
  verifyLoginOtp,
};
