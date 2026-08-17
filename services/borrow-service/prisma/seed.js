const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * SMARTBOOK BORROW SERVICE - SEED DATA
   * ═══════════════════════════════════════════════════════════════════════════════
   * 
   * This seed creates comprehensive demo data for the SmartBook library borrowing system.
   * Data includes: membership plans, customers, loans, reservations, loan items, renewals,
   * fines, fine payments, notifications, reviews, wishlists.
   * 
   * AI Analysis Metadata:
   * - Diverse customer profiles for recommendation system
   * - Various loan statuses for workflow testing
   * - Loan items and renewals for borrow history
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
// STEP 7.5: LOAN ITEMS (Books in each loan)
// ═══════════════════════════════════════════════════════════════════════════════

const warehouseId = '00000000-0000-0000-0000-000000000002';
const userId = '00000000-0000-0000-0000-000000000001';

const loanItemsData = [
  // LOAN-001: 3 items (BORROWED)
  {
    loan_id: null, // Will be updated after loans are created
    variant_id: '00000000-0000-0000-0000-000000000001',
    item_barcode: 'LI-L001-001',
    due_date: new Date('2024-03-15 10:00:00+07'),
    status: 'BORROWED',
    item_condition_on_checkout: 'GOOD',
  },
  {
    loan_id: null,
    variant_id: '00000000-0000-0000-0000-000000000002',
    item_barcode: 'LI-L001-002',
    due_date: new Date('2024-03-15 10:00:00+07'),
    status: 'BORROWED',
    item_condition_on_checkout: 'GOOD',
  },
  {
    loan_id: null,
    variant_id: '00000000-0000-0000-0000-000000000003',
    item_barcode: 'LI-L001-003',
    due_date: new Date('2024-03-15 10:00:00+07'),
    status: 'BORROWED',
    item_condition_on_checkout: 'GOOD',
  },
  // LOAN-002: 2 items (BORROWED, near due)
  {
    loan_id: null,
    variant_id: '00000000-0000-0000-0000-000000000004',
    item_barcode: 'LI-L002-001',
    due_date: new Date('2024-03-26 09:00:00+07'),
    status: 'BORROWED',
    item_condition_on_checkout: 'GOOD',
  },
  {
    loan_id: null,
    variant_id: '00000000-0000-0000-0000-000000000005',
    item_barcode: 'LI-L002-002',
    due_date: new Date('2024-03-26 09:00:00+07'),
    status: 'BORROWED',
    item_condition_on_checkout: 'GOOD',
  },
  // LOAN-003: 2 items (RETURNED on time)
  {
    loan_id: null,
    variant_id: '00000000-0000-0000-0000-000000000001',
    item_barcode: 'LI-L003-001',
    due_date: new Date('2024-03-01 14:00:00+07'),
    return_date: new Date('2024-03-01 16:00:00+07'),
    returned_to_warehouse_id: warehouseId,
    status: 'RETURNED',
    item_condition_on_checkout: 'GOOD',
    item_condition_on_return: 'GOOD',
  },
  {
    loan_id: null,
    variant_id: '00000000-0000-0000-0000-000000000006',
    item_barcode: 'LI-L003-002',
    due_date: new Date('2024-03-01 14:00:00+07'),
    return_date: new Date('2024-03-01 16:00:00+07'),
    returned_to_warehouse_id: warehouseId,
    status: 'RETURNED',
    item_condition_on_checkout: 'GOOD',
    item_condition_on_return: 'GOOD',
  },
  // LOAN-004: 5 items (RETURNED_LATE)
  {
    loan_id: null,
    variant_id: '00000000-0000-0000-0000-000000000002',
    item_barcode: 'LI-L004-001',
    due_date: new Date('2024-02-15 10:00:00+07'),
    return_date: new Date('2024-03-10 14:00:00+07'),
    returned_to_warehouse_id: warehouseId,
    status: 'RETURNED',
    item_condition_on_checkout: 'GOOD',
    item_condition_on_return: 'GOOD',
    fine_amount: 120000,
  },
  {
    loan_id: null,
    variant_id: '00000000-0000-0000-0000-000000000003',
    item_barcode: 'LI-L004-002',
    due_date: new Date('2024-02-15 10:00:00+07'),
    return_date: new Date('2024-03-10 14:00:00+07'),
    returned_to_warehouse_id: warehouseId,
    status: 'RETURNED',
    item_condition_on_checkout: 'GOOD',
    item_condition_on_return: 'GOOD',
    fine_amount: 120000,
  },
  {
    loan_id: null,
    variant_id: '00000000-0000-0000-0000-000000000004',
    item_barcode: 'LI-L004-003',
    due_date: new Date('2024-02-15 10:00:00+07'),
    return_date: new Date('2024-03-10 14:00:00+07'),
    returned_to_warehouse_id: warehouseId,
    status: 'RETURNED',
    item_condition_on_checkout: 'GOOD',
    item_condition_on_return: 'GOOD',
    fine_amount: 120000,
  },
  {
    loan_id: null,
    variant_id: '00000000-0000-0000-0000-000000000005',
    item_barcode: 'LI-L004-004',
    due_date: new Date('2024-02-15 10:00:00+07'),
    return_date: new Date('2024-03-10 14:00:00+07'),
    returned_to_warehouse_id: warehouseId,
    status: 'RETURNED',
    item_condition_on_checkout: 'GOOD',
    item_condition_on_return: 'ACCEPTABLE',
    fine_amount: 120000,
  },
  {
    loan_id: null,
    variant_id: '00000000-0000-0000-0000-000000000006',
    item_barcode: 'LI-L004-005',
    due_date: new Date('2024-02-15 10:00:00+07'),
    return_date: new Date('2024-03-10 14:00:00+07'),
    returned_to_warehouse_id: warehouseId,
    status: 'RETURNED',
    item_condition_on_checkout: 'GOOD',
    item_condition_on_return: 'GOOD',
    fine_amount: 120000,
  },
  // LOAN-005: 1 item (RETURNED_LATE - 7 days overdue)
  {
    loan_id: null,
    variant_id: '00000000-0000-0000-0000-000000000007',
    item_barcode: 'LI-L005-001',
    due_date: new Date('2024-01-29 11:00:00+07'),
    return_date: new Date('2024-02-05 09:00:00+07'),
    returned_to_warehouse_id: warehouseId,
    status: 'RETURNED',
    item_condition_on_checkout: 'GOOD',
    item_condition_on_return: 'GOOD',
    fine_amount: 35000,
  },
  // LOAN-006: 2 items (OVERDUE - 10 days)
  {
    loan_id: null,
    variant_id: '00000000-0000-0000-0000-000000000008',
    item_barcode: 'LI-L006-001',
    due_date: new Date('2024-03-03 10:00:00+07'),
    status: 'OVERDUE',
    item_condition_on_checkout: 'GOOD',
  },
  {
    loan_id: null,
    variant_id: '00000000-0000-0000-0000-000000000009',
    item_barcode: 'LI-L006-002',
    due_date: new Date('2024-03-03 10:00:00+07'),
    status: 'OVERDUE',
    item_condition_on_checkout: 'GOOD',
  },
];

