export type User = {
  id: string;
  username: string;
  email: string;
  full_name?: string | null;
  roles: string[];
  permissions: string[];
  is_superuser?: boolean;
};

export type LoginResponse = {
  message: string;
  token: string;
  /** Present when the client asked for a refresh token (mobile only). */
  refresh_token?: string;
  refresh_expires_at?: string;
  user: User;
};

export type OtpPurpose = 'EMAIL_VERIFICATION' | 'LOGIN_2FA';

/** An emailed-code step (auth-service lib/email-otp.js). The id is not a credential. */
export type OtpChallenge = {
  id: string;
  purpose: OtpPurpose;
  masked_email: string;
  code_length: number;
  expires_at: string;
  resend_available_at: string;
  attempts_remaining: number;
};

/** /auth/login answers 202 with this instead of a session when a code is needed first. */
export type LoginChallengeResponse = {
  status: 'OTP_REQUIRED' | 'EMAIL_VERIFICATION_REQUIRED';
  message: string;
  challenge: OtpChallenge;
};

export type RefreshResponse = {
  token: string;
  refresh_token: string;
  refresh_expires_at: string;
  user: User;
};

export type WarehouseStaffOption = {
  id: string;
  username: string;
  full_name: string;
  email: string;
  status: 'ACTIVE';
};
