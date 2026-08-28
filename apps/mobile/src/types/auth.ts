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
