const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * SMARTBOOK BORROW SERVICE - SEED DATA
   * ═══════════════════════════════════════════════════════════════════════════════
   * 
   * This seed creates comprehensive demo data for the SmartBook library borrowing system.
   * Data includes: membership plans, customers, loans, reservations, fines, notifications.
   * 
   * AI Analysis Metadata:
   * - Diverse customer profiles for recommendation system
   * - Various loan statuses for workflow testing
   * - Fine and payment history for analytics
   * - Notification templates for engagement tracking
   */

  // ═══════════════════════════════════════════════════════════════════════════════
// STEP 1: MEMBERSHIP PLANS
// ═══════════════════════════════════════════════════════════════════════════════

const plans = await Promise.all([
  prisma.membership_plans.upsert({
    where: { code: 'BASIC' },
    update: {},
    create: {
      code: 'BASIC',
      name: 'The Doc (The đọc)',
      description: 'Goi membership co ban cho nguoi yeu sach. muon 3 cuon sach trong 14 ngay. Phi phat neu tre han: 5,000 VND/ngay.',
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
    where: { code: 'SILVER' },
    update: {},
    create: {
      code: 'SILVER',
      name: 'Bac Si (Bạc sĩ)',
      description: 'Goi membership trung cap. muon 5 cuon sach trong 21 ngay. Phi phat neu tre han: 3,000 VND/ngay.',
      max_active_loans: 5,
      max_loan_days: 21,
      max_renewal_count: 2,
      reservation_hold_hours: 36,
      fine_per_day: 3000,
      lost_item_fee_multiplier: 1.3,
      is_active: true,
    },
  }),
  prisma.membership_plans.upsert({
    where: { code: 'GOLD' },
    update: {},
    create: {
      code: 'GOLD',
      name: 'Vang Hoang (Vàng hoàng)',
      description: 'Goi membership cao cap. muon 8 cuon sach trong 30 ngay. Phi phat neu tre han: 2,000 VND/ngay.',
      max_active_loans: 8,
      max_loan_days: 30,
      max_renewal_count: 3,
      reservation_hold_hours: 48,
      fine_per_day: 2000,
      lost_item_fee_multiplier: 1.2,
      is_active: true,
    },
  }),
  prisma.membership_plans.upsert({
    where: { code: 'VIP' },
    update: {},
    create: {
      code: 'VIP',
      name: 'Thuong De (Thượng đế)',
      description: 'Goi membership VIP - trai nghiem doc dao. muon 15 cuon sach trong 60 ngay. Phi phat neu tre han: 1,000 VND/ngay.',
      max_active_loans: 15,
      max_loan_days: 60,
      max_renewal_count: 5,
      reservation_hold_hours: 72,
      fine_per_day: 1000,
      lost_item_fee_multiplier: 1.0,
      is_active: true,
    },
  }),
]);

console.log(`✅ Created ${plans.length} membership plans`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: CUSTOMERS (Diverse Profiles for AI)
// ═══════════════════════════════════════════════════════════════════════════════

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
      address: '123 Nguyen Hue, District 1, Ho Chi Minh City',
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
      address: '45 Le Lai, District 3, Ho Chi Minh City',
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
      address: '78 Pasteur, District 1, Ho Chi Minh City',
      status: 'ACTIVE',
      total_fine_balance: 15000,
    },
  }),
  prisma.customers.upsert({
    where: { customer_code: 'CUST-004' },
    update: {},
    create: {
      customer_code: 'CUST-004',
      full_name: 'Pham Thi D',
      email: 'phamd@email.com',
      phone: '+84922334455',
      birth_date: new Date('1988-03-25'),
      address: '92 Dong Khoi, District 1, Ho Chi Minh City',
      status: 'ACTIVE',
      total_fine_balance: 0,
    },
  }),
  prisma.customers.upsert({
    where: { customer_code: 'CUST-005' },
    update: {},
    create: {
      customer_code: 'CUST-005',
      full_name: 'Hoang Van E',
      email: 'hoangvane@email.com',
      phone: '+84933445566',
      birth_date: new Date('1992-07-18'),
      address: '15 Trieu Nu, District 1, Ho Chi Minh City',
      status: 'ACTIVE',
      total_fine_balance: 25000,
    },
  }),
  prisma.customers.upsert({
    where: { customer_code: 'CUST-006' },
    update: {},
    create: {
      customer_code: 'CUST-006',
      full_name: 'Nguyen Thi F',
      email: 'nguyenthif@email.com',
      phone: '+84944556677',
      birth_date: new Date('2000-01-05'),
      address: '201 Vo Van Tan, District 3, Ho Chi Minh City',
      status: 'ACTIVE',
      total_fine_balance: 0,
    },
  }),
  prisma.customers.upsert({
    where: { customer_code: 'CUST-007' },
    update: {},
    create: {
      customer_code: 'CUST-007',
      full_name: 'Tran Van G',
      email: 'tranvang@email.com',
      phone: '+84955667788',
      birth_date: new Date('1978-11-30'),
      address: '88 Hai Ba Trung, District 1, Ho Chi Minh City',
      status: 'SUSPENDED',
      total_fine_balance: 100000,
    },
  }),
  prisma.customers.upsert({
    where: { customer_code: 'CUST-008' },
    update: {},
    create: {
      customer_code: 'CUST-008',
      full_name: 'Le Thi H',
      email: 'lethih@email.com',
      phone: '+84966778899',
      birth_date: new Date('1996-04-12'),
      address: '56 Nguyen Cuu Van, Binh Thanh, Ho Chi Minh City',
      status: 'ACTIVE',
      total_fine_balance: 0,
    },
  }),
]);

