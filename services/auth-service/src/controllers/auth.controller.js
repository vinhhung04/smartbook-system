const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

const BORROW_SERVICE_INTERNAL_URL = String(
  process.env.BORROW_SERVICE_INTERNAL_URL || process.env.BORROW_SERVICE_URL || 'http://borrow-service:3005'
).replace(/\/$/, '');
const INTERNAL_SERVICE_KEY = String(process.env.INTERNAL_SERVICE_KEY || 'smartbook-internal-dev-key').trim();

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
    permissions.add('borrow.read');
    permissions.add('borrow.write');
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

    const password_hash = await bcrypt.hash(password, 10);

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

      await tx.$executeRawUnsafe(
        `
        INSERT INTO roles (code, name)
        VALUES ('CUSTOMER', 'Customer')
        ON CONFLICT (code) DO NOTHING
        `
      );

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
          ('borrow.read', 'borrow', 'read', 'View customers, reservations and loans'),
          ('borrow.write', 'borrow', 'write', 'Create reservations, loans and returns')
        ON CONFLICT (code) DO NOTHING
        `
      );

      await tx.$executeRawUnsafe(
        `
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM roles r
        JOIN permissions p
          ON p.code IN ('inventory.catalog.read', 'borrow.read', 'borrow.write')
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

function logout(_req, res) {
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
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ message: 'User is not active' });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: 'JWT_SECRET is not configured' });
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
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
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

    const newHash = await bcrypt.hash(new_password, 10);
    await prisma.user.update({ where: { id: userId }, data: { password_hash: newHash } });

    return res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('changePassword error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  register,
  login,
  me,
  updateMe,
  logout,
  changePassword,
};
