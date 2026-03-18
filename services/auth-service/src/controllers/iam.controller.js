const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  const email = String(value || '').trim();
  return email ? email.toLowerCase() : null;
}

function uniqueStringArray(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((v) => String(v).trim()).filter(Boolean))];
}

async function resolveRoleIds(tx, roleIds, roleCodes) {
  const directIds = uniqueStringArray(roleIds);
  const codes = uniqueStringArray(roleCodes).map((code) => code.toUpperCase());

  const fromCodes = codes.length
    ? await tx.$queryRawUnsafe(
        `SELECT id FROM roles WHERE code = ANY($1::text[])`,
        codes
      )
    : [];

  const mergedIds = uniqueStringArray([
    ...directIds,
    ...fromCodes.map((r) => r.id),
  ]);

  if (!mergedIds.length) return [];

  const existing = await tx.$queryRawUnsafe(
    `SELECT id FROM roles WHERE id = ANY($1::uuid[])`,
    mergedIds
  );

  return existing.map((r) => r.id);
}

async function listUsers(req, res) {
  try {
    const search = normalizeText(req.query.search);
    const status = normalizeText(req.query.status).toUpperCase();

    const conditions = ['u.deleted_at IS NULL'];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      conditions.push(`(u.full_name ILIKE $${i} OR u.username ILIKE $${i} OR COALESCE(u.email::text, '') ILIKE $${i})`);
    }

    if (status) {
      params.push(status);
      conditions.push(`u.status = $${params.length}`);
    }

    const query = `
      SELECT
        u.id,
        u.username,
        u.email,
        u.full_name,
        u.phone,
        u.status,
        u.is_superuser,
        u.primary_warehouse_id,
        u.created_at,
        u.updated_at,
        COALESCE(
          json_agg(DISTINCT jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name))
          FILTER (WHERE r.id IS NOT NULL),
          '[]'::json
        ) AS roles
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `;

    const users = await prisma.$queryRawUnsafe(query, ...params);
    return res.json({ data: users });
  } catch (error) {
    console.error('listUsers error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function createUser(req, res) {
  try {
    const username = normalizeText(req.body?.username);
    const fullName = normalizeText(req.body?.full_name);
    const email = normalizeEmail(req.body?.email);
    const phone = normalizeText(req.body?.phone) || null;
    const password = String(req.body?.password || '');
    const status = normalizeText(req.body?.status).toUpperCase() || 'ACTIVE';
    const isSuperuser = Boolean(req.body?.is_superuser);
    const primaryWarehouseId = normalizeText(req.body?.primary_warehouse_id) || null;

    if (!username || !fullName || !password) {
      return res.status(400).json({ message: 'username, full_name, password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const user = await prisma.$transaction(async (tx) => {
      const existed = await tx.$queryRawUnsafe(
        `
          SELECT id
          FROM users
          WHERE lower(username::text) = lower($1)
             OR ($2::text IS NOT NULL AND lower(email::text) = lower($2))
          LIMIT 1
        `,
        username,
        email
      );

      if (existed.length) {
        throw new Error('CONFLICT_USER');
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const inserted = await tx.$queryRawUnsafe(
        `
        INSERT INTO users (
          username, email, password_hash, full_name, phone, status, is_superuser, primary_warehouse_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, username, email, full_name, phone, status, is_superuser, primary_warehouse_id, created_at, updated_at
      `,
        username,
        email,
        passwordHash,
        fullName,
        phone,
        status,
        isSuperuser,
        primaryWarehouseId
      );

      const roleIds = await resolveRoleIds(tx, req.body?.role_ids, req.body?.role_codes);
      for (const roleId of roleIds) {
        await tx.$executeRawUnsafe(
          `
          INSERT INTO user_roles (user_id, role_id)
          VALUES ($1::uuid, $2::uuid)
          ON CONFLICT DO NOTHING
        `,
          inserted[0].id,
          roleId
        );
      }

      return inserted[0];
    });

    return res.status(201).json({ message: 'User created', data: user });
  } catch (error) {
    if (error.message === 'CONFLICT_USER') {
      return res.status(409).json({ message: 'Email or username already exists' });
    }
    console.error('createUser error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function updateUser(req, res) {
  try {
    const userId = normalizeText(req.params.id);

    if (!userId) {
      return res.status(400).json({ message: 'User id is required' });
    }

    const payload = req.body || {};
    const updates = [];
    const params = [];

    if (payload.full_name !== undefined) {
      params.push(normalizeText(payload.full_name));
      updates.push(`full_name = $${params.length}`);
    }

    if (payload.phone !== undefined) {
      params.push(normalizeText(payload.phone) || null);
      updates.push(`phone = $${params.length}`);
    }

    if (payload.status !== undefined) {
      params.push(normalizeText(payload.status).toUpperCase());
      updates.push(`status = $${params.length}`);
    }

    if (payload.email !== undefined) {
      params.push(normalizeEmail(payload.email));
      updates.push(`email = $${params.length}`);
    }

    if (payload.primary_warehouse_id !== undefined) {
      params.push(normalizeText(payload.primary_warehouse_id) || null);
      updates.push(`primary_warehouse_id = $${params.length}`);
    }

    const roleIdsInput = payload.role_ids !== undefined || payload.role_codes !== undefined;

    if (!updates.length && !roleIdsInput) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      let user = null;

      if (updates.length) {
        params.push(userId);
        const query = `
          UPDATE users
          SET ${updates.join(', ')}
          WHERE id = $${params.length}::uuid
          RETURNING id, username, email, full_name, phone, status, is_superuser, primary_warehouse_id, created_at, updated_at
        `;

        const rows = await tx.$queryRawUnsafe(query, ...params);
        user = rows[0];
      } else {
        const rows = await tx.$queryRawUnsafe(
          `SELECT id, username, email, full_name, phone, status, is_superuser, primary_warehouse_id, created_at, updated_at FROM users WHERE id = $1::uuid`,
          userId
        );
        user = rows[0];
      }

      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      if (roleIdsInput) {
        const roleIds = await resolveRoleIds(tx, payload.role_ids, payload.role_codes);
        await tx.$executeRawUnsafe(`DELETE FROM user_roles WHERE user_id = $1::uuid`, userId);

        for (const roleId of roleIds) {
          await tx.$executeRawUnsafe(
            `INSERT INTO user_roles (user_id, role_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`,
            userId,
            roleId
          );
        }
      }

      return user;
    });

    return res.json({ message: 'User updated', data: updatedUser });
  } catch (error) {
    if (error.message === 'USER_NOT_FOUND') {
      return res.status(404).json({ message: 'User not found' });
    }
    console.error('updateUser error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function listRoles(req, res) {
  try {
    const roles = await prisma.$queryRawUnsafe(`
      SELECT
        r.id,
        r.code,
        r.name,
        r.description,
        r.is_system,
        r.created_at,
        r.updated_at,
        COUNT(DISTINCT ur.user_id)::int AS user_count,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', p.id,
              'code', p.code,
              'module_name', p.module_name,
              'action_name', p.action_name,
              'description', p.description
            )
          ) FILTER (WHERE p.id IS NOT NULL),
          '[]'::json
        ) AS permissions
      FROM roles r
      LEFT JOIN user_roles ur ON ur.role_id = r.id
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions p ON p.id = rp.permission_id
      GROUP BY r.id
      ORDER BY r.name ASC
    `);

    return res.json({ data: roles });
  } catch (error) {
    console.error('listRoles error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function createRole(req, res) {
  try {
    const code = normalizeText(req.body?.code).toUpperCase();
    const name = normalizeText(req.body?.name);
    const description = normalizeText(req.body?.description) || null;
    const isSystem = Boolean(req.body?.is_system);
    const permissionIds = uniqueStringArray(req.body?.permission_ids);

    if (!code || !name) {
      return res.status(400).json({ message: 'code and name are required' });
    }

    const role = await prisma.$transaction(async (tx) => {
      const existing = await tx.$queryRawUnsafe(`SELECT id FROM roles WHERE code = $1 LIMIT 1`, code);
      if (existing.length) {
        throw new Error('CONFLICT_ROLE');
      }

      const inserted = await tx.$queryRawUnsafe(
        `
          INSERT INTO roles (code, name, description, is_system)
          VALUES ($1, $2, $3, $4)
          RETURNING id, code, name, description, is_system, created_at, updated_at
        `,
        code,
        name,
        description,
        isSystem
      );

      const roleId = inserted[0].id;

      if (permissionIds.length) {
        const availablePermissions = await tx.$queryRawUnsafe(
          `SELECT id FROM permissions WHERE id = ANY($1::uuid[])`,
          permissionIds
        );

        for (const permission of availablePermissions) {
          await tx.$executeRawUnsafe(
            `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`,
            roleId,
            permission.id
          );
        }
      }

      return inserted[0];
    });

    return res.status(201).json({ message: 'Role created', data: role });
  } catch (error) {
    if (error.message === 'CONFLICT_ROLE') {
      return res.status(409).json({ message: 'Role code already exists' });
    }
    console.error('createRole error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function listPermissions(req, res) {
  try {
    const permissions = await prisma.$queryRawUnsafe(`
      SELECT id, code, module_name, action_name, description
      FROM permissions
      ORDER BY module_name ASC, code ASC
    `);

    return res.json({ data: permissions });
  } catch (error) {
    console.error('listPermissions error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function updateRolePermissions(req, res) {
  try {
    const roleId = normalizeText(req.params.id);
    const permissionIds = uniqueStringArray(req.body?.permission_ids);

    if (!roleId) {
      return res.status(400).json({ message: 'Role id is required' });
    }

    await prisma.$transaction(async (tx) => {
      const roleRows = await tx.$queryRawUnsafe(`SELECT id FROM roles WHERE id = $1::uuid`, roleId);
      if (!roleRows.length) {
        throw new Error('ROLE_NOT_FOUND');
      }

      await tx.$executeRawUnsafe(`DELETE FROM role_permissions WHERE role_id = $1::uuid`, roleId);

      if (permissionIds.length) {
        const validPermissions = await tx.$queryRawUnsafe(
          `SELECT id FROM permissions WHERE id = ANY($1::uuid[])`,
          permissionIds
        );

        for (const permission of validPermissions) {
          await tx.$executeRawUnsafe(
            `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`,
            roleId,
            permission.id
          );
        }
      }
    });

    return res.json({ message: 'Role permissions updated' });
  } catch (error) {
    if (error.message === 'ROLE_NOT_FOUND') {
      return res.status(404).json({ message: 'Role not found' });
    }
    console.error('updateRolePermissions error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  listUsers,
  createUser,
  updateUser,
  listRoles,
  createRole,
  listPermissions,
  updateRolePermissions,
};
