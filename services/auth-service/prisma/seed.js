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
    { code: 'auth.sessions.manage', module_name: 'auth', action_name: 'write', description: 'Manage user sessions and tokens' },
    { code: 'auth.audit.read', module_name: 'auth', action_name: 'read', description: 'View authentication audit logs' },

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

    // AI module
    { code: 'ai.scan.receipt', module_name: 'ai', action_name: 'write', description: 'Scan and extract data from receipts' },
    { code: 'ai.ocr.process', module_name: 'ai', action_name: 'write', description: 'Process OCR requests' },
    { code: 'ai.recommendation.view', module_name: 'ai', action_name: 'read', description: 'View AI recommendations' },

    // Analytics module
    { code: 'analytics.reports.view', module_name: 'analytics', action_name: 'read', description: 'View analytics reports and dashboards' },
    { code: 'analytics.reports.export', module_name: 'analytics', action_name: 'read', description: 'Export analytics reports' },
    { code: 'analytics.forecast.view', module_name: 'analytics', action_name: 'read', description: 'View demand forecasts' },

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
      description: 'Can operate warehouse workflows, process borrow operations',
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

  console.log('✅ Created 5 roles');

  // ═══════════════════════════════════════════════════════════════════════════════
  // STEP 3: ASSIGN PERMISSIONS TO ROLES
  // ═══════════════════════════════════════════════════════════════════════════════

  const allPerms = await prisma.permission.findMany();
  const permMap = {};
  for (const p of allPerms) {
    permMap[p.code] = p;
  }

  // ADMIN: All permissions
  for (const perm of allPerms) {
    await prisma.rolePermission.upsert({
      where: { role_id_permission_id: { role_id: adminRole.id, permission_id: perm.id } },
      update: {},
      create: { role_id: adminRole.id, permission_id: perm.id },
    });
  }
  console.log('✅ Assigned all permissions to ADMIN');

  // MANAGER: Read all + approve + analytics + some write
  const managerPermCodes = [
    'inventory.catalog.read', 'inventory.stock.read', 'inventory.warehouse.read',
    'inventory.receiving.read', 'inventory.purchase.read', 'inventory.purchase.approve',
    'inventory.transfer.read',
    'borrow.customers.read', 'borrow.loans.read', 'borrow.fines.manage',
    'analytics.reports.view', 'analytics.reports.export', 'analytics.forecast.view',
    'observability.logs.read',
    'ai.recommendation.view',
    'platform.settings.read',
  ];
  for (const code of managerPermCodes) {
    if (permMap[code]) {
      await prisma.rolePermission.upsert({
        where: { role_id_permission_id: { role_id: managerRole.id, permission_id: permMap[code].id } },
        update: {},
        create: { role_id: managerRole.id, permission_id: permMap[code].id },
      });
    }
  }
  console.log(`✅ Assigned ${managerPermCodes.length} permissions to MANAGER`);

  // STAFF: Basic operations
  const staffPermCodes = [
    'inventory.catalog.read', 'inventory.stock.read', 'inventory.stock.write',
    'inventory.receiving.read', 'inventory.receiving.write', 'inventory.putaway.execute',
    'borrow.customers.read', 'borrow.loans.read', 'borrow.loans.write',
  ];
  for (const code of staffPermCodes) {
    if (permMap[code]) {
      await prisma.rolePermission.upsert({
        where: { role_id_permission_id: { role_id: staffRole.id, permission_id: permMap[code].id } },
        update: {},
        create: { role_id: staffRole.id, permission_id: permMap[code].id },
      });
    }
  }
  console.log(`✅ Assigned ${staffPermCodes.length} permissions to STAFF`);

  // WAREHOUSE_OPERATOR: Warehouse operations only
  const warehousePermCodes = [
    'inventory.stock.read', 'inventory.stock.write',
    'inventory.receiving.read', 'inventory.receiving.write', 'inventory.putaway.execute',
    'inventory.warehouse.read',
  ];
  for (const code of warehousePermCodes) {
    if (permMap[code]) {
      await prisma.rolePermission.upsert({
        where: { role_id_permission_id: { role_id: warehouseRole.id, permission_id: permMap[code].id } },
        update: {},
        create: { role_id: warehouseRole.id, permission_id: permMap[code].id },
      });
    }
  }
  console.log(`✅ Assigned ${warehousePermCodes.length} permissions to WAREHOUSE_OPERATOR`);

  // CUSTOMER_SERVICE: Customer-facing operations
  const customerServicePermCodes = [
    'borrow.customers.read', 'borrow.customers.write',
    'borrow.loans.read', 'borrow.loans.write',
    'borrow.fines.manage', 'borrow.payments.process',
    'inventory.catalog.read',
  ];
  for (const code of customerServicePermCodes) {
    if (permMap[code]) {
      await prisma.rolePermission.upsert({
        where: { role_id_permission_id: { role_id: customerServiceRole.id, permission_id: permMap[code].id } },
        update: {},
        create: { role_id: customerServiceRole.id, permission_id: permMap[code].id },
      });
    }
  }
  console.log(`✅ Assigned ${customerServicePermCodes.length} permissions to CUSTOMER_SERVICE`);

  // ═══════════════════════════════════════════════════════════════════════════════
  // STEP 4: USERS
  // ═══════════════════════════════════════════════════════════════════════════════

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
  ]);

  console.log(`✅ Created ${users.length} users`);

  // ═══════════════════════════════════════════════════════════════════════════════
  // STEP 5: ASSIGN ROLES TO USERS
  // ═══════════════════════════════════════════════════════════════════════════════

  await prisma.userRole.upsert({
    where: { user_id_role_id: { user_id: users[0].id, role_id: adminRole.id } },
    update: {},
    create: { user_id: users[0].id, role_id: adminRole.id },
  });

  await prisma.userRole.upsert({
    where: { user_id_role_id: { user_id: users[1].id, role_id: managerRole.id } },
    update: {},
    create: { user_id: users[1].id, role_id: managerRole.id },
  });

  await prisma.userRole.upsert({
    where: { user_id_role_id: { user_id: users[2].id, role_id: staffRole.id } },
    update: {},
    create: { user_id: users[2].id, role_id: staffRole.id },
  });

  await prisma.userRole.upsert({
    where: { user_id_role_id: { user_id: users[3].id, role_id: staffRole.id } },
    update: {},
    create: { user_id: users[3].id, role_id: staffRole.id },
  });

  await prisma.userRole.upsert({
    where: { user_id_role_id: { user_id: users[4].id, role_id: warehouseRole.id } },
    update: {},
    create: { user_id: users[4].id, role_id: warehouseRole.id },
  });

  await prisma.userRole.upsert({
    where: { user_id_role_id: { user_id: users[5].id, role_id: warehouseRole.id } },
    update: {},
    create: { user_id: users[5].id, role_id: warehouseRole.id },
  });

  await prisma.userRole.upsert({
    where: { user_id_role_id: { user_id: users[6].id, role_id: customerServiceRole.id } },
    update: {},
    create: { user_id: users[6].id, role_id: customerServiceRole.id },
  });

  console.log('✅ Assigned roles to all users');

  // ═══════════════════════════════════════════════════════════════════════════════
  // STEP 6: USER WAREHOUSE SCOPES
  // ═══════════════════════════════════════════════════════════════════════════════

  // Placeholder warehouse IDs - these should match actual warehouse IDs from inventory service
  const warehouseIds = {
    'WH-HCM-01': '00000000-0000-0000-0000-000000000002',
    'WH-HN-01': '00000000-0000-0000-0000-000000000003',
    'BR-HCM-01': '00000000-0000-0000-0000-000000000004',
  };

  const warehouseScopes = [
    { user_id: users[0].id, warehouse_id: warehouseIds['WH-HCM-01'], access_level: 'FULL' },
    { user_id: users[0].id, warehouse_id: warehouseIds['WH-HN-01'], access_level: 'FULL' },
    { user_id: users[0].id, warehouse_id: warehouseIds['BR-HCM-01'], access_level: 'FULL' },
    { user_id: users[1].id, warehouse_id: warehouseIds['WH-HCM-01'], access_level: 'READ' },
    { user_id: users[1].id, warehouse_id: warehouseIds['WH-HN-01'], access_level: 'READ' },
    { user_id: users[1].id, warehouse_id: warehouseIds['BR-HCM-01'], access_level: 'READ' },
    { user_id: users[2].id, warehouse_id: warehouseIds['WH-HCM-01'], access_level: 'OPERATOR' },
    { user_id: users[3].id, warehouse_id: warehouseIds['WH-HCM-01'], access_level: 'OPERATOR' },
    { user_id: users[4].id, warehouse_id: warehouseIds['WH-HCM-01'], access_level: 'OPERATOR' },
    { user_id: users[5].id, warehouse_id: warehouseIds['WH-HN-01'], access_level: 'OPERATOR' },
    { user_id: users[6].id, warehouse_id: warehouseIds['BR-HCM-01'], access_level: 'OPERATOR' },
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
  console.log(`   • 5 Roles:`);
  console.log(`     - ADMIN: Full access`);
  console.log(`     - MANAGER: Monitor & approve`);
  console.log(`     - STAFF: Basic operations`);
  console.log(`     - WAREHOUSE_OPERATOR: Warehouse workflows`);
  console.log(`     - CUSTOMER_SERVICE: Customer-facing`);
  console.log(`   • ${users.length} Users`);
  console.log(`     - hung (Admin)`);
  console.log(`     - manager01 (Manager)`);
  console.log(`     - staff01, staff02, staff03 (Staff)`);
  console.log(`     - warehouse01 (Warehouse Operator)`);
  console.log(`     - cs01 (Customer Service)`);
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
