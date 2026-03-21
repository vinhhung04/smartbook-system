import { authAPI } from './http-clients';

export interface LoginRequest {
  identifier: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  full_name: string;
  password: string;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  full_name: string;
  roles: string[];
  permissions: string[];
  is_superuser?: boolean;
}

export interface LoginResponse {
  message: string;
  token: string;
  user: AuthUser;
}

export interface RegisterResponse {
  message: string;
  user: Omit<AuthUser, 'roles' | 'permissions'>;
}

interface TokenPayload {
  exp?: number;
}

export interface UpdateMeRequest {
  full_name?: string;
  email?: string;
}

const TOKEN_KEY = 'token';
const USER_KEY = 'auth_user';

function parseJwtPayload(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(payload);
    return JSON.parse(decoded) as TokenPayload;
  } catch {
    return null;
  }
}

function setSession(token: string, user?: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export const authService = {
  login: async (data: LoginRequest): Promise<LoginResponse> => {
    const response = await authAPI.post('/auth/login', {
      identifier: data.identifier,
      email: data.identifier,
      username: data.identifier,
      password: data.password,
    });
    const token = response.data.token;
    if (token) {
      setSession(token, response.data.user);
    }
    return response.data;
  },

  register: async (data: RegisterRequest): Promise<RegisterResponse> => {
    const response = await authAPI.post('/auth/register', data);
    return response.data;
  },

  logout: async () => {
    try {
      await authAPI.post('/auth/logout');
    } catch {
      // Always clear local session even if server-side logout fails.
    }
    clearSession();
  },

  getMe: async (): Promise<AuthUser> => {
    const response = await authAPI.get('/auth/me');
    const user = response.data?.user as AuthUser;
    const token = localStorage.getItem(TOKEN_KEY);
    if (token && user) {
      setSession(token, user);
    }
    return user;
  },

  updateMe: async (data: UpdateMeRequest): Promise<AuthUser> => {
    const response = await authAPI.patch('/auth/me', data);
    const user = response.data?.user as AuthUser;
    const token = localStorage.getItem(TOKEN_KEY);
    if (token && user) {
      setSession(token, user);
    }
    return user;
  },

  getToken: (): string | null => localStorage.getItem(TOKEN_KEY),

  getCurrentUser: (): AuthUser | null => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      return null;
    }
  },

  isAuthenticated: (): boolean => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return false;
    const payload = parseJwtPayload(token);
    if (!payload?.exp) return true;
    return payload.exp * 1000 > Date.now();
  },

  isCustomer: (): boolean => {
    const user = authService.getCurrentUser();
    return Array.isArray(user?.roles) && user.roles.includes('CUSTOMER');
  },

  hydrateCurrentUser: async (): Promise<AuthUser | null> => {
    if (!authService.isAuthenticated()) {
      return null;
    }

    try {
      return await authService.getMe();
    } catch {
      clearSession();
      return null;
    }
  },
};
