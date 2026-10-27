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