// Fetch created loans to get their IDs
const createdLoans = await prisma.loan_transactions.findMany({
  where: {
    loan_number: {
      in: ['LOAN-001', 'LOAN-002', 'LOAN-003', 'LOAN-004', 'LOAN-005', 'LOAN-006'],
    },
  },
  select: { id: true, loan_number: true, total_items: true },
});

// Map loan items to their loan IDs
const loanItemMap = {
  'LOAN-001': createdLoans.find(l => l.loan_number === 'LOAN-001')?.id,
  'LOAN-002': createdLoans.find(l => l.loan_number === 'LOAN-002')?.id,
  'LOAN-003': createdLoans.find(l => l.loan_number === 'LOAN-003')?.id,
  'LOAN-004': createdLoans.find(l => l.loan_number === 'LOAN-004')?.id,
  'LOAN-005': createdLoans.find(l => l.loan_number === 'LOAN-005')?.id,
  'LOAN-006': createdLoans.find(l => l.loan_number === 'LOAN-006')?.id,
};

const loanItemsWithLoanIds = loanItemsData.map((item, index) => {
  let loanNumber;
  if (index < 3) loanNumber = 'LOAN-001';
  else if (index < 5) loanNumber = 'LOAN-002';
  else if (index < 7) loanNumber = 'LOAN-003';
  else if (index < 12) loanNumber = 'LOAN-004';
  else if (index < 13) loanNumber = 'LOAN-005';
  else loanNumber = 'LOAN-006';

  return {
    ...item,
    loan_id: loanItemMap[loanNumber],
  };
}).filter(item => item.loan_id !== undefined);

