const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('Starting borrow-service seed...');

  // Create membership plans
  const plans = await Promise.all([
    prisma.membership_plans.upsert({
      where: { code: 'BASIC' },
      update: {},
      create: {
        code: 'BASIC',
        name: 'Basic Member',
        description: 'Membership co ban, muon 3 cuon sach trong 14 ngay',
        max_active_loans: 3,
        max_loan_days: 14,
        max_renewal_count: 1,
        reservation_hold_hours: 24,
        fine_per_day: 5000,
        lost_item_fee_multiplier: 1.5,
        is_active: true,
      },
    }),
    prisma.membership_plans.upsert({
      where: { code: 'PREMIUM' },
      update: {},
      create: {
        code: 'PREMIUM',
        name: 'Premium Member',
        description: 'Membership cao cap, muon 5 cuon sach trong 30 ngay',
        max_active_loans: 5,
        max_loan_days: 30,
        max_renewal_count: 3,
        reservation_hold_hours: 48,
        fine_per_day: 3000,
        lost_item_fee_multiplier: 1.2,
        is_active: true,
      },
    }),
    prisma.membership_plans.upsert({
      where: { code: 'VIP' },
      update: {},
      create: {
        code: 'VIP',
        name: 'VIP Member',
        description: 'Membership VIP, muon 10 cuon sach trong 60 ngay',
        max_active_loans: 10,
        max_loan_days: 60,
        max_renewal_count: 5,
        reservation_hold_hours: 72,
        fine_per_day: 2000,
        lost_item_fee_multiplier: 1.0,
        is_active: true,
      },
    }),
  ]);
  console.log(`Created ${plans.length} membership plans`);

  // Create customers
  const customers = await Promise.all([
    prisma.customers.upsert({
      where: { customer_code: 'CUST-001' },
      update: {},
      create: {
        customer_code: 'CUST-001',
        full_name: 'Nguyen Van A',
        email: 'nguyenvana@email.com',
        phone: '+84901234567',
        birth_date: new Date('1990-05-15'),
        address: '123 Nguyen Hue, District 1, HCMC',
        status: 'ACTIVE',
        total_fine_balance: 0,
      },
    }),
    prisma.customers.upsert({
      where: { customer_code: 'CUST-002' },
      update: {},
      create: {
        customer_code: 'CUST-002',
        full_name: 'Tran Thi B',
        email: 'tranthib@email.com',
        phone: '+84987654321',
        birth_date: new Date('1985-08-20'),
        address: '45 Le Lai, District 3, HCMC',
        status: 'ACTIVE',
        total_fine_balance: 0,
      },
    }),
    prisma.customers.upsert({
      where: { customer_code: 'CUST-003' },
      update: {},
      create: {
        customer_code: 'CUST-003',
        full_name: 'Le Van C',
        email: 'levanc@email.com',
        phone: '+84911223344',
        birth_date: new Date('1995-12-10'),
        address: '78 Pasteur, District 1, HCMC',
        status: 'ACTIVE',
        total_fine_balance: 15000,
      },
    }),
  ]);
  console.log(`Created ${customers.length} customers`);

  // Create customer memberships
  await prisma.customer_memberships.createMany({
    data: [
      {
        customer_id: customers[0].id,
        plan_id: plans[1].id, // PREMIUM
        card_number: 'CARD-001-BASIC',
        start_date: new Date('2024-01-01'),
        end_date: new Date('2025-01-01'),
        status: 'ACTIVE',
      },
      {
        customer_id: customers[1].id,
        plan_id: plans[0].id, // BASIC
        card_number: 'CARD-002-BASIC',
        start_date: new Date('2024-02-15'),
        end_date: new Date('2025-02-15'),
        status: 'ACTIVE',
      },
      {
        customer_id: customers[2].id,
        plan_id: plans[0].id, // BASIC
        card_number: 'CARD-003-BASIC',
        start_date: new Date('2024-03-01'),
        end_date: new Date('2025-03-01'),
        status: 'ACTIVE',
      },
    ],
    skipDuplicates: true,
  });
  console.log('Created customer memberships');

  // Create customer preferences
  await prisma.customer_preferences.createMany({
    data: customers.map(c => ({
      customer_id: c.id,
      notify_email: true,
      notify_sms: false,
      notify_in_app: true,
      preferred_language: 'vi',
    })),
    skipDuplicates: true,
  });
  console.log('Created customer preferences');

  // Create customer accounts
  await prisma.customer_accounts.createMany({
    data: customers.map(c => ({
      customer_id: c.id,
      currency_code: 'VND',
      status: 'ACTIVE',
      available_balance: 100000,
      held_balance: 0,
      total_credited: 100000,
      total_debited: 0,
    })),
    skipDuplicates: true,
  });
  console.log('Created customer accounts');

  // Create loan reservations (pending)
  await prisma.loan_reservations.createMany({
    data: [
      {
        reservation_number: 'RSV-001',
        customer_id: customers[0].id,
        variant_id: '00000000-0000-0000-0000-000000000001', // Placeholder - will link to real variant
        warehouse_id: '00000000-0000-0000-0000-000000000002', // Placeholder - will link to real warehouse
        quantity: 1,
        source_channel: 'WEB',
        status: 'READY_FOR_PICKUP',
        reserved_at: new Date('2024-03-10 09:00:00+07'),
        expires_at: new Date('2024-03-12 09:00:00+07'),
        notes: 'Sach da san sang tai kho',
      },
      {
        reservation_number: 'RSV-002',
        customer_id: customers[1].id,
        variant_id: '00000000-0000-0000-0000-000000000003', // Placeholder
        warehouse_id: '00000000-0000-0000-0000-000000000002', // Placeholder
        quantity: 1,
        source_channel: 'MOBILE',
        status: 'PENDING',
        reserved_at: new Date('2024-03-11 10:00:00+07'),
        expires_at: new Date('2024-03-13 10:00:00+07'),
        notes: 'Dang cho xu ly',
      },
    ],
    skipDuplicates: true,
  });
  console.log('Created loan reservations');

  // Create sample fine
  await prisma.fines.createMany({
    data: [
      {
        customer_id: customers[2].id,
        fine_type: 'OVERDUE',
        amount: 15000,
        waived_amount: 0,
        status: 'PARTIALLY_PAID',
        note: 'Qua han 3 ngay - 5000VND/ngay',
      },
    ],
    skipDuplicates: true,
  });
  console.log('Created sample fine');

  // Create customer notifications
  await prisma.customer_notifications.createMany({
    data: [
      {
        customer_id: customers[0].id,
        channel: 'EMAIL',
        template_code: 'RESERVATION_READY',
        subject: 'Sach cua ban da san sang',
        body: 'Sach ban dat truoc da san sang tai thu vien. Vui long den nhan trong 24 gio.',
        reference_type: 'LOAN_RESERVATION',
        status: 'SENT',
        scheduled_at: new Date('2024-03-10 09:05:00+07'),
        sent_at: new Date('2024-03-10 09:05:10+07'),
        metadata: { priority: 'high' },
      },
      {
        customer_id: customers[1].id,
        channel: 'IN_APP',
        template_code: 'DUE_REMINDER',
        subject: 'Nhac nho tra sach',
        body: 'Sach cua ban se den han tra vao ngay mai. Vui long tra dung han.',
        reference_type: 'LOAN_TRANSACTION',
        status: 'READ',
        scheduled_at: new Date('2024-03-15 08:00:00+07'),
        sent_at: new Date('2024-03-15 08:00:05+07'),
        read_at: new Date('2024-03-15 09:30:00+07'),
        metadata: { priority: 'normal' },
      },
    ],
    skipDuplicates: true,
  });
  console.log('Created customer notifications');

  // Create borrow audit logs
  await prisma.borrow_audit_logs.createMany({
    data: [
      {
        actor_user_id: '00000000-0000-0000-0000-000000000103', // Placeholder user
        action_name: 'CREATE_RESERVATION',
        entity_type: 'LOAN_RESERVATION',
        entity_id: '00000000-0000-0000-0000-000000000001',
        after_data: { status: 'PENDING', customer_id: customers[0].id },
        created_at: new Date('2024-03-10 09:00:00+07'),
      },
      {
        actor_user_id: '00000000-0000-0000-0000-000000000103',
        action_name: 'UPDATE_RESERVATION_STATUS',
        entity_type: 'LOAN_RESERVATION',
        entity_id: '00000000-0000-0000-0000-000000000001',
        before_data: { status: 'PENDING' },
        after_data: { status: 'READY_FOR_PICKUP' },
        created_at: new Date('2024-03-10 09:05:00+07'),
      },
    ],
    skipDuplicates: true,
  });
  console.log('Created borrow audit logs');

  console.log('Borrow-service seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