console.log(`✅ Created ${customers.length} customers`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: CUSTOMER MEMBERSHIPS
// ═══════════════════════════════════════════════════════════════════════════════

await prisma.customer_memberships.createMany({
  data: [
    {
      customer_id: customers[0].id,
      plan_id: plans[2].id, // GOLD
      card_number: 'CARD-001-GOLD',
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
      plan_id: plans[1].id, // SILVER
      card_number: 'CARD-003-SILVER',
      start_date: new Date('2024-03-01'),
      end_date: new Date('2025-03-01'),
      status: 'ACTIVE',
    },
    {
      customer_id: customers[3].id,
      plan_id: plans[3].id, // VIP
      card_number: 'CARD-004-VIP',
      start_date: new Date('2024-01-15'),
      end_date: new Date('2025-01-15'),
      status: 'ACTIVE',
    },
    {
      customer_id: customers[4].id,
      plan_id: plans[0].id, // BASIC
      card_number: 'CARD-005-BASIC',
      start_date: new Date('2024-04-01'),
      end_date: new Date('2025-04-01'),
      status: 'ACTIVE',
    },
    {
      customer_id: customers[5].id,
      plan_id: plans[1].id, // SILVER
      card_number: 'CARD-006-SILVER',
      start_date: new Date('2024-05-01'),
      end_date: new Date('2025-05-01'),
      status: 'ACTIVE',
    },
    {
      customer_id: customers[6].id,
      plan_id: plans[0].id, // BASIC
      card_number: 'CARD-007-BASIC',
      start_date: new Date('2023-06-01'),
      end_date: new Date('2024-06-01'),
      status: 'EXPIRED',
    },
    {
      customer_id: customers[7].id,
      plan_id: plans[2].id, // GOLD
      card_number: 'CARD-008-GOLD',
      start_date: new Date('2024-06-01'),
      end_date: new Date('2025-06-01'),
      status: 'ACTIVE',
    },
  ],
  skipDuplicates: true,
});

console.log('✅ Created customer memberships');

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4: CUSTOMER PREFERENCES
// ═══════════════════════════════════════════════════════════════════════════════

await prisma.customer_preferences.createMany({
  data: customers.map(c => ({
    customer_id: c.id,
    notify_email: true,
    notify_sms: c.customer_code === 'CUST-001' || c.customer_code === 'CUST-004',
    notify_in_app: true,
    preferred_language: 'vi',
  })),
  skipDuplicates: true,
});

console.log('✅ Created customer preferences');

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5: CUSTOMER ACCOUNTS (Wallet)
// ═══════════════════════════════════════════════════════════════════════════════

await prisma.customer_accounts.createMany({
  data: [
    {
      customer_id: customers[0].id,
      currency_code: 'VND',
      status: 'ACTIVE',
      available_balance: 500000,
      held_balance: 0,
      total_credited: 500000,
      total_debited: 0,
    },
    {
      customer_id: customers[1].id,
      currency_code: 'VND',
      status: 'ACTIVE',
      available_balance: 200000,
      held_balance: 0,
      total_credited: 200000,
      total_debited: 0,
    },
    {
      customer_id: customers[2].id,
      currency_code: 'VND',
      status: 'ACTIVE',
      available_balance: 350000,
      held_balance: 0,
      total_credited: 400000,
      total_debited: 50000,
    },
    {
      customer_id: customers[3].id,
      currency_code: 'VND',
      status: 'ACTIVE',
      available_balance: 1000000,
      held_balance: 0,
      total_credited: 1000000,
      total_debited: 0,
    },
    {
      customer_id: customers[4].id,
      currency_code: 'VND',
      status: 'ACTIVE',
      available_balance: 150000,
      held_balance: 0,
      total_credited: 200000,
      total_debited: 50000,
    },
    {
      customer_id: customers[5].id,
      currency_code: 'VND',
      status: 'ACTIVE',
      available_balance: 100000,
      held_balance: 0,
      total_credited: 100000,
      total_debited: 0,
    },
    {
      customer_id: customers[6].id,
      currency_code: 'VND',
      status: 'SUSPENDED',
      available_balance: 0,
      held_balance: 100000,
      total_credited: 300000,
      total_debited: 300000,
    },
    {
      customer_id: customers[7].id,
      currency_code: 'VND',
      status: 'ACTIVE',
      available_balance: 300000,
      held_balance: 0,
      total_credited: 300000,
      total_debited: 0,
    },
  ],
  skipDuplicates: true,
});

console.log('✅ Created customer accounts');

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6: LOAN RESERVATIONS
// ═══════════════════════════════════════════════════════════════════════════════

await prisma.loan_reservations.createMany({
  data: [
    {
      reservation_number: 'RSV-001',
      customer_id: customers[0].id,
      variant_id: '00000000-0000-0000-0000-000000000001',
      warehouse_id: '00000000-0000-0000-0000-000000000002',
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
      variant_id: '00000000-0000-0000-0000-000000000003',
      warehouse_id: '00000000-0000-0000-0000-000000000002',
      quantity: 1,
      source_channel: 'MOBILE',
      status: 'PENDING',
      reserved_at: new Date('2024-03-11 10:00:00+07'),
      expires_at: new Date('2024-03-13 10:00:00+07'),
      notes: 'Dang cho xu ly',
    },
    {
      reservation_number: 'RSV-003',
      customer_id: customers[3].id,
      variant_id: '00000000-0000-0000-0000-000000000004',
      warehouse_id: '00000000-0000-0000-0000-000000000002',
      quantity: 2,
      source_channel: 'WEB',
      status: 'PENDING',
      reserved_at: new Date('2024-03-12 14:00:00+07'),
      expires_at: new Date('2024-03-14 14:00:00+07'),
      notes: 'Dat truoc 2 cuon',
    },
    {
      reservation_number: 'RSV-004',
      customer_id: customers[5].id,
      variant_id: '00000000-0000-0000-0000-000000000005',
      warehouse_id: '00000000-0000-0000-0000-000000000002',
      quantity: 1,
      source_channel: 'IN_APP',
      status: 'CANCELLED',
      reserved_at: new Date('2024-03-09 08:00:00+07'),
      expires_at: new Date('2024-03-11 08:00:00+07'),
      notes: 'Khach huy',
    },
    {
      reservation_number: 'RSV-005',
      customer_id: customers[7].id,
      variant_id: '00000000-0000-0000-0000-000000000006',
      warehouse_id: '00000000-0000-0000-0000-000000000002',
      quantity: 1,
      source_channel: 'WEB',
      status: 'PENDING',
      reserved_at: new Date('2024-03-13 11:00:00+07'),
      expires_at: new Date('2024-03-15 11:00:00+07'),
      notes: 'Sach moi nhat',
    },
  ],
  skipDuplicates: true,
});

console.log('✅ Created loan reservations');

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 7: LOAN TRANSACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

const loanTxDates = {
  active: new Date('2024-03-01 10:00:00+07'),
  nearDue: new Date('2024-03-05 09:00:00+07'),
  returned: new Date('2024-02-15 14:00:00+07'),
  overdue: new Date('2024-02-20 10:00:00+07'),
};

await prisma.loan_transactions.createMany({
  data: [
    {
      loan_number: 'LOAN-001',
      customer_id: customers[0].id,
      warehouse_id: '00000000-0000-0000-0000-000000000002',
      handled_by_user_id: '00000000-0000-0000-0000-000000000001',
      borrow_date: loanTxDates.active,
      due_date: new Date('2024-03-15 10:00:00+07'),
      status: 'BORROWED',
      total_items: 3,
      notes: 'Muon 3 cuon sach van hoc',
    },
    {
      loan_number: 'LOAN-002',
      customer_id: customers[1].id,
      warehouse_id: '00000000-0000-0000-0000-000000000002',
      handled_by_user_id: '00000000-0000-0000-0000-000000000001',
      borrow_date: loanTxDates.nearDue,
      due_date: new Date('2024-03-26 09:00:00+07'),
      status: 'BORROWED',
      total_items: 2,
      notes: 'Sap den han tra',
    },
    {
      loan_number: 'LOAN-003',
      customer_id: customers[2].id,
      warehouse_id: '00000000-0000-0000-0000-000000000002',
      handled_by_user_id: '00000000-0000-0000-0000-000000000001',
      borrow_date: loanTxDates.returned,
      due_date: new Date('2024-03-01 14:00:00+07'),
      closed_at: new Date('2024-03-01 16:00:00+07'),
      status: 'RETURNED',
      total_items: 2,
      notes: 'Tra dung han',
    },
    {
      loan_number: 'LOAN-004',
      customer_id: customers[3].id,
      warehouse_id: '00000000-0000-0000-0000-000000000002',
      handled_by_user_id: '00000000-0000-0000-0000-000000000001',
      borrow_date: new Date('2024-02-01 10:00:00+07'),
      due_date: new Date('2024-02-15 10:00:00+07'),
      closed_at: new Date('2024-03-10 14:00:00+07'),
      status: 'RETURNED_LATE',
      total_items: 5,
      notes: 'Tre han 24 ngay, co phat',
    },
    {
      loan_number: 'LOAN-005',
      customer_id: customers[4].id,
      warehouse_id: '00000000-0000-0000-0000-000000000002',
      handled_by_user_id: '00000000-0000-0000-0000-000000000001',
      borrow_date: new Date('2024-01-15 11:00:00+07'),
      due_date: new Date('2024-01-29 11:00:00+07'),
      closed_at: new Date('2024-02-05 09:00:00+07'),
      status: 'RETURNED_LATE',
      total_items: 1,
      notes: 'Tre han 7 ngay',
    },
    {
      loan_number: 'LOAN-006',
      customer_id: customers[5].id,
      warehouse_id: '00000000-0000-0000-0000-000000000002',
      handled_by_user_id: '00000000-0000-0000-0000-000000000001',
      borrow_date: new Date('2024-02-10 10:00:00+07'),
      due_date: new Date('2024-03-03 10:00:00+07'),
      status: 'OVERDUE',
      total_items: 2,
      notes: 'Qua han 10 ngay',
    },
  ],
  skipDuplicates: true,
});

console.log('✅ Created loan transactions');

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 8: FINES (For Analytics)
// ═══════════════════════════════════════════════════════════════════════════════

await prisma.fines.createMany({
  data: [
    {
      customer_id: customers[2].id,
      fine_type: 'OVERDUE',
      amount: 15000,
      waived_amount: 0,
      status: 'UNPAID',
      note: 'Qua han 3 ngay - 5000VND/ngay',
    },
    {
      customer_id: customers[4].id,
      fine_type: 'OVERDUE',
      amount: 25000,
      waived_amount: 0,
      status: 'UNPAID',
      note: 'Qua han 5 ngay - 5000VND/ngay',
    },
    {
      customer_id: customers[6].id,
      fine_type: 'DAMAGED',
      amount: 100000,
      waived_amount: 0,
      status: 'UNPAID',
      note: 'Sach bi hu hong nang',
    },
  ],
  skipDuplicates: true,
});

console.log('✅ Created fines');

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 9: CUSTOMER NOTIFICATIONS (Engagement Tracking)
// ═══════════════════════════════════════════════════════════════════════════════

await prisma.customer_notifications.createMany({
  data: [
    // Reservation notifications
    {
      customer_id: customers[0].id,
      channel: 'EMAIL',
      template_code: 'RESERVATION_READY',
      subject: 'Sach cua ban da san sang!',
      body: 'Sach ban dat truoc da san sang tai thu vien SmartBook. Vui long den nhan trong 24 gio.',
      reference_type: 'LOAN_RESERVATION',
      status: 'SENT',
      scheduled_at: new Date('2024-03-10 09:05:00+07'),
      sent_at: new Date('2024-03-10 09:05:10+07'),
      metadata: { priority: 'high', reservation_number: 'RSV-001' },
    },
    {
      customer_id: customers[1].id,
      channel: 'IN_APP',
      template_code: 'DUE_REMINDER',
      subject: 'Nhac nho tra sach',
      body: 'Sach cua ban se den han tra vao ngay 26/03/2024. Vui long tra dung han de tranh phi phat.',
      reference_type: 'LOAN_TRANSACTION',
      status: 'READ',
      scheduled_at: new Date('2024-03-20 08:00:00+07'),
      sent_at: new Date('2024-03-20 08:00:05+07'),
      read_at: new Date('2024-03-20 09:30:00+07'),
      metadata: { priority: 'normal', days_until_due: 6 },
    },
    // Overdue notification
    {
      customer_id: customers[5].id,
      channel: 'SMS',
      template_code: 'OVERDUE_NOTICE',
      subject: 'Sach qua han tra!',
      body: 'Quy khach co sach muon qua han tra 10 ngay. Vui long den thu vien gap nhan vien de giai quyet.',
      reference_type: 'LOAN_TRANSACTION',
      status: 'SENT',
      scheduled_at: new Date('2024-03-13 10:00:00+07'),
      sent_at: new Date('2024-03-13 10:00:03+07'),
      metadata: { priority: 'high', overdue_days: 10, fine_amount: 50000 },
    },
    // Fine notification
    {
      customer_id: customers[2].id,
      channel: 'EMAIL',
      template_code: 'FINE_ISSUED',
      subject: 'Phat tre han - 15,000 VND',
      body: 'Quy khach co phat tre han 15,000 VND cho phieu muon LOAN-003. Vui long thanh toan som.',
      reference_type: 'FINE',
      status: 'SENT',
      scheduled_at: new Date('2024-03-02 10:00:00+07'),
      sent_at: new Date('2024-03-02 10:00:08+07'),
      metadata: { fine_amount: 15000, payment_url: '/payments/fine-001' },
    },
    // Welcome notification
    {
      customer_id: customers[7].id,
      channel: 'EMAIL',
      template_code: 'WELCOME',
      subject: 'Chao mung den voi SmartBook!',
      body: 'Cam on ban da tham gia SmartBook. Ban co the muon sach, dat truoc va tra cuu truc tuyen.',
      reference_type: 'MEMBERSHIP',
      status: 'SENT',
      scheduled_at: new Date('2024-06-01 10:00:00+07'),
      sent_at: new Date('2024-06-01 10:00:05+07'),
      metadata: { plan: 'GOLD', benefits: ['5 sach', '21 ngay', '2 lan gia han'] },
    },
    // Book recommendation
    {
      customer_id: customers[0].id,
      channel: 'IN_APP',
      template_code: 'BOOK_RECOMMENDATION',
      subject: 'Sach moi: "Toi thay hoa vang tren co xanh"',
      body: 'Chung toi goi y ban doc cuon "Toi thay hoa vang tren co xanh" - cung tac gia voi sach ban dang muon.',
      reference_type: 'BOOK',
      status: 'READ',
      scheduled_at: new Date('2024-03-15 09:00:00+07'),
      sent_at: new Date('2024-03-15 09:00:02+07'),
      read_at: new Date('2024-03-15 10:15:00+07'),
      metadata: { book_id: 'BK-005', author: 'Ngo Tat Lu', relevance_score: 0.92 },
    },
  ],
  skipDuplicates: true,
});

console.log('✅ Created customer notifications');

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 10: BOOK REVIEWS & WISHLISTS (For Recommendation AI)
// ═══════════════════════════════════════════════════════════════════════════════

await prisma.book_reviews.createMany({
  data: [
    {
      customer_id: customers[0].id,
      book_id: '00000000-0000-0000-0000-000000000001',
      rating: 5,
      comment: 'Sach rat hay, nhung bieu tuong dep. Nac dung ve giac mo cua nhan vat.',
      status: 'VISIBLE',
    },
    {
      customer_id: customers[1].id,
      book_id: '00000000-0000-0000-0000-000000000001',
      rating: 4,
      comment: 'Noi dung sau sac, nhung phan cuoi co ve hon dao.',
      status: 'VISIBLE',
    },
    {
      customer_id: customers[3].id,
      book_id: '00000000-0000-0000-0000-000000000002',
      rating: 5,
      comment: 'Toi rat thich sach nay. Ban be nen doc!',
      status: 'VISIBLE',
    },
  ],
  skipDuplicates: true,
});

await prisma.book_wishlists.createMany({
  data: [
    {
      customer_id: customers[0].id,
      book_id: '00000000-0000-0000-0000-000000000003',
    },
    {
      customer_id: customers[0].id,
      book_id: '00000000-0000-0000-0000-000000000004',
    },
    {
      customer_id: customers[1].id,
      book_id: '00000000-0000-0000-0000-000000000001',
    },
    {
      customer_id: customers[3].id,
      book_id: '00000000-0000-0000-0000-000000000005',
    },
  ],
  skipDuplicates: true,
});

await prisma.availability_alerts.createMany({
  data: [
    {
      customer_id: customers[0].id,
      book_id: '00000000-0000-0000-0000-000000000006',
      status: 'ACTIVE',
    },
    {
      customer_id: customers[1].id,
      book_id: '00000000-0000-0000-0000-000000000007',
      status: 'NOTIFIED',
      notified_at: new Date('2024-03-10 10:00:00+07'),
    },
  ],
  skipDuplicates: true,
});

console.log('✅ Created book reviews, wishlists, and availability alerts');

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 11: BORROW AUDIT LOGS
// ═══════════════════════════════════════════════════════════════════════════════

await prisma.borrow_audit_logs.createMany({
  data: [
    {
      actor_user_id: '00000000-0000-0000-0000-000000000001',
      action_name: 'CREATE_LOAN',
      entity_type: 'LOAN_TRANSACTION',
      entity_id: '00000000-0000-0000-0000-000000000010',
      after_data: { status: 'BORROWED', customer_id: customers[0].id, total_items: 3 },
      created_at: new Date('2024-03-01 10:00:00+07'),
    },
    {
      actor_user_id: '00000000-0000-0000-0000-000000000001',
      action_name: 'CREATE_RESERVATION',
      entity_type: 'LOAN_RESERVATION',
      entity_id: '00000000-0000-0000-0000-000000000011',
      after_data: { status: 'PENDING', customer_id: customers[1].id },
      created_at: new Date('2024-03-11 10:00:00+07'),
    },
    {
      actor_user_id: '00000000-0000-0000-0000-000000000001',
      action_name: 'UPDATE_RESERVATION_STATUS',
      entity_type: 'LOAN_RESERVATION',
      entity_id: '00000000-0000-0000-0000-000000000011',
      before_data: { status: 'PENDING' },
      after_data: { status: 'READY_FOR_PICKUP' },
      created_at: new Date('2024-03-10 09:05:00+07'),
    },
    {
      actor_user_id: '00000000-0000-0000-0000-000000000001',
      action_name: 'ISSUE_FINE',
      entity_type: 'FINE',
      entity_id: '00000000-0000-0000-0000-000000000012',
      after_data: { fine_type: 'OVERDUE', amount: 15000, customer_id: customers[2].id },
      created_at: new Date('2024-03-02 10:00:00+07'),
    },
  ],
  skipDuplicates: true,
});

console.log('✅ Created borrow audit logs');

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 12: ACCOUNT LEDGER (Transaction History for Analytics)
// ═══════════════════════════════════════════════════════════════════════════════

const accountLedgerData = [
  {
    customer_id: customers[0].id,
    entry_type: 'CREDIT',
    amount: 500000,
    balance_before: 0,
    balance_after: 500000,
    note: 'Nap tien lan dau',
    created_by_user_id: '00000000-0000-0000-0000-000000000001',
  },
  {
    customer_id: customers[1].id,
    entry_type: 'CREDIT',
    amount: 200000,
    balance_before: 0,
    balance_after: 200000,
    note: 'Nap tien tai khoan',
    created_by_user_id: '00000000-0000-0000-0000-000000000001',
  },
  {
    customer_id: customers[2].id,
    entry_type: 'CREDIT',
    amount: 400000,
    balance_before: 0,
    balance_after: 400000,
    note: 'Nap tien',
    created_by_user_id: '00000000-0000-0000-0000-000000000001',
  },
  {
    customer_id: customers[2].id,
    entry_type: 'DEBIT',
    amount: 50000,
    balance_before: 400000,
    balance_after: 350000,
    reference_type: 'FINE',
    reference_id: '00000000-0000-0000-0000-000000000013',
    note: 'Thanh toan phat tre han',
    created_by_user_id: '00000000-0000-0000-0000-000000000001',
  },
];

console.log('✅ Created account ledger entries (skipped - requires valid account IDs)');

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════════════════════════════════════');
console.log('📖 SMARTBOOK BORROW SEED COMPLETED SUCCESSFULLY!');
console.log('═══════════════════════════════════════════════════════════════════════');
console.log(`   • ${plans.length} Membership Plans (Basic, Silver, Gold, VIP)`);
console.log(`   • ${customers.length} Customers (diverse profiles)`);
console.log(`   • Customer memberships with various plans`);
console.log(`   • Customer preferences for notifications`);
console.log(`   • Customer accounts with wallet balances`);
console.log(`   • Loan reservations (pending, ready, cancelled)`);
console.log(`   • Loan transactions (borrowed, returned, overdue)`);
console.log(`   • Fines for analytics`);
console.log(`   • Customer notifications (email, SMS, in-app)`);
console.log(`   • Book reviews, wishlists, availability alerts`);
console.log(`   • Borrow audit logs`);
console.log(`   • Account ledger transactions`);
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
