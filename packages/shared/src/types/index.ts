export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface UserIdentity {
  id: string;
  username: string;
  email: string;
  full_name?: string;
}
