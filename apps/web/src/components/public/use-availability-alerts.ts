import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { useAuthUser } from '@/hooks/useAuthUser';
import { buildLoginUrl } from '@/lib/return-url';
import type { PublicBook } from '@/services/public-catalog';

/**
 * "Báo khi có sách" for lists of borrowed-out books (same API and wording as
 * the book page). Anonymous visitors go to login and come back to the book.
 */
export function useAvailabilityAlerts() {
  const navigate = useNavigate();
  const { isAuthenticated, isCustomer } = useAuthUser();
  const [active, setActive] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!isCustomer) return;
    let alive = true;
    customerBorrowService.getMyAvailabilityAlerts()
      .then((res) => {
        if (!alive || !Array.isArray(res?.data)) return;
        setActive(new Set(res.data
          .filter((item: { status: string }) => item.status === 'ACTIVE')
          .map((item: { book_id: string }) => item.book_id)));
      })
      .catch(() => { /* buttons still work; state is just unknown */ });
    return () => { alive = false; };
  }, [isCustomer]);

  const toggle = async (book: PublicBook) => {
    if (!isAuthenticated) {
      navigate(buildLoginUrl(`/books/${book.id}`));
      return;
    }
    if (!isCustomer) {
      toast.info('Thông báo khi có sách dành cho tài khoản bạn đọc.');
      return;
    }
    const on = active.has(book.id);
    try {
      setBusy(book.id);
      if (on) await customerBorrowService.unsubscribeAvailabilityAlert(book.id);
      else await customerBorrowService.subscribeAvailabilityAlert(book.id);
      setActive((current) => {
        const next = new Set(current);
        if (on) next.delete(book.id);
        else next.add(book.id);
        return next;
      });
      toast.success(on ? 'Đã tắt thông báo cho cuốn này' : 'Sẽ báo cho bạn khi sách có trở lại');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Chưa cập nhật được thông báo'));
    } finally {
      setBusy(null);
    }
  };

  return {
    isOn: (bookId: string) => active.has(bookId),
    isBusy: (bookId: string) => busy === bookId,
    toggle,
  };
}

export type AvailabilityAlerts = ReturnType<typeof useAvailabilityAlerts>;
