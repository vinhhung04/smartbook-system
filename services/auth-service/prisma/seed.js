const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const DEMO_PASSWORD = '123456';

const permissions = [
  { code: 'auth.users.read', module_name: 'auth', action_name: 'read', description: 'View users' },
  { code: 'auth.users.write', module_name: 'auth', action_name: 'write', description: 'Create and update users' },
  { code: 'auth.roles.read', module_name: 'auth', action_name: 'read', description: 'View roles' },
  { code: 'auth.roles.write', module_name: 'auth', action_name: 'write', description: 'Create and update roles' },
  { code: 'auth.permissions.read', module_name: 'auth', action_name: 'read', description: 'View permissions' },
  { code: 'auth.permissions.write', module_name: 'auth', action_name: 'write', description: 'Manage permissions' },
  { code: 'auth.sessions.manage', module_name: 'auth', action_name: 'write', description: 'Manage sessions' },
  { code: 'auth.audit.read', module_name: 'auth', action_name: 'read', description: 'View auth audit log' },

  { code: 'customer.self.read', module_name: 'customer', action_name: 'read', description: 'View own customer profile' },
  { code: 'customer.self.write', module_name: 'customer', action_name: 'write', description: 'Update own customer profile' },

  { code: 'inventory.catalog.read', module_name: 'inventory', action_name: 'read', description: 'View catalog' },
  { code: 'inventory.catalog.write', module_name: 'inventory', action_name: 'write', description: 'Manage catalog' },
  { code: 'inventory.catalog.import', module_name: 'inventory', action_name: 'write', description: 'Import catalog data' },
  { code: 'inventory.catalog.export', module_name: 'inventory', action_name: 'read', description: 'Export catalog data' },
  { code: 'inventory.stock.read', module_name: 'inventory', action_name: 'read', description: 'View stock' },
  { code: 'inventory.stock.write', module_name: 'inventory', action_name: 'write', description: 'Mutate stock' },
  { code: 'inventory.stock.audit', module_name: 'inventory', action_name: 'write', description: 'Run stock audits' },
  { code: 'inventory.warehouse.read', module_name: 'inventory', action_name: 'read', description: 'View warehouses and locations' },
  { code: 'inventory.warehouse.write', module_name: 'inventory', action_name: 'write', description: 'Manage warehouses and locations' },
  { code: 'inventory.receiving.read', module_name: 'inventory', action_name: 'read', description: 'View receiving and goods receipts' },
  { code: 'inventory.receiving.write', module_name: 'inventory', action_name: 'write', description: 'Create receiving and goods receipts' },
  { code: 'inventory.putaway.execute', module_name: 'inventory', action_name: 'write', description: 'Execute putaway' },
  { code: 'inventory.transfer.read', module_name: 'inventory', action_name: 'read', description: 'View transfer and outbound work' },
  { code: 'inventory.transfer.write', module_name: 'inventory', action_name: 'write', description: 'Execute transfer and outbound work' },
  { code: 'inventory.purchase.read', module_name: 'inventory', action_name: 'read', description: 'View purchase orders and suppliers' },
  { code: 'inventory.purchase.write', module_name: 'inventory', action_name: 'write', description: 'Create and edit purchase orders' },
  { code: 'inventory.purchase.approve', module_name: 'inventory', action_name: 'write', description: 'Approve or reject purchase orders' },

  { code: 'borrow.customers.read', module_name: 'borrow', action_name: 'read', description: 'View customer records' },
  { code: 'borrow.customers.write', module_name: 'borrow', action_name: 'write', description: 'Manage customer records' },
  { code: 'borrow.loans.read', module_name: 'borrow', action_name: 'read', description: 'View reservations and loans' },
  { code: 'borrow.loans.write', module_name: 'borrow', action_name: 'write', description: 'Create loans, returns, and reservations' },
  { code: 'borrow.fines.read', module_name: 'borrow', action_name: 'read', description: 'View fines' },
  { code: 'borrow.fines.manage', module_name: 'borrow', action_name: 'write', description: 'Manage fines' },
  { code: 'borrow.payments.process', module_name: 'borrow', action_name: 'write', description: 'Process payments' },
  { code: 'borrow.notifications.manage', module_name: 'borrow', action_name: 'write', description: 'Send borrowing notifications' },
  { code: 'borrow.memberships.manage', module_name: 'borrow', action_name: 'write', description: 'Manage membership plans' },
  { code: 'borrow.self.read', module_name: 'borrow', action_name: 'read', description: 'View own borrow data' },
  { code: 'borrow.self.write', module_name: 'borrow', action_name: 'write', description: 'Create own reservations and requests' },
  { code: 'fine.self.read', module_name: 'borrow', action_name: 'read', description: 'View own fines' },
  { code: 'notification.self.read', module_name: 'borrow', action_name: 'read', description: 'View own notifications' },
  { code: 'account.self.read', module_name: 'borrow', action_name: 'read', description: 'View own account ledger' },

  { code: 'analytics.reports.view', module_name: 'analytics', action_name: 'read', description: 'View reports' },
  { code: 'analytics.reports.export', module_name: 'analytics', action_name: 'read', description: 'Export reports' },
  { code: 'analytics.forecast.view', module_name: 'analytics', action_name: 'read', description: 'View forecasts' },

  { code: 'ai.scan.receipt', module_name: 'ai', action_name: 'write', description: 'Scan receipt documents' },
  { code: 'ai.ocr.process', module_name: 'ai', action_name: 'write', description: 'Run OCR' },
  { code: 'ai.catalog.assist', module_name: 'ai', action_name: 'write', description: 'Use AI catalog assistance' },
  { code: 'ai.recommendation.view', module_name: 'ai', action_name: 'read', description: 'View AI recommendations' },
  { code: 'chatbot.use', module_name: 'chatbot', action_name: 'execute', description: 'Use chatbot' },

  { code: 'supplier.portal.read', module_name: 'supplier', action_name: 'read', description: 'View supplier portal' },
  { code: 'supplier.portal.write', module_name: 'supplier', action_name: 'write', description: 'Confirm orders and submit documents' },

  { code: 'platform.settings.read', module_name: 'platform', action_name: 'read', description: 'View platform settings' },
  { code: 'platform.settings.write', module_name: 'platform', action_name: 'write', description: 'Update platform settings' },
  { code: 'observability.logs.read', module_name: 'platform', action_name: 'read', description: 'View operational logs' },

  // Legacy compatibility only. These are intentionally not granted to CUSTOMER.
  { code: 'borrow.read', module_name: 'borrow', action_name: 'read', description: 'Legacy broad borrow read' },
  { code: 'borrow.write', module_name: 'borrow', action_name: 'write', description: 'Legacy broad borrow write' },
];

