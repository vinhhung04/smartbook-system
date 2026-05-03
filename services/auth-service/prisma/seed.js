const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Starting auth-service seed...');

  // Create permissions
  const permissions = [
    // Auth permissions
    { code: 'auth.users.read', module_name: 'auth', action_name: 'read', description: 'View user accounts' },
    { code: 'auth.users.write', module_name: 'auth', action_name: 'write', description: 'Create or update user accounts' },
    { code: 'auth.roles.read', module_name: 'auth', action_name: 'read', description: 'View roles and permissions' },
    { code: 'auth.roles.write', module_name: 'auth', action_name: 'write', description: 'Manage roles and permissions' },
    // Inventory permissions
    { code: 'inventory.catalog.read', module_name: 'inventory', action_name: 'read', description: 'View catalog and variants' },
    { code: 'inventory.catalog.write', module_name: 'inventory', action_name: 'write', description: 'Manage catalog and variants' },
    { code: 'inventory.stock.read', module_name: 'inventory', action_name: 'read', description: 'View stock balances and movements' },
    { code: 'inventory.stock.write', module_name: 'inventory', action_name: 'write', description: 'Post inventory movements' },
    { code: 'inventory.purchase.approve', module_name: 'inventory', action_name: 'approve', description: 'Approve purchase and transfer documents' },
    // Borrow permissions
    { code: 'borrow.read', module_name: 'borrow', action_name: 'read', description: 'View customers, reservations and loans' },
    { code: 'borrow.write', module_name: 'borrow', action_name: 'write', description: 'Create reservations, loans and returns' },
    { code: 'borrow.fines.manage', module_name: 'borrow', action_name: 'write', description: 'Issue and settle fines' },
    // AI permissions
    { code: 'ai.read', module_name: 'ai', action_name: 'read', description: 'View recognition jobs and results' },
    { code: 'ai.write', module_name: 'ai', action_name: 'write', description: 'Create and verify recognition jobs' },
    // Analytics permissions
    { code: 'analytics.read', module_name: 'analytics', action_name: 'read', description: 'View forecasts, KPI and recommendations' },
    // Chatbot permissions
    { code: 'chatbot.use', module_name: 'chatbot', action_name: 'execute', description: 'Use chatbot and save reports' },
    // Platform permissions
    { code: 'observability.read', module_name: 'platform', action_name: 'read', description: 'View logs and audit information' },
  ];

  for (const perm of permissions) {
    await prisma.permission.upsert({
      where: { code: perm.code },
      update: {},
      create: perm,
    });
  }
  console.log(`Created ${permissions.length} permissions`);

  // Create ADMIN role with all permissions
  const adminRole = await prisma.role.upsert({
    where: { code: 'ADMIN' },
    update: {},
    create: {
      code: 'ADMIN',
      name: 'Administrator',
      description: 'Full access to platform configuration and IAM',
      is_system: true,
    },
  });
  console.log('Created ADMIN role');

  // Assign all permissions to ADMIN
  const allPerms = await prisma.permission.findMany();
  for (const perm of allPerms) {
    await prisma.rolePermission.upsert({
      where: {
        role_id_permission_id: {
          role_id: adminRole.id,
          permission_id: perm.id,
        },
      },
      update: {},
      create: {
        role_id: adminRole.id,
        permission_id: perm.id,
      },
    });
  }
  console.log(`Assigned ${allPerms.length} permissions to ADMIN role`);

  // Create MANAGER role
  const managerRole = await prisma.role.upsert({
    where: { code: 'MANAGER' },
    update: {},
    create: {
      code: 'MANAGER',
      name: 'Manager',
      description: 'Can monitor operations, analytics and approvals',
      is_system: true,
    },
  });
  console.log('Created MANAGER role');

  // Assign subset of permissions to MANAGER
  const managerPerms = allPerms.filter(p => 
    ['inventory.catalog.read', 'inventory.stock.read', 'borrow.read', 'analytics.read', 'observability.read'].includes(p.code)
  );
  for (const perm of managerPerms) {
    await prisma.rolePermission.upsert({
      where: {
        role_id_permission_id: {
          role_id: managerRole.id,
          permission_id: perm.id,
        },
      },
      update: {},
      create: {
        role_id: managerRole.id,
        permission_id: perm.id,
      },
    });
  }
  console.log(`Assigned ${managerPerms.length} permissions to MANAGER role`);

  // Create STAFF role
  const staffRole = await prisma.role.upsert({
    where: { code: 'STAFF' },
    update: {},
    create: {
      code: 'STAFF',
      name: 'Staff',
      description: 'Can operate warehouse and borrow workflows',
      is_system: true,
    },
  });
  console.log('Created STAFF role');

  // Create admin user
  const passwordHash = await bcrypt.hash('123456', 10);
  
  const existingUser = await prisma.user.findUnique({
    where: { username: 'hung' },
  });

  if (!existingUser) {
    const adminUser = await prisma.user.create({
      data: {
        username: 'hung',
        email: 'hung@smartbook.vn',
        password_hash: passwordHash,
        full_name: 'Nguyen Van Hung',
        phone: '+84123456789',
        status: 'ACTIVE',
        is_superuser: true,
      },
    });
    console.log('Created admin user: hung');

    await prisma.userRole.create({
      data: {
        user_id: adminUser.id,
        role_id: adminRole.id,
      },
    });
    console.log('Assigned ADMIN role to hung');
  } else {
    console.log('Admin user already exists: hung');
    // Update is_superuser if needed
    if (!existingUser.is_superuser) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: { is_superuser: true },
      });
      console.log('Updated hung is_superuser to true');
    }
    // Ensure ADMIN role is assigned
    const existingRole = await prisma.userRole.findFirst({
      where: { user_id: existingUser.id, role_id: adminRole.id },
    });
    if (!existingRole) {
      await prisma.userRole.create({
        data: {
          user_id: existingUser.id,
          role_id: adminRole.id,
        },
      });
      console.log('Assigned ADMIN role to hung');
    }
  }

  // Create staff user
  const existingStaff = await prisma.user.findUnique({
    where: { username: 'staff01' },
  });

  if (!existingStaff) {
    const staffUser = await prisma.user.create({
      data: {
        username: 'staff01',
        email: 'staff01@smartbook.vn',
        password_hash: passwordHash,
        full_name: 'Tran Thi Nhuan',
        phone: '+84987654321',
        status: 'ACTIVE',
        is_superuser: false,
      },
    });
    console.log('Created staff user: staff01');

    await prisma.userRole.create({
      data: {
        user_id: staffUser.id,
        role_id: staffRole.id,
      },
    });
    console.log('Assigned STAFF role to staff01');
  }

  console.log('Auth-service seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