await prisma.loan_items.createMany({
  data: loanItemsWithLoanIds,
  skipDuplicates: true,
});

console.log(`✅ Created ${loanItemsWithLoanIds.length} loan items`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 7.6: LOAN RENEWALS (Borrow history extensions)
// ═══════════════════════════════════════════════════════════════════════════════

const loanItems = await prisma.loan_items.findMany({
  where: {
    loan_transactions: {
      loan_number: {
        in: ['LOAN-001', 'LOAN-002', 'LOAN-004'],
      },
    },
  },
  include: {
    loan_transactions: {
      select: { loan_number: true },
    },
  },
});

const loanRenewalsData = [
  // LOAN-001 Item 1: Renewed once
  {
    loan_item_id: loanItems.find(li => li.item_barcode === 'LI-L001-001')?.id,
    renewed_by_user_id: userId,
    renewed_at: new Date('2024-03-10 11:00:00+07'),
    old_due_date: new Date('2024-03-15 10:00:00+07'),
    new_due_date: new Date('2024-03-22 10:00:00+07'),
    renewal_count: 1,
    reason: 'Can read more time',
  },
  // LOAN-002 Item 1: Renewed twice (max)
  {
    loan_item_id: loanItems.find(li => li.item_barcode === 'LI-L002-001')?.id,
    renewed_by_user_id: userId,
    renewed_at: new Date('2024-03-18 14:00:00+07'),
    old_due_date: new Date('2024-03-26 09:00:00+07'),
    new_due_date: new Date('2024-04-05 09:00:00+07'),
    renewal_count: 1,
    reason: 'Need more time to finish',
  },
  {
    loan_item_id: loanItems.find(li => li.item_barcode === 'LI-L002-001')?.id,
    renewed_by_user_id: userId,
    renewed_at: new Date('2024-04-02 10:00:00+07'),
    old_due_date: new Date('2024-04-05 09:00:00+07'),
    new_due_date: new Date('2024-04-12 09:00:00+07'),
    renewal_count: 2,
    reason: 'Still reading',
  },
  // LOAN-004 Items: Some renewed before return
  {
    loan_item_id: loanItems.find(li => li.item_barcode === 'LI-L004-001')?.id,
    renewed_by_user_id: userId,
    renewed_at: new Date('2024-02-10 09:00:00+07'),
    old_due_date: new Date('2024-02-15 10:00:00+07'),
    new_due_date: new Date('2024-02-22 10:00:00+07'),
    renewal_count: 1,
    reason: 'Traveling',
  },
  {
    loan_item_id: loanItems.find(li => li.item_barcode === 'LI-L004-002')?.id,
    renewed_by_user_id: userId,
    renewed_at: new Date('2024-02-10 09:30:00+07'),
    old_due_date: new Date('2024-02-15 10:00:00+07'),
    new_due_date: new Date('2024-02-22 10:00:00+07'),
    renewal_count: 1,
    reason: 'Traveling',
  },
].filter(r => r.loan_item_id !== undefined);

await prisma.loan_renewals.createMany({
  data: loanRenewalsData,
  skipDuplicates: true,
});

console.log(`✅ Created ${loanRenewalsData.length} loan renewals`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 7.7: FINE PAYMENTS (Payment history)
// ═══════════════════════════════════════════════════════════════════════════════

const fines = await prisma.fines.findMany({
  select: { id: true, customer_id: true },
});

const finePaymentsData = [
  // Fine payment for CUST-002 (LOAN-003)
  {
    fine_id: fines.find(f => f.customer_id === customers[2].id)?.id,
    payment_method: 'WALLET',
    amount: 15000,
    paid_by_user_id: userId,
    paid_at: new Date('2024-03-05 14:00:00+07'),
    note: 'Thanh toan phat tre han qua vi',
  },
].filter(p => p.fine_id !== undefined);

if (finePaymentsData.length > 0) {
  await prisma.fine_payments.createMany({
    data: finePaymentsData,
    skipDuplicates: true,
  });
  console.log(`✅ Created ${finePaymentsData.length} fine payments`);
}

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
// STEP 13: EXTENDED CUSTOMER AND CIRCULATION SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════════

const extendedCustomer = await prisma.customers.upsert({
  where: { customer_code: 'CUST-EXT-001' }, update: {},
  create: {
    customer_code: 'CUST-EXT-001', full_name: 'Bui Thanh Thao', email: 'bui.thanh.thao@demo.smartbook.vn',
    phone: '+84901234601', birth_date: new Date('2003-10-18'), address: 'Linh Trung, Thu Duc, Ho Chi Minh City',
    status: 'ACTIVE', total_fine_balance: 20000,
  },
});
await prisma.customer_memberships.createMany({
  data: [{ customer_id: extendedCustomer.id, plan_id: plans[1].id, card_number: 'CARD-EXT-001-SILVER', start_date: new Date('2026-01-01'), end_date: new Date('2027-01-01'), status: 'ACTIVE', note: 'Student reader with mixed digital and counter activity.' }],
  skipDuplicates: true,
});
await prisma.customer_preferences.upsert({
  where: { customer_id: extendedCustomer.id }, update: {},
  create: { customer_id: extendedCustomer.id, notify_email: true, notify_sms: true, notify_in_app: true, preferred_language: 'vi' },
});
const extendedAccount = await prisma.customer_accounts.upsert({
  where: { customer_id: extendedCustomer.id }, update: {},
  create: { customer_id: extendedCustomer.id, currency_code: 'VND', status: 'ACTIVE', available_balance: 180000, held_balance: 20000, total_credited: 250000, total_debited: 50000 },
});

const extendedLoan = await prisma.loan_transactions.upsert({
  where: { loan_number: 'LOAN-EXT-OVERDUE' }, update: {},
  create: {
    loan_number: 'LOAN-EXT-OVERDUE', customer_id: extendedCustomer.id, warehouse_id: warehouseId, handled_by_user_id: userId,
    borrow_date: new Date('2026-07-01T09:00:00+07:00'), due_date: new Date('2026-07-15T09:00:00+07:00'),
    status: 'OVERDUE', total_items: 1, notes: 'Overdue scenario for reminder and fine dashboards.',
  },
});
const existingExtendedItem = await prisma.loan_items.findFirst({ where: { item_barcode: 'LI-EXT-OVERDUE-001' }, select: { id: true } });
const extendedLoanItem = existingExtendedItem ?? await prisma.loan_items.create({
  data: { loan_id: extendedLoan.id, variant_id: '00000000-0000-0000-0000-000000000001', item_barcode: 'LI-EXT-OVERDUE-001', due_date: new Date('2026-07-15T09:00:00+07:00'), status: 'OVERDUE', item_condition_on_checkout: 'GOOD', fine_amount: 20000, notes: 'Two reminders sent; awaiting return.' },
});
const extendedFine = await prisma.fines.findFirst({ where: { customer_id: extendedCustomer.id, note: 'Extended overdue fine for reminder workflow.' }, select: { id: true } })
  ?? await prisma.fines.create({ data: { customer_id: extendedCustomer.id, loan_item_id: extendedLoanItem.id, fine_type: 'OVERDUE', amount: 20000, waived_amount: 0, status: 'UNPAID', issued_by_user_id: userId, issued_at: new Date('2026-07-20T09:00:00+07:00'), note: 'Extended overdue fine for reminder workflow.' } });

const existingPaymentMethod = await prisma.payment_methods.findFirst({ where: { customer_id: extendedCustomer.id, provider_reference: 'PAYMENT-EXT-WALLET' }, select: { id: true } });
const extendedPaymentMethod = existingPaymentMethod ?? await prisma.payment_methods.create({
  data: { customer_id: extendedCustomer.id, method_type: 'EWALLET', provider: 'MoMo Demo', provider_reference: 'PAYMENT-EXT-WALLET', masked_account: 'MOMO-***-8601', is_default: true, status: 'ACTIVE', metadata: { sandbox: true } },
});
await prisma.auto_payment_settings.upsert({
  where: { customer_id: extendedCustomer.id }, update: {},
  create: { customer_id: extendedCustomer.id, auto_debit_borrow_fee: true, auto_debit_fines: false, allow_partial_fine_payment: true, min_wallet_balance_required: 50000, default_payment_method_id: extendedPaymentMethod.id },
});
const existingLedger = await prisma.account_ledger.findFirst({ where: { customer_id: extendedCustomer.id, idempotency_key: 'ledger-ext-wallet-topup-001' }, select: { id: true } });
if (!existingLedger) await prisma.account_ledger.create({
  data: { account_id: extendedAccount.id, customer_id: extendedCustomer.id, entry_type: 'CREDIT', amount: 250000, balance_before: 0, balance_after: 250000, reference_type: 'WALLET_TOP_UP', idempotency_key: 'ledger-ext-wallet-topup-001', note: 'Initial demo wallet top-up.', metadata: { channel: 'EWALLET' }, created_by_user_id: userId },
});
const existingNotification = await prisma.customer_notifications.findFirst({ where: { customer_id: extendedCustomer.id, template_code: 'OVERDUE_REMINDER_EXT' }, select: { id: true } });
if (!existingNotification) await prisma.customer_notifications.create({
  data: { customer_id: extendedCustomer.id, channel: 'SMS', template_code: 'OVERDUE_REMINDER_EXT', subject: 'Nhắc trả sách quá hạn', body: 'Sách của bạn đã quá hạn. Vui lòng trả hoặc gia hạn tại SmartBook.', reference_type: 'LOAN_TRANSACTION', reference_id: extendedLoan.id, status: 'SENT', scheduled_at: new Date('2026-07-20T08:00:00+07:00'), sent_at: new Date('2026-07-20T08:00:05+07:00'), metadata: { fine_id: extendedFine.id, priority: 'high' } },
});
await prisma.book_reviews.createMany({ data: [{ customer_id: extendedCustomer.id, book_id: '00000000-0000-0000-0000-000000000001', rating: 5, comment: 'Dữ liệu demo cho đánh giá tích cực của độc giả.', status: 'VISIBLE' }], skipDuplicates: true });
await prisma.book_wishlists.createMany({ data: [{ customer_id: extendedCustomer.id, book_id: '00000000-0000-0000-0000-000000000002' }], skipDuplicates: true });
await prisma.availability_alerts.createMany({ data: [{ customer_id: extendedCustomer.id, book_id: '00000000-0000-0000-0000-000000000003', status: 'ACTIVE' }], skipDuplicates: true });
console.log('✅ Created extended customer, wallet, overdue loan, fine, and engagement scenario');

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
console.log(`   • Loan items (books in each loan)`);
console.log(`   • Loan renewals (borrow history extensions)`);
console.log(`   • Fine payments (payment history)`);
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