const roles = [
  { code: 'CUSTOMER', name: 'Customer', description: 'Customer portal user' },
  { code: 'LIBRARIAN', name: 'Librarian', description: 'Borrowing desk and reader services' },
  { code: 'STAFF', name: 'Warehouse Staff', description: 'Warehouse and catalog operations' },
  { code: 'MANAGER', name: 'Manager', description: 'Operational monitoring, reports, approvals, audits' },
  { code: 'ADMIN', name: 'System Administrator', description: 'IAM and platform administration' },
  { code: 'SUPPLIER', name: 'Supplier', description: 'External supplier portal user' },
  { code: 'WAREHOUSE_OPERATOR', name: 'Warehouse Operator', description: 'Legacy alias mapped to STAFF permissions' },
  { code: 'CUSTOMER_SERVICE', name: 'Customer Service', description: 'Legacy alias mapped to LIBRARIAN permissions' },
];

const rolePermissionCodes = {
  CUSTOMER: [
    'inventory.catalog.read',
    'customer.self.read',
    'customer.self.write',
    'borrow.self.read',
    'borrow.self.write',
    'fine.self.read',
    'notification.self.read',
    'account.self.read',
  ],
  LIBRARIAN: [
    'inventory.catalog.read',
    'borrow.customers.read',
    'borrow.customers.write',
    'borrow.loans.read',
    'borrow.loans.write',
    'borrow.fines.read',
    'borrow.fines.manage',
    'borrow.payments.process',
    'borrow.notifications.manage',
    'borrow.memberships.manage',
    'ai.ocr.process',
    'ai.catalog.assist',
  ],
  STAFF: [
    'inventory.catalog.read',
    'inventory.catalog.write',
    'inventory.catalog.import',
    'inventory.stock.read',
    'inventory.stock.write',
    'inventory.warehouse.read',
    'inventory.warehouse.write',
    'inventory.receiving.read',
    'inventory.receiving.write',
    'inventory.putaway.execute',
    'inventory.transfer.read',
    'inventory.transfer.write',
    'inventory.purchase.read',
    'inventory.purchase.write',
    'ai.scan.receipt',
    'ai.ocr.process',
    'ai.catalog.assist',
  ],
  MANAGER: [
    'inventory.catalog.read',
    'inventory.stock.read',
    'inventory.warehouse.read',
    'inventory.receiving.read',
    'inventory.purchase.read',
    'inventory.purchase.approve',
    'inventory.stock.audit',
    'borrow.customers.read',
    'borrow.loans.read',
    'borrow.fines.read',
    'analytics.reports.view',
    'analytics.reports.export',
    'analytics.forecast.view',
    'ai.recommendation.view',
    'observability.logs.read',
  ],
  ADMIN: [
    'auth.users.read',
    'auth.users.write',
    'auth.roles.read',
    'auth.roles.write',
    'auth.permissions.read',
    'auth.permissions.write',
    'auth.sessions.manage',
    'auth.audit.read',
    'platform.settings.read',
    'platform.settings.write',
    'observability.logs.read',
  ],
  SUPPLIER: [
    'supplier.portal.read',
    'supplier.portal.write',
  ],
  WAREHOUSE_OPERATOR: [
    'inventory.catalog.read',
    'inventory.stock.read',
    'inventory.stock.write',
    'inventory.warehouse.read',
    'inventory.receiving.read',
    'inventory.receiving.write',
    'inventory.putaway.execute',
    'inventory.transfer.read',
    'inventory.transfer.write',
  ],
  CUSTOMER_SERVICE: [
    'inventory.catalog.read',
    'borrow.customers.read',
    'borrow.customers.write',
    'borrow.loans.read',
    'borrow.loans.write',
    'borrow.fines.read',
    'borrow.fines.manage',
    'borrow.payments.process',
    'borrow.notifications.manage',
    'borrow.memberships.manage',
  ],
};

