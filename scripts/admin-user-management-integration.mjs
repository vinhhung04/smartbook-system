const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';
const ADMIN_IDENTIFIER = process.env.ADMIN_IDENTIFIER || 'hung';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456';

let passed = 0;
const total = 14;

function fail(message, context = {}) {
  const detail = Object.keys(context).length ? `\n${JSON.stringify(context, null, 2)}` : '';
  throw new Error(`${message}${detail}`);
}

function pass(label) {
  passed += 1;
  console.log(`PASS ${label}`);
}

async function request(method, path, { token, body, expectedStatus } = {}) {
  const url = `${GATEWAY_URL}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    fail('Unexpected response status', {
      method,
      url,
      expectedStatus,
      actualStatus: response.status,
      responseBody: data,
    });
  }

  return { status: response.status, data, method, url };
}

function rolePermissions(role) {
  return Array.isArray(role?.permissions)
    ? role.permissions.map((permission) => permission.code).filter(Boolean)
    : [];
}

function chooseRole(roles, preferredCodes, excludeIds = new Set()) {
  for (const code of preferredCodes) {
    const role = roles.find((item) => item.code === code && !excludeIds.has(item.id));
    if (role) return role;
  }
  return roles.find((item) => item.code !== 'CUSTOMER' && !excludeIds.has(item.id))
    || roles.find((item) => !excludeIds.has(item.id));
}

function assertRoleAssigned(user, roleId) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  if (!roles.some((role) => role.id === roleId)) {
    fail('Expected user to include assigned role', { user, roleId });
  }
}

async function main() {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const password = '123456';

  const adminLogin = await request('POST', '/auth/login', {
    body: {
      identifier: ADMIN_IDENTIFIER,
      username: ADMIN_IDENTIFIER,
      email: ADMIN_IDENTIFIER,
      password: ADMIN_PASSWORD,
    },
    expectedStatus: 200,
  });
  const adminToken = adminLogin.data?.token;
  if (!adminToken) fail('Admin login did not return token', adminLogin);
  pass('admin login');

  const rolesResponse = await request('GET', '/iam/roles', { token: adminToken, expectedStatus: 200 });
  const roles = Array.isArray(rolesResponse.data?.data) ? rolesResponse.data.data : [];
  if (!roles.length) fail('No roles returned from /iam/roles', rolesResponse);
  const createRole = chooseRole(roles, ['STAFF', 'LIBRARIAN', 'WAREHOUSE_OPERATOR', 'CUSTOMER_SERVICE']);
  if (!createRole?.id) fail('Could not choose role for create test', { roles });
  const updateRole = chooseRole(
    roles,
    ['WAREHOUSE_OPERATOR', 'CUSTOMER_SERVICE', 'MANAGER', 'STAFF'],
    new Set([createRole.id])
  );
  if (!updateRole?.id) fail('Could not choose different role for update test', { roles, createRole });
  pass('list roles');

  const username = `admin_user_${stamp}`;
  const email = `${username}@example.com`;
  const createPayload = {
    username,
    full_name: 'Admin User Integration',
    email,
    phone: '0900000001',
    password,
    status: 'ACTIVE',
    role_ids: [createRole.id],
  };

  const createResponse = await request('POST', '/iam/users', {
    token: adminToken,
    body: createPayload,
    expectedStatus: 201,
  });
  const createdUser = createResponse.data?.data;
  if (!createdUser?.id) fail('Create user response missing data.id', createResponse);
  pass('create user with role_ids');

  assertRoleAssigned(createdUser, createRole.id);
  pass('created user has assigned role');

  const listUsers = await request('GET', `/iam/users?search=${encodeURIComponent(username)}`, {
    token: adminToken,
    expectedStatus: 200,
  });
  const listedUser = (listUsers.data?.data || []).find((user) => user.username === username);
  if (!listedUser) fail('Created user was not found by search', listUsers);
  assertRoleAssigned(listedUser, createRole.id);
  pass('list users includes new user');

  const newUserLogin = await request('POST', '/auth/login', {
    body: {
      identifier: username,
      username,
      email,
      password,
    },
    expectedStatus: 200,
  });
  const newUserToken = newUserLogin.data?.token;
  if (!newUserToken) fail('New user login did not return token', newUserLogin);
  pass('new user can login');

  const me = await request('GET', '/auth/me', { token: newUserToken, expectedStatus: 200 });
  const meUser = me.data?.user;
  if (!Array.isArray(meUser?.roles) || !meUser.roles.includes(createRole.code)) {
    fail('Current user roles do not include assigned role code', { meUser, expectedRole: createRole.code });
  }
  const expectedPermissions = rolePermissions(createRole);
  if (expectedPermissions.length && !expectedPermissions.some((permission) => meUser.permissions?.includes(permission))) {
    fail('Current user permissions do not include permissions from assigned role', {
      expectedPermissions,
      actualPermissions: meUser.permissions,
    });
  }
  pass('new user has roles and permissions');

  const updateResponse = await request('PATCH', `/iam/users/${createdUser.id}`, {
    token: adminToken,
    body: { role_ids: [updateRole.id] },
    expectedStatus: 200,
  });
  assertRoleAssigned(updateResponse.data?.data, updateRole.id);
  pass('update user roles');

  await request('POST', '/iam/users', {
    token: adminToken,
    body: {
      ...createPayload,
      username: `missing_email_${stamp}`,
      email: '',
    },
    expectedStatus: 400,
  });
  pass('missing email rejected');

  await request('POST', '/iam/users', {
    token: adminToken,
    body: {
      ...createPayload,
      username: `short_password_${stamp}`,
      email: `short_password_${stamp}@example.com`,
      password: '123',
    },
    expectedStatus: 400,
  });
  pass('short password rejected');

  await request('POST', '/iam/users', {
    token: adminToken,
    body: {
      ...createPayload,
      username: `invalid_role_${stamp}`,
      email: `invalid_role_${stamp}@example.com`,
      role_ids: ['not-a-uuid'],
    },
    expectedStatus: 400,
  });
  pass('invalid role id rejected');

  await request('POST', '/iam/users', {
    token: adminToken,
    body: {
      ...createPayload,
      username: `unknown_role_${stamp}`,
      email: `unknown_role_${stamp}@example.com`,
      role_ids: ['00000000-0000-4000-8000-000000000000'],
    },
    expectedStatus: 400,
  });
  pass('unknown role id rejected');

  await request('POST', '/iam/users', {
    token: adminToken,
    body: {
      ...createPayload,
      full_name: 'Duplicate Admin User Integration',
    },
    expectedStatus: 409,
  });
  pass('duplicate user rejected');

  const lockResponse = await request('PATCH', `/iam/users/${createdUser.id}`, {
    token: adminToken,
    body: { status: 'LOCKED' },
    expectedStatus: 200,
  });
  if (lockResponse.data?.data?.status !== 'LOCKED') {
    fail('Lock response did not return LOCKED status', lockResponse);
  }
  pass('lock user');

  console.log(`PASS=${passed} TOTAL=${total}`);
}

main().catch((error) => {
  console.error(error.message || error);
  console.error(`PASS=${passed} TOTAL=${total}`);
  process.exit(1);
});
