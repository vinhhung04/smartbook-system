const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  const email = String(value || '').trim();
  return email ? email.toLowerCase() : null;
}

const VALID_USER_STATUSES = new Set(['ACTIVE', 'INACTIVE', 'LOCKED', 'PENDING']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uniqueStringArray(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((v) => String(v).trim()).filter(Boolean))];
}

function isValidUuid(value) {
  return UUID_RE.test(String(value || '').trim());
}

function validateEmail(email) {
  return Boolean(email && email.includes('@') && email.indexOf('@') > 0 && email.split('@')[1]?.includes('.'));
}

function validateStatus(status) {
  return VALID_USER_STATUSES.has(status);
}

async function resolveRoleIds(tx, roleIds, roleCodes) {
  if (roleIds !== undefined && !Array.isArray(roleIds)) {
    throw new Error('INVALID_ROLE_IDS');
  }

  if (roleCodes !== undefined && !Array.isArray(roleCodes)) {
    throw new Error('INVALID_ROLE_CODES');
  }

  const directIds = uniqueStringArray(roleIds);
  const codes = uniqueStringArray(roleCodes).map((code) => code.toUpperCase());

  if (directIds.some((id) => !isValidUuid(id))) {
    throw new Error('INVALID_ROLE_IDS');
  }

  const fromCodes = codes.length
    ? await tx.$queryRawUnsafe(
        `SELECT id, code FROM roles WHERE code = ANY($1::text[])`,
        codes
      )
    : [];

  if (fromCodes.length !== codes.length) {
    throw new Error('INVALID_ROLE_CODES');
  }

  const mergedIds = uniqueStringArray([
    ...directIds,
    ...fromCodes.map((r) => r.id),
  ]);

  if (!mergedIds.length) return [];

  const existing = await tx.$queryRawUnsafe(
    `SELECT id FROM roles WHERE id = ANY($1::uuid[])`,
    mergedIds
  );

  const existingIds = new Set(existing.map((r) => r.id));
  if (directIds.some((id) => !existingIds.has(id)) || existing.length !== mergedIds.length) {
    throw new Error('INVALID_ROLE_IDS');
  }

  return existing.map((r) => r.id);
}

async function getUserWithRoles(tx, userId) {
  const rows = await tx.$queryRawUnsafe(
    `
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
      WHERE u.id = $1::uuid
      GROUP BY u.id
      LIMIT 1
    `,
    userId
  );

  return rows[0] || null;
}

async function writeAuditLog(tx, req, actionName, entityId, detail = {}) {
  await tx.$executeRawUnsafe(
    `
      INSERT INTO auth_audit_logs (actor_user_id, action_name, entity_type, entity_id, detail, ip_address, user_agent)
      VALUES ($1::uuid, $2, 'USER', $3::uuid, $4::jsonb, $5, $6)
    `,
    req.auth?.sub || null,
    actionName,
    entityId,
    JSON.stringify(detail),
    req.ip || null,
    req.headers['user-agent'] || null
  );
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

    if (!username) {
      return res.status(400).json({ message: 'username is required' });
    }

    if (!fullName) {
      return res.status(400).json({ message: 'full_name is required' });
    }

    if (!email) {
      return res.status(400).json({ message: 'email is required' });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (!password) {
      return res.status(400).json({ message: 'password is required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    if (!validateStatus(status)) {
      return res.status(400).json({ message: 'Invalid status' });
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

      const roleIds = await resolveRoleIds(tx, req.body?.role_ids, req.body?.role_codes);
      const passwordHash = await bcrypt.hash(password, 10);

      const inserted = await tx.$queryRawUnsafe(
        `
        INSERT INTO users (
          username, email, password_hash, full_name, phone, status, is_superuser, primary_warehouse_id, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
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

      await writeAuditLog(tx, req, 'USER_CREATED', inserted[0].id, {
        username,
        email,
        role_ids: roleIds,
      });

      if (roleIds.length) {
        await writeAuditLog(tx, req, 'USER_ROLES_ASSIGNED', inserted[0].id, { role_ids: roleIds });
      }

      return getUserWithRoles(tx, inserted[0].id);
    });

    return res.status(201).json({ message: 'User created', data: user });
  } catch (error) {
    if (error.message === 'CONFLICT_USER') {
      return res.status(409).json({ message: 'Email or username already exists' });
    }
    if (error.message === 'INVALID_ROLE_IDS') {
      return res.status(400).json({ message: 'One or more role_ids are invalid' });
    }
    if (error.message === 'INVALID_ROLE_CODES') {
      return res.status(400).json({ message: 'One or more role_codes are invalid' });
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
    let nextEmail = null;
    let nextStatus = null;

    if (payload.full_name !== undefined) {
      const fullName = normalizeText(payload.full_name);
      if (!fullName) {
        return res.status(400).json({ message: 'full_name is required' });
      }
      params.push(fullName);
      updates.push(`full_name = $${params.length}`);
    }

    if (payload.phone !== undefined) {
      params.push(normalizeText(payload.phone) || null);
      updates.push(`phone = $${params.length}`);
    }

    if (payload.status !== undefined) {
      nextStatus = normalizeText(payload.status).toUpperCase();
      if (!validateStatus(nextStatus)) {
        return res.status(400).json({ message: 'Invalid status' });
      }
      params.push(nextStatus);
      updates.push(`status = $${params.length}`);
    }

    if (payload.email !== undefined) {
      nextEmail = normalizeEmail(payload.email);
      if (!nextEmail) {
        return res.status(400).json({ message: 'email is required' });
      }
      if (!validateEmail(nextEmail)) {
        return res.status(400).json({ message: 'Invalid email format' });
      }
      params.push(nextEmail);
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
      if (payload.email !== undefined) {
        const existingEmail = await tx.$queryRawUnsafe(
          `
            SELECT id
            FROM users
            WHERE lower(email::text) = lower($1)
              AND id <> $2::uuid
              AND deleted_at IS NULL
            LIMIT 1
          `,
          nextEmail,
          userId
        );

        if (existingEmail.length) {
          throw new Error('CONFLICT_USER');
        }
      }

      const roleIds = roleIdsInput ? await resolveRoleIds(tx, payload.role_ids, payload.role_codes) : null;

      let user = null;

      if (updates.length) {
        updates.push('updated_at = NOW()');
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
        await tx.$executeRawUnsafe(`DELETE FROM user_roles WHERE user_id = $1::uuid`, userId);

        for (const roleId of roleIds) {
          await tx.$executeRawUnsafe(
            `INSERT INTO user_roles (user_id, role_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`,
            userId,
            roleId
          );
        }

        await writeAuditLog(tx, req, 'USER_ROLES_ASSIGNED', userId, { role_ids: roleIds });
      }

      await writeAuditLog(tx, req, 'USER_UPDATED', userId, {
        fields: updates.map((update) => update.split(' = ')[0]).filter((field) => field !== 'updated_at'),
        role_ids_updated: roleIdsInput,
      });

      return getUserWithRoles(tx, userId);
    });

    return res.json({ message: 'User updated', data: updatedUser });
  } catch (error) {
    if (error.message === 'USER_NOT_FOUND') {
      return res.status(404).json({ message: 'User not found' });
    }
    if (error.message === 'CONFLICT_USER') {
      return res.status(409).json({ message: 'Email or username already exists' });
    }
    if (error.message === 'INVALID_ROLE_IDS') {
      return res.status(400).json({ message: 'One or more role_ids are invalid' });
    }
    if (error.message === 'INVALID_ROLE_CODES') {
      return res.status(400).json({ message: 'One or more role_codes are invalid' });
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
