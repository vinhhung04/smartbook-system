import { useEffect, useState } from 'react';
import { authService, type AuthUser } from '@/services/auth';

function readUser(): AuthUser | null {
  return authService.isAuthenticated() ? authService.getCurrentUser() : null;
}

/** Signed-in user for public pages, kept in sync with login/logout in this and other tabs. */
export function useAuthUser() {
  const [user, setUser] = useState<AuthUser | null>(readUser);

  useEffect(() => {
    const sync = () => setUser(readUser());
    window.addEventListener('smartbook:auth-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('smartbook:auth-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const isCustomer = Boolean(user?.roles?.includes('CUSTOMER'));
  return { user, isAuthenticated: Boolean(user), isCustomer, isStaff: Boolean(user) && !isCustomer };
}