const users = [
  { username: 'hung', email: 'hung@smartbook.vn', full_name: 'Nguyen Van Hung', phone: '+84901234567', roles: ['ADMIN'], is_superuser: true },
  { username: 'admin01', email: 'admin01@smartbook.vn', full_name: 'Admin Demo', phone: '+84901234560', roles: ['ADMIN'], is_superuser: false },
  { username: 'manager01', email: 'manager01@smartbook.vn', full_name: 'Tran Thi Lan', phone: '+84901234568', roles: ['MANAGER'], is_superuser: false },
  { username: 'librarian01', email: 'librarian01@smartbook.vn', full_name: 'Thu Thu Demo', phone: '+84901234561', roles: ['LIBRARIAN'], is_superuser: false },
  { username: 'staff01', email: 'staff01@smartbook.vn', full_name: 'Le Van Minh', phone: '+84901234569', roles: ['STAFF'], is_superuser: false },
  { username: 'customer01', email: 'customer01@smartbook.vn', full_name: 'Customer Demo', phone: '+84901234562', roles: ['CUSTOMER'], is_superuser: false },
  { username: 'supplier01', email: 'supplier01@smartbook.vn', full_name: 'Supplier Demo', phone: '+84901234563', roles: ['SUPPLIER'], is_superuser: false },
  { username: 'staff02', email: 'staff02@smartbook.vn', full_name: 'Pham Thi Mai', phone: '+84901234570', roles: ['STAFF'], is_superuser: false },
  { username: 'staff03', email: 'staff03@smartbook.vn', full_name: 'Hoang Van Duc', phone: '+84901234571', roles: ['STAFF'], is_superuser: false },
  { username: 'warehouse01', email: 'warehouse01@smartbook.vn', full_name: 'Nguyen Van Khoa', phone: '+84901234572', roles: ['WAREHOUSE_OPERATOR'], is_superuser: false },
  { username: 'cs01', email: 'cs01@smartbook.vn', full_name: 'Tran Thi Thu', phone: '+84901234573', roles: ['CUSTOMER_SERVICE'], is_superuser: false },
  { username: 'inactive01', email: 'inactive01@smartbook.vn', full_name: 'Vo Van Teo', phone: '+84901234574', roles: ['CUSTOMER'], is_superuser: false, status: 'INACTIVE' },
  { username: 'supplier-sv', email: 'minh@nppsv.com.vn', full_name: 'NPP Sach Viet Supplier', phone: '+84901234575', roles: ['SUPPLIER'], is_superuser: false },
  { username: 'supplier-phuongnam', email: 'hong@ppnps.com.vn', full_name: 'Phuong Nam Supplier', phone: '+84901234576', roles: ['SUPPLIER'], is_superuser: false },
  { username: 'supplier-ibd', email: 'john@ibd.com', full_name: 'International Book Distributor', phone: '+84901234577', roles: ['SUPPLIER'], is_superuser: false },
];

async function upsertPermission(permission) {
  return prisma.permission.upsert({
    where: { code: permission.code },
    update: permission,
    create: permission,
  });
}

async function upsertRole(role) {
  return prisma.role.upsert({
    where: { code: role.code },
    update: { name: role.name, description: role.description, is_system: true },
    create: { ...role, is_system: true },
  });
}

