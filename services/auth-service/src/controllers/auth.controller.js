const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const redis = require('../lib/redis');
const { sendEmail } = require('../lib/email-sender');

const FRONTEND_URL = String(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_FAILED_LOGIN_ATTEMPTS = Number(process.env.MAX_FAILED_LOGIN_ATTEMPTS || 5);
const BCRYPT_ROUNDS = 12;

async function sendVerificationEmail(user) {
  try {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await prisma.emailVerificationToken.create({
      data: {
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS),
      },
    });

    const verifyUrl = `${FRONTEND_URL}/verify-email?token=${rawToken}`;
    sendEmail(user.email, 'EMAIL_VERIFICATION_REQUESTED', { full_name: user.full_name, verify_url: verifyUrl }).catch((err) => {
      console.error('sendVerificationEmail email error:', err);
    });
  } catch (err) {
    console.error('sendVerificationEmail error:', err);
  }
}

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

    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const createdUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username,
          email,
          password_hash,
          full_name,
          status: 'ACTIVE',
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

    await sendVerificationEmail(createdUser);

    return res.status(201).json({
      message: 'Register successful',
      user: sanitizeUser(createdUser),
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

    if (full_name !== undefined && String(full_name).trim().length < 2) {
      return res.status(400).json({ message: 'full_name must be at least 2 characters' });
    }

    if (email !== undefined) {
      const normalizedEmail = normalizeIdentifier(email);
      if (!normalizedEmail || !normalizedEmail.includes('@')) {
        return res.status(400).json({ message: 'Invalid email format' });
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(full_name !== undefined ? { full_name: String(full_name).trim() } : {}),
        ...(email !== undefined ? { email: normalizeIdentifier(email) } : {}),
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
  try {
    const auth = req.auth;
    if (auth?.jti && auth?.exp) {
      const expiresInSeconds = auth.exp - Math.floor(Date.now() / 1000);
      if (expiresInSeconds > 0) {
        await redis.set(`blacklist:token:${auth.jti}`, '1', expiresInSeconds);
      }
    }
  } catch (error) {
    console.error('logout revoke error:', error);
  }
  return res.json({ message: 'Logout successful' });
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

    const token = jwt.sign(
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

    return res.json({
      message: 'Login successful',
      token,
      user: {
        ...sanitizeUser(user),
        roles,
        permissions,
      },
    });
  } catch (error) {
    console.error('login error:', error);
    return res.status(500).json({ message: 'Internal server error' });
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

async function verifyEmail(req, res) {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) {
      return res.status(400).json({ message: 'token is required' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const verificationToken = await prisma.emailVerificationToken.findUnique({ where: { token_hash: tokenHash } });

    if (!verificationToken || verificationToken.used_at || verificationToken.expires_at < new Date()) {
      return res.status(400).json({ message: 'Invalid or expired verification token' });
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: verificationToken.user_id }, data: { email_verified_at: new Date() } }),
      prisma.emailVerificationToken.update({ where: { id: verificationToken.id }, data: { used_at: new Date() } }),
    ]);

    return res.json({ message: 'Email verified successfully' });
  } catch (error) {
    console.error('verifyEmail error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  register,
  login,
  me,
  listWarehouseStaff,
  updateMe,
  logout,
  changePassword,
  requestPasswordReset,
  confirmPasswordReset,
  verifyEmail,
};
