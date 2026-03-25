import { gatewayAPI } from './http-clients';

export interface CustomerPreferences {
  notify_email: boolean;
  notify_sms: boolean;
  notify_in_app: boolean;
  preferred_language: string;
}

export interface CustomerProfile {
  id: string;
  customer_code: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  address: string | null;
  status: string;
  total_fine_balance: number;
  customer_preferences?: CustomerPreferences | null;
}

export interface MembershipInfo {
  customer_id: string;
  membership_id: string;
  card_number?: string;
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
}

export interface UpdateCustomerProfileRequest {
  full_name?: string;
  phone?: string | null;
  birth_date?: string | null;
  address?: string | null;
}

export const customerService = {
  async getMyProfile(): Promise<CustomerProfile> {
    const response = await gatewayAPI.get('/my/profile');
    return response.data?.data as CustomerProfile;
  },

  async updateMyProfile(data: UpdateCustomerProfileRequest): Promise<CustomerProfile> {
    const response = await gatewayAPI.patch('/my/profile', data);
    return response.data?.data as CustomerProfile;
  },

  async getMyMembership(): Promise<MembershipInfo> {
    const response = await gatewayAPI.get('/my/membership');
    return response.data?.data as MembershipInfo;
  },
};
