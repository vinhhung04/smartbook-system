export type User = {
  id: string;
  username: string;
  email: string;
  roles: string[];
  permissions: string[];
};

export type LoginResponse = {
  message: string;
  token: string;
  user: User;
};

export type WarehouseStaffOption = {
  id: string;
  username: string;
  full_name: string;
  email: string;
  status: 'ACTIVE';
};
