const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

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

  return {
    roles: roleRows.map((r) => r.code),
    permissions: permissionRows.map((p) => p.code),
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

    const createdUser = await prisma.user.create({
      data: {
        username,
        email,
        password_hash,
        full_name,
        status: 'ACTIVE',
      },
    });

    return res.status(201).json({
      message: 'Register successful',
      user: sanitizeUser(createdUser),
    });
  } catch (error) {
    console.error('register error:', error);
    return res.status(500).json({ message: 'Internal server error' });
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

module.exports = {
  register,
  login,
};
