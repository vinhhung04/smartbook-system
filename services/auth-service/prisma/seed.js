const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * SMARTBOOK AUTH SERVICE - SEED DATA
   * ═══════════════════════════════════════════════════════════════════════════════
   * 
   * This seed creates comprehensive demo data for the SmartBook authentication system.
   * Data includes: permissions, roles, users with warehouse scopes.
   * 
   * AI Analysis Metadata:
   * - Role-based access control for workflow permissions
   * - User warehouse scopes for multi-tenant support
   * - Comprehensive audit logging for security analysis
   */

  // ═══════════════════════════════════════════════════════════════════════════════
  // STEP 1: PERMISSIONS (Organized by Module)
  // ═══════════════════════════════════════════════════════════════════════════════

  const permissions = [
    // Auth module
    { code: 'auth.users.read', module_name: 'auth', action_name: 'read', description: 'View user accounts and profiles' },
    { code: 'auth.users.write', module_name: 'auth', action_name: 'write', description: 'Create, update, or deactivate user accounts' },
    { code: 'auth.roles.read', module_name: 'auth', action_name: 'read', description: 'View roles and their permissions' },
    { code: 'auth.roles.write', module_name: 'auth', action_name: 'write', description: 'Create, update, or delete roles and permissions' },
    { code: 'auth.permissions.read', module_name: 'auth', action_name: 'read', description: 'View permissions' },
    { code: 'auth.permissions.write', module_name: 'auth', action_name: 'write', description: 'Create or update permissions' },
    { code: 'auth.sessions.manage', module_name: 'auth', action_name: 'write', description: 'Manage user sessions and tokens' },
    { code: 'auth.audit.read', module_name: 'auth', action_name: 'read', description: 'View authentication audit logs' },
    { code: 'audit.read', module_name: 'audit', action_name: 'read', description: 'View system audit trail' },

    // Catalog module (Inventory)
    { code: 'inventory.catalog.read', module_name: 'inventory', action_name: 'read', description: 'View catalog, books, and variants' },
    { code: 'inventory.catalog.write', module_name: 'inventory', action_name: 'write', description: 'Create or update catalog items' },
    { code: 'inventory.catalog.import', module_name: 'inventory', action_name: 'write', description: 'Import catalog data in bulk' },
    { code: 'inventory.catalog.export', module_name: 'inventory', action_name: 'read', description: 'Export catalog data' },

    // Stock module (Inventory)
    { code: 'inventory.stock.read', module_name: 'inventory', action_name: 'read', description: 'View stock balances, movements, and inventory' },
    { code: 'inventory.stock.write', module_name: 'inventory', action_name: 'write', description: 'Post inventory movements and adjustments' },
    { code: 'inventory.stock.audit', module_name: 'inventory', action_name: 'write', description: 'Perform stock audits and cycle counts' },

    // Warehouse module
    { code: 'inventory.warehouse.read', module_name: 'inventory', action_name: 'read', description: 'View warehouses and locations' },
    { code: 'inventory.warehouse.write', module_name: 'inventory', action_name: 'write', description: 'Create or update warehouses and locations' },

    // Receiving & Putaway
    { code: 'inventory.receiving.read', module_name: 'inventory', action_name: 'read', description: 'View goods receipts and receiving locations' },
    { code: 'inventory.receiving.write', module_name: 'inventory', action_name: 'write', description: 'Create goods receipts and process putaway' },
    { code: 'inventory.putaway.execute', module_name: 'inventory', action_name: 'write', description: 'Execute putaway operations' },

    // Purchase module
    { code: 'inventory.purchase.read', module_name: 'inventory', action_name: 'read', description: 'View purchase orders and suppliers' },
    { code: 'inventory.purchase.write', module_name: 'inventory', action_name: 'write', description: 'Create and manage purchase orders' },
    { code: 'inventory.purchase.approve', module_name: 'inventory', action_name: 'write', description: 'Approve purchase orders' },
    { code: 'inventory.supplier.read', module_name: 'inventory', action_name: 'read', description: 'View suppliers and supplier delivery documents' },
    { code: 'inventory.supplier.write', module_name: 'inventory', action_name: 'write', description: 'Create or update suppliers' },
    { code: 'inventory.audit.read', module_name: 'inventory', action_name: 'read', description: 'View stock audit plans and variances' },
    { code: 'inventory.audit.approve', module_name: 'inventory', action_name: 'write', description: 'Approve stock audit variances' },

    // Supplier account module
    { code: 'supplier.portal.read', module_name: 'supplier', action_name: 'read', description: 'View supplier account purchase orders and delivery documents' },
    { code: 'supplier.portal.write', module_name: 'supplier', action_name: 'write', description: 'Confirm supplier orders and submit delivery documents' },

    // Transfer module
    { code: 'inventory.transfer.read', module_name: 'inventory', action_name: 'read', description: 'View transfer orders' },
    { code: 'inventory.transfer.write', module_name: 'inventory', action_name: 'write', description: 'Create and manage transfer orders' },

    // Borrow module
    { code: 'borrow.customers.read', module_name: 'borrow', action_name: 'read', description: 'View customer profiles and membership' },
    { code: 'borrow.customers.write', module_name: 'borrow', action_name: 'write', description: 'Create or update customer accounts' },
    { code: 'borrow.loans.read', module_name: 'borrow', action_name: 'read', description: 'View reservations and loan transactions' },
    { code: 'borrow.loans.write', module_name: 'borrow', action_name: 'write', description: 'Create reservations, loans, and process returns' },
    { code: 'borrow.fines.manage', module_name: 'borrow', action_name: 'write', description: 'Issue, adjust, or waive fines' },
    { code: 'borrow.payments.process', module_name: 'borrow', action_name: 'write', description: 'Process customer payments' },
    { code: 'borrow.read', module_name: 'borrow', action_name: 'read', description: 'Compatibility permission for circulation read endpoints' },
    { code: 'borrow.write', module_name: 'borrow', action_name: 'write', description: 'Compatibility permission for circulation write endpoints' },
    { code: 'borrow.fine.write', module_name: 'borrow', action_name: 'write', description: 'Manage fines and fine payments' },
    { code: 'borrow.membership.write', module_name: 'borrow', action_name: 'write', description: 'Manage customer memberships and plans' },
    { code: 'customer.self.read', module_name: 'customer', action_name: 'read', description: 'View own customer portal resources' },
    { code: 'customer.self.write', module_name: 'customer', action_name: 'write', description: 'Update own customer profile and self-service requests' },

    // AI module
    { code: 'ai.scan.receipt', module_name: 'ai', action_name: 'write', description: 'Scan and extract data from receipts' },
    { code: 'ai.ocr.process', module_name: 'ai', action_name: 'write', description: 'Process OCR requests' },
    { code: 'ai.recommendation.view', module_name: 'ai', action_name: 'read', description: 'View AI recommendations' },

    // Analytics module
    { code: 'analytics.reports.view', module_name: 'analytics', action_name: 'read', description: 'View analytics reports and dashboards' },
    { code: 'analytics.reports.export', module_name: 'analytics', action_name: 'read', description: 'Export analytics reports' },
    { code: 'analytics.forecast.view', module_name: 'analytics', action_name: 'read', description: 'View demand forecasts' },
    { code: 'reports.read', module_name: 'analytics', action_name: 'read', description: 'View management reports' },

    // Chatbot module
    { code: 'chatbot.use', module_name: 'chatbot', action_name: 'execute', description: 'Use chatbot and save reports' },

    // Platform/Observability module
    { code: 'platform.settings.read', module_name: 'platform', action_name: 'read', description: 'View platform settings' },
    { code: 'platform.settings.write', module_name: 'platform', action_name: 'write', description: 'Update platform settings' },
    { code: 'observability.logs.read', module_name: 'platform', action_name: 'read', description: 'View system logs and audit trails' },
  ];

  for (const perm of permissions) {
    await prisma.permission.upsert({
      where: { code: perm.code },
      update: {},
      create: perm,
    });
  }
  console.log(`✅ Created ${permissions.length} permissions`);

  // ═══════════════════════════════════════════════════════════════════════════════
  // STEP 2: ROLES
  // ═══════════════════════════════════════════════════════════════════════════════

  const adminRole = await prisma.role.upsert({
    where: { code: 'ADMIN' },
    update: {},
    create: {
      code: 'ADMIN',
      name: 'Administrator',
      description: 'Full access to platform configuration, IAM, and all operations',
      is_system: true,
    },
  });

  const managerRole = await prisma.role.upsert({
    where: { code: 'MANAGER' },
    update: {},
    create: {
      code: 'MANAGER',
      name: 'Manager',
      description: 'Can monitor operations, view analytics, approve documents, and manage staff',
      is_system: true,
    },
  });

  const staffRole = await prisma.role.upsert({
    where: { code: 'STAFF' },
    update: {},
    create: {
      code: 'STAFF',
      name: 'Staff',
      description: 'Warehouse staff who operate catalog, receiving, putaway, picking and stock workflows',
      is_system: true,
    },
  });

  const warehouseStaffRole = await prisma.role.upsert({
    where: { code: 'WAREHOUSE_STAFF' },
    update: {},
    create: {
      code: 'WAREHOUSE_STAFF',
      name: 'Warehouse Staff',
      description: 'Focused warehouse role for receiving, putaway, picking, outbound and stock movement workflows',
      is_system: true,
    },
  });

  const warehouseRole = await prisma.role.upsert({
    where: { code: 'WAREHOUSE_OPERATOR' },
    update: {},
    create: {
      code: 'WAREHOUSE_OPERATOR',
      name: 'Warehouse Operator',
      description: 'Focused on warehouse operations: receiving, putaway, picking, outbound',
      is_system: true,
    },
  });

  const customerServiceRole = await prisma.role.upsert({
    where: { code: 'CUSTOMER_SERVICE' },
    update: {},
    create: {
      code: 'CUSTOMER_SERVICE',
      name: 'Customer Service',
      description: 'Handle customer inquiries, reservations, and loan processing',
      is_system: true,
    },
  });

  const librarianRole = await prisma.role.upsert({
    where: { code: 'LIBRARIAN' },
    update: {},
    create: {
      code: 'LIBRARIAN',
      name: 'Librarian',
      description: 'Circulation desk role for customers, reservations, loans, returns, renewals and fines',
      is_system: true,
    },
  });

  const customerRole = await prisma.role.upsert({
    where: { code: 'CUSTOMER' },
    update: {},
    create: {
      code: 'CUSTOMER',
      name: 'Customer',
      description: 'Customer portal self-service role',
      is_system: true,
    },
  });

  console.log('✅ Created system roles');

  // ═══════════════════════════════════════════════════════════════════════════════
  // STEP 3: ASSIGN PERMISSIONS TO ROLES
  // ═══════════════════════════════════════════════════════════════════════════════

  const supplierRole = await prisma.role.upsert({
    where: { code: 'SUPPLIER' },
    update: {},
    create: {
      code: 'SUPPLIER',
      name: 'Supplier',
      description: 'External supplier account for confirming purchase orders and submitting delivery documents',
      is_system: true,
    },
  });

  const allPerms = await prisma.permission.findMany();
  const permMap = {};
  for (const p of allPerms) {
    permMap[p.code] = p;
  }

  async function setRolePermissions(role, codes) {
    await prisma.rolePermission.deleteMany({ where: { role_id: role.id } });
    for (const code of codes) {
      if (permMap[code]) {
        await prisma.rolePermission.upsert({
          where: { role_id_permission_id: { role_id: role.id, permission_id: permMap[code].id } },
          update: {},
          create: { role_id: role.id, permission_id: permMap[code].id },
        });
      }
    }
  }

  await setRolePermissions(adminRole, allPerms.map((perm) => perm.code));
  console.log('✅ Assigned all permissions to ADMIN');

  const managerPermCodes = [
    'inventory.catalog.read',
    'inventory.stock.read',
    'inventory.purchase.read',
    'inventory.purchase.write',
    'inventory.purchase.approve',
    'inventory.supplier.read',
    'inventory.supplier.write',
    'inventory.audit.read',
    'inventory.audit.approve',
    'borrow.read',
    'borrow.customers.read',
    'borrow.loans.read',
    'analytics.reports.view',
    'analytics.reports.export',
    'analytics.forecast.view',
    'reports.read',
    'observability.logs.read',
    'audit.read',
    'ai.recommendation.view',
    'platform.settings.read',
  ];
  await setRolePermissions(managerRole, managerPermCodes);
  console.log(`✅ Assigned ${managerPermCodes.length} permissions to MANAGER`);

  const warehousePermCodes = [
    'inventory.catalog.read',
    'inventory.catalog.write',
    'inventory.stock.read',
    'inventory.stock.write',
    'inventory.warehouse.read',
    'inventory.warehouse.write',
    'inventory.receiving.read',
    'inventory.receiving.write',
    'inventory.putaway.execute',
    'inventory.supplier.read',
    'ai.ocr.process',
  ];
  await setRolePermissions(staffRole, warehousePermCodes);
  await setRolePermissions(warehouseStaffRole, warehousePermCodes);
  await setRolePermissions(warehouseRole, warehousePermCodes);
  console.log(`✅ Assigned ${warehousePermCodes.length} permissions to warehouse staff roles`);

  const librarianPermCodes = [
    'inventory.catalog.read',
    'borrow.read',
    'borrow.write',
    'borrow.customers.read',
    'borrow.customers.write',
    'borrow.loans.read',
    'borrow.loans.write',
    'borrow.fines.manage',
    'borrow.fine.write',
    'borrow.membership.write',
    'borrow.payments.process',
  ];
  await setRolePermissions(librarianRole, librarianPermCodes);
  await setRolePermissions(customerServiceRole, librarianPermCodes);
  console.log(`✅ Assigned ${librarianPermCodes.length} permissions to LIBRARIAN/CUSTOMER_SERVICE`);

  const customerPermCodes = [
    'inventory.catalog.read',
    'customer.self.read',
    'customer.self.write',
    'borrow.read',
    'borrow.write',
  ];
  await setRolePermissions(customerRole, customerPermCodes);
  console.log(`✅ Assigned ${customerPermCodes.length} permissions to CUSTOMER`);

  // ═══════════════════════════════════════════════════════════════════════════════
  // STEP 4: USERS
  // ═══════════════════════════════════════════════════════════════════════════════

  // SUPPLIER: External account only. No stock mutation or warehouse receiving permissions.
  const supplierPermCodes = [
    'supplier.portal.read',
    'supplier.portal.write',
  ];
  await prisma.rolePermission.deleteMany({ where: { role_id: supplierRole.id } });
  for (const code of supplierPermCodes) {
    if (permMap[code]) {
      await prisma.rolePermission.upsert({
        where: { role_id_permission_id: { role_id: supplierRole.id, permission_id: permMap[code].id } },
        update: {},
        create: { role_id: supplierRole.id, permission_id: permMap[code].id },
      });
    }
  }
  console.log(`âœ… Assigned ${supplierPermCodes.length} permissions to SUPPLIER`);

  const passwordHash = await bcrypt.hash('123456', 12);

  const users = await Promise.all([
    // Admin user
    prisma.user.upsert({
      where: { username: 'hung' },
      update: {},
      create: {
        username: 'hung',
        email: 'hung@smartbook.vn',
        password_hash: passwordHash,
        full_name: 'Nguyen Van Hung',
        phone: '+84901234567',
        status: 'ACTIVE',
        is_superuser: true,
      },
    }),
    // Manager user
    prisma.user.upsert({
      where: { username: 'manager01' },
      update: {},
      create: {
        username: 'manager01',
        email: 'manager01@smartbook.vn',
        password_hash: passwordHash,
        full_name: 'Tran Thi Lan',
        phone: '+84901234568',
        status: 'ACTIVE',
        is_superuser: false,
      },
    }),
    // Staff users
    prisma.user.upsert({
      where: { username: 'staff01' },
      update: {},
      create: {
        username: 'staff01',
        email: 'staff01@smartbook.vn',
        password_hash: passwordHash,
        full_name: 'Le Van Minh',
        phone: '+84901234569',
        status: 'ACTIVE',
        is_superuser: false,
      },
    }),
    prisma.user.upsert({
      where: { username: 'staff02' },
      update: {},
      create: {
        username: 'staff02',
        email: 'staff02@smartbook.vn',
        password_hash: passwordHash,
        full_name: 'Pham Thi Mai',
        phone: '+84901234570',
        status: 'ACTIVE',
        is_superuser: false,
      },
    }),
    prisma.user.upsert({
      where: { username: 'staff03' },
      update: {},
      create: {
        username: 'staff03',
        email: 'staff03@smartbook.vn',
        password_hash: passwordHash,
        full_name: 'Hoang Van Duc',
        phone: '+84901234571',
        status: 'ACTIVE',
        is_superuser: false,
      },
    }),
    // Warehouse operator
    prisma.user.upsert({
      where: { username: 'warehouse01' },
      update: {},
      create: {
        username: 'warehouse01',
        email: 'warehouse01@smartbook.vn',
        password_hash: passwordHash,
        full_name: 'Nguyen Van Khoa',
        phone: '+84901234572',
        status: 'ACTIVE',
        is_superuser: false,
      },
    }),
    // Customer service
    prisma.user.upsert({
      where: { username: 'cs01' },
      update: {},
      create: {
        username: 'cs01',
        email: 'cs01@smartbook.vn',
        password_hash: passwordHash,
        full_name: 'Tran Thi Thu',
        phone: '+84901234573',
        status: 'ACTIVE',
        is_superuser: false,
      },
    }),
    prisma.user.upsert({
      where: { username: 'librarian01' },
      update: {},
      create: {
        username: 'librarian01',
        email: 'librarian01@smartbook.vn',
        password_hash: passwordHash,
        full_name: 'Nguyen Thi Thu Thu',
        phone: '+84901234578',
        status: 'ACTIVE',
        is_superuser: false,
      },
    }),
    prisma.user.upsert({
      where: { username: 'customer01' },
      update: {},
      create: {
        username: 'customer01',
        email: 'customer01@smartbook.vn',
        password_hash: passwordHash,
        full_name: 'Demo Customer',
        phone: '+84901234579',
        status: 'ACTIVE',
        is_superuser: false,
      },
    }),
    // Inactive user
    prisma.user.upsert({
      where: { username: 'inactive01' },
      update: {},
      create: {
        username: 'inactive01',
        email: 'inactive01@smartbook.vn',
        password_hash: passwordHash,
        full_name: 'Vo Van Teo',
        phone: '+84901234574',
        status: 'INACTIVE',
        is_superuser: false,
      },
    }),
    // Demo supplier users. Emails match inventory suppliers for supplier account scoping.
    prisma.user.upsert({
      where: { username: 'supplier-sv' },
      update: {},
      create: {
        username: 'supplier-sv',
        email: 'minh@nppsv.com.vn',
        password_hash: passwordHash,
        full_name: 'NPP Sach Viet Supplier',
        phone: '+84901234575',
        status: 'ACTIVE',
        is_superuser: false,
      },
    }),
    prisma.user.upsert({
      where: { username: 'supplier-phuongnam' },
      update: {},
      create: {
        username: 'supplier-phuongnam',
        email: 'hong@ppnps.com.vn',
        password_hash: passwordHash,
        full_name: 'Phuong Nam Supplier',
        phone: '+84901234576',
        status: 'ACTIVE',
        is_superuser: false,
      },
    }),
    prisma.user.upsert({
      where: { username: 'supplier-ibd' },
      update: {},
      create: {
        username: 'supplier-ibd',
        email: 'john@ibd.com',
        password_hash: passwordHash,
        full_name: 'International Book Distributor',
        phone: '+84901234577',
        status: 'ACTIVE',
        is_superuser: false,
      },
    }),
  ]);

  console.log(`✅ Created ${users.length} users`);

  // ═══════════════════════════════════════════════════════════════════════════════
  // STEP 5: ASSIGN ROLES TO USERS
  // ═══════════════════════════════════════════════════════════════════════════════

  const userByUsername = Object.fromEntries(users.map((user) => [user.username, user]));

  async function assignUserRoles(username, roles) {
    const user = userByUsername[username];
    if (!user) return;
    await prisma.userRole.deleteMany({ where: { user_id: user.id } });
    for (const role of roles) {
      await prisma.userRole.upsert({
        where: { user_id_role_id: { user_id: user.id, role_id: role.id } },
        update: {},
        create: { user_id: user.id, role_id: role.id },
      });
    }
  }

  await assignUserRoles('hung', [adminRole]);
  await assignUserRoles('manager01', [managerRole]);
  await assignUserRoles('staff01', [staffRole]);
  await assignUserRoles('staff02', [staffRole]);
  await assignUserRoles('staff03', [warehouseStaffRole]);
  await assignUserRoles('warehouse01', [warehouseStaffRole]);
  await assignUserRoles('cs01', [librarianRole]);
  await assignUserRoles('librarian01', [librarianRole]);
  await assignUserRoles('customer01', [customerRole]);

  console.log('✅ Assigned roles to all users');

  // ═══════════════════════════════════════════════════════════════════════════════
  // STEP 6: USER WAREHOUSE SCOPES
  // ═══════════════════════════════════════════════════════════════════════════════

  await assignUserRoles('supplier-sv', [supplierRole]);
  await assignUserRoles('supplier-phuongnam', [supplierRole]);
  await assignUserRoles('supplier-ibd', [supplierRole]);

  // Placeholder warehouse IDs - these should match actual warehouse IDs from inventory service
  const warehouseIds = {
    'WH-HCM-01': '00000000-0000-0000-0000-000000000002',
    'WH-HN-01': '00000000-0000-0000-0000-000000000003',
    'BR-HCM-01': '00000000-0000-0000-0000-000000000004',
  };

  const warehouseScopes = [
    { user_id: userByUsername.hung.id, warehouse_id: warehouseIds['WH-HCM-01'], access_level: 'FULL' },
    { user_id: userByUsername.hung.id, warehouse_id: warehouseIds['WH-HN-01'], access_level: 'FULL' },
    { user_id: userByUsername.hung.id, warehouse_id: warehouseIds['BR-HCM-01'], access_level: 'FULL' },
    { user_id: userByUsername.manager01.id, warehouse_id: warehouseIds['WH-HCM-01'], access_level: 'READ' },
    { user_id: userByUsername.manager01.id, warehouse_id: warehouseIds['WH-HN-01'], access_level: 'READ' },
    { user_id: userByUsername.manager01.id, warehouse_id: warehouseIds['BR-HCM-01'], access_level: 'READ' },
    { user_id: userByUsername.staff01.id, warehouse_id: warehouseIds['WH-HCM-01'], access_level: 'OPERATOR' },
    { user_id: userByUsername.staff02.id, warehouse_id: warehouseIds['WH-HCM-01'], access_level: 'OPERATOR' },
    { user_id: userByUsername.staff03.id, warehouse_id: warehouseIds['WH-HCM-01'], access_level: 'OPERATOR' },
    { user_id: userByUsername.warehouse01.id, warehouse_id: warehouseIds['WH-HN-01'], access_level: 'OPERATOR' },
    { user_id: userByUsername.cs01.id, warehouse_id: warehouseIds['BR-HCM-01'], access_level: 'OPERATOR' },
  ];

  for (const scope of warehouseScopes) {
    await prisma.userWarehouseScope.upsert({
      where: { user_id_warehouse_id: { user_id: scope.user_id, warehouse_id: scope.warehouse_id } },
      update: {},
      create: scope,
    });
  }

  console.log(`✅ Created ${warehouseScopes.length} user warehouse scopes`);

  // ═══════════════════════════════════════════════════════════════════════════════
  // STEP 7: AUDIT LOGS (Sample)
  // ═══════════════════════════════════════════════════════════════════════════════

  await prisma.authAuditLog.createMany({
    data: [
      {
        actor_user_id: users[0].id,
        action_name: 'USER_LOGIN',
        entity_type: 'USER',
        entity_id: users[0].id,
        ip_address: '192.168.1.100',
        user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        created_at: new Date('2024-03-01 08:00:00+07'),
      },
      {
        actor_user_id: users[0].id,
        action_name: 'CREATE_USER',
        entity_type: 'USER',
        entity_id: users[2].id,
        detail: { new_user: { username: 'staff01', email: 'staff01@smartbook.vn' } },
        ip_address: '192.168.1.100',
        user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        created_at: new Date('2024-03-01 08:15:00+07'),
      },
      {
        actor_user_id: users[1].id,
        action_name: 'USER_LOGIN',
        entity_type: 'USER',
        entity_id: users[1].id,
        ip_address: '192.168.1.101',
        user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605.1.15',
        created_at: new Date('2024-03-01 09:00:00+07'),
      },
      {
        actor_user_id: users[2].id,
        action_name: 'USER_LOGIN',
        entity_type: 'USER',
        entity_id: users[2].id,
        ip_address: '192.168.1.102',
        user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148',
        created_at: new Date('2024-03-01 10:00:00+07'),
      },
    ],
    skipDuplicates: true,
  });

  console.log('✅ Created audit logs');

  // ═══════════════════════════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════════

  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('🔐 SMARTBOOK AUTH SEED COMPLETED SUCCESSFULLY!');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`   • ${permissions.length} Permissions (organized by module)`);
  console.log(`   • System Roles:`);
  console.log(`     - ADMIN: Full access`);
  console.log(`     - MANAGER: Monitor & approve`);
  console.log(`     - STAFF / WAREHOUSE_STAFF: Warehouse workflows`);
  console.log(`     - LIBRARIAN / CUSTOMER_SERVICE: Circulation workflows`);
  console.log(`     - CUSTOMER: Customer portal self-service`);
  console.log(`     - SUPPLIER: Supplier portal`);
  console.log(`   • ${users.length} Users`);
  console.log(`     - hung (Admin)`);
  console.log(`     - manager01 (Manager)`);
  console.log(`     - staff01, staff02 (Staff)`);
  console.log(`     - staff03, warehouse01 (Warehouse Staff)`);
  console.log(`     - librarian01, cs01 (Librarian)`);
  console.log(`     - customer01 (Customer)`);
  console.log(`     - inactive01 (Inactive)`);
  console.log(`   • ${warehouseScopes.length} User Warehouse Scopes`);
  console.log(`   • Sample audit logs`);
  console.log('');
  console.log('🔑 Default Password for all users: 123456');
  console.log('═══════════════════════════════════════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
