// Mirrors apps/web/src/services/customer.ts CustomerProfile/MembershipInfo exactly.
export type CustomerProfile = {
  id: string;
  customer_code: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  address: string | null;
  status: string;
  total_fine_balance: number;
};

export type MembershipInfo = {
  customer_id: string;
  membership_id: string;
  plan_id: string;
  plan_code: string;
  plan_name: string;
  limits: {
    max_active_loans: number;
    max_loan_days: number;
    max_renewal_count: number;
    reservation_hold_hours: number;
    fine_per_day: number;
    lost_item_fee_multiplier: number;
  };
  active_loan_count: number;
  remaining_loan_slots: number;
  outstanding_fine_balance: number;
};