async function grantRolePermissions(role, permissionMap, codes) {
  await prisma.rolePermission.deleteMany({ where: { role_id: role.id } });

  for (const code of codes) {
    const permission = permissionMap.get(code);
    if (!permission) {
      throw new Error(`Missing permission ${code} for role ${role.code}`);
    }

    await prisma.rolePermission.create({
      data: {
        role_id: role.id,
        permission_id: permission.id,
      },
    });
  }
}

async function assignRolesToUser(userId, roleMap, roleCodes) {
  await prisma.userRole.deleteMany({ where: { user_id: userId } });

  for (const roleCode of roleCodes) {
    const role = roleMap.get(roleCode);
    if (!role) {
      throw new Error(`Missing role ${roleCode} for user ${userId}`);
    }

    await prisma.userRole.create({
      data: {
        user_id: userId,
        role_id: role.id,
      },
    });
  }
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  for (const permission of permissions) {
    await upsertPermission(permission);
  }

  for (const role of roles) {
    await upsertRole(role);
  }

  const allPermissions = await prisma.permission.findMany();
  const permissionMap = new Map(allPermissions.map((permission) => [permission.code, permission]));
  const allRoles = await prisma.role.findMany();
  const roleMap = new Map(allRoles.map((role) => [role.code, role]));

  for (const [roleCode, codes] of Object.entries(rolePermissionCodes)) {
    await grantRolePermissions(roleMap.get(roleCode), permissionMap, codes);
  }

  const createdUsers = [];
  for (const user of users) {
    const created = await prisma.user.upsert({
      where: { username: user.username },
      update: {
        email: user.email,
        password_hash: passwordHash,
        full_name: user.full_name,
        phone: user.phone,
        status: user.status || 'ACTIVE',
        is_superuser: user.is_superuser,
        deleted_at: null,
      },
      create: {
        username: user.username,
        email: user.email,
        password_hash: passwordHash,
        full_name: user.full_name,
        phone: user.phone,
        status: user.status || 'ACTIVE',
        is_superuser: user.is_superuser,
      },
    });

    await assignRolesToUser(created.id, roleMap, user.roles);
    createdUsers.push(created);
  }

  const warehouseIds = {
    hcm: '00000000-0000-0000-0000-000000000002',
    hn: '00000000-0000-0000-0000-000000000003',
    branch: '00000000-0000-0000-0000-000000000004',
  };

  const userByUsername = new Map(createdUsers.map((user) => [user.username, user]));
  const scopes = [
    ['hung', warehouseIds.hcm, 'FULL'],
    ['hung', warehouseIds.hn, 'FULL'],
    ['hung', warehouseIds.branch, 'FULL'],
    ['manager01', warehouseIds.hcm, 'READ'],
    ['manager01', warehouseIds.hn, 'READ'],
    ['manager01', warehouseIds.branch, 'READ'],
    ['staff01', warehouseIds.hcm, 'OPERATOR'],
    ['staff02', warehouseIds.hcm, 'OPERATOR'],
    ['staff03', warehouseIds.hcm, 'OPERATOR'],
    ['warehouse01', warehouseIds.hn, 'OPERATOR'],
    ['cs01', warehouseIds.branch, 'READ'],
  ];

  for (const [username, warehouseId, accessLevel] of scopes) {
    const user = userByUsername.get(username);
    if (!user) continue;
    await prisma.userWarehouseScope.upsert({
      where: { user_id_warehouse_id: { user_id: user.id, warehouse_id: warehouseId } },
      update: { access_level: accessLevel },
      create: {
        user_id: user.id,
        warehouse_id: warehouseId,
        access_level: accessLevel,
      },
    });
  }

  await prisma.authAuditLog.createMany({
    data: createdUsers.slice(0, 4).map((user) => ({
      actor_user_id: user.id,
      action_name: 'SEED_USER_READY',
      entity_type: 'USER',
      entity_id: user.id,
      detail: { username: user.username },
      ip_address: '127.0.0.1',
      user_agent: 'seed',
    })),
    skipDuplicates: true,
  });

  console.log('SmartBook auth seed completed');
  console.log(`Permissions: ${permissions.length}`);
  console.log(`Roles: ${roles.map((role) => role.code).join(', ')}`);
  console.log(`Demo password: ${DEMO_PASSWORD}`);
  console.log('Role mappings: cs01 -> CUSTOMER_SERVICE/LIBRARIAN permissions, warehouse01 -> WAREHOUSE_OPERATOR/STAFF permissions, hung -> superuser dev only');
}

main()
  .catch((error) => {
    console.error('Seed error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
