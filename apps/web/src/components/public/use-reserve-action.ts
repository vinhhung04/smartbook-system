import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useAuthUser } from '@/hooks/useAuthUser';
import { buildLoginUrl } from '@/lib/return-url';
import type { PublicBook } from '@/services/public-catalog';

/**
 * Auth-on-action for "Đặt trước": anyone can browse, but reserving needs a
 * reader account. Anonymous visitors go to login and come back to the same book
 * with `?reserve=1`, which reopens the reservation step there.
 */
export function useReserveAction() {
  const navigate = useNavigate();
  const { isAuthenticated, isCustomer } = useAuthUser();
  const [target, setTarget] = useState<PublicBook | null>(null);

  const requestReserve = (book: PublicBook) => {
    if (!isAuthenticated) {
      navigate(buildLoginUrl(`/books/${book.id}?reserve=1`));
      return;
    }
    if (!isCustomer) {
      toast.info('Đặt trước dành cho tài khoản bạn đọc. Tài khoản nhân viên tạo đặt trước trong trang quản lý mượn trả.');
      return;
    }
    setTarget(book);
  };

  return { target, requestReserve, closeReserve: () => setTarget(null) };
}
