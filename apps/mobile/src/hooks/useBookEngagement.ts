import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import * as engagementApi from '../api/customerEngagement';
import { ApiError } from '../api/client';
import { useSubmitLock } from '../lib/submitLock';

/**
 * Wishlist + "báo khi có sách" state of one book for the signed-in reader. Toggles wait
 * for the server (no optimistic flip), so the heart/bell always shows what is stored.
 */
export function useBookEngagement(bookId: string | undefined) {
  const [saved, setSaved] = useState<boolean | null>(null);
  const [alertActive, setAlertActive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<'wishlist' | 'alert' | null>(null);
  const lock = useSubmitLock();

  const load = useCallback(async () => {
    if (!bookId) return;
    const [wishlist, alerts] = await Promise.allSettled([engagementApi.getMyWishlist(), engagementApi.getMyAvailabilityAlerts()]);
    setSaved(wishlist.status === 'fulfilled' ? wishlist.value.data.some((entry) => entry.book_id === bookId) : null);
    setAlertActive(alerts.status === 'fulfilled' ? alerts.value.data.some((alert) => alert.book_id === bookId && alert.status === 'ACTIVE') : null);
  }, [bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleWishlist = useCallback(async () => {
    if (!bookId || saved === null) return;
    await lock.run(async () => {
      setBusy('wishlist');
      try {
        if (saved) await engagementApi.removeFromWishlist(bookId);
        else await engagementApi.addToWishlist(bookId);
        setSaved(!saved);
      } catch (err) {
        Alert.alert('Chưa cập nhật được', err instanceof ApiError ? err.message : 'Vui lòng thử lại.');
        await load();
      } finally {
        setBusy(null);
      }
    });
  }, [bookId, saved, lock, load]);

  const toggleAlert = useCallback(async () => {
    if (!bookId || alertActive === null) return;
    await lock.run(async () => {
      setBusy('alert');
      try {
        if (alertActive) {
          await engagementApi.unsubscribeAvailabilityAlert(bookId);
          setAlertActive(false);
        } else {
          await engagementApi.subscribeAvailabilityAlert(bookId);
          setAlertActive(true);
          Alert.alert('Đã đăng ký', 'Thư viện sẽ gửi thông báo cho bạn khi sách có lại ở chi nhánh.');
        }
      } catch (err) {
        // 409: the book is already back in stock — the screen reloads and offers reserving.
        Alert.alert(err instanceof ApiError && err.status === 409 ? 'Sách đã có sẵn' : 'Chưa đăng ký được', err instanceof ApiError ? err.message : 'Vui lòng thử lại.');
        await load();
      } finally {
        setBusy(null);
      }
    });
  }, [bookId, alertActive, lock, load]);

  return { saved, alertActive, busy, toggleWishlist, toggleAlert, reload: load };
}
