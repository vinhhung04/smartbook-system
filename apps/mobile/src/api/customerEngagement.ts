import { apiFetch } from './client';

// borrow-service /my/* (gateway /my -> /borrow/my): wishlist, availability alerts,
// in-app notifications and reviews. Every endpoint is scoped to the signed-in
// customer server-side; ids sent from here only pick among their own rows.

export type WishlistEntry = { id: string; book_id: string; created_at: string };

export function getMyWishlist() {
  return apiFetch<{ data: WishlistEntry[] }>('/my/wishlists');
}

export function addToWishlist(bookId: string) {
  return apiFetch<{ data: WishlistEntry }>('/my/wishlists', { method: 'POST', body: { book_id: bookId } });
}

export function removeFromWishlist(bookId: string) {
  return apiFetch<{ message: string }>(`/my/wishlists/${encodeURIComponent(bookId)}`, { method: 'DELETE' });
}

export type AvailabilityAlert = { id: string; book_id: string; status: 'ACTIVE' | 'NOTIFIED' | string; notified_at: string | null; created_at: string };

export function getMyAvailabilityAlerts() {
  return apiFetch<{ data: AvailabilityAlert[] }>('/my/availability-alerts');
}

/** 409 = the book is already available (reserve instead); 503 = availability could not be verified. */
export function subscribeAvailabilityAlert(bookId: string) {
  return apiFetch<{ data: AvailabilityAlert }>('/my/availability-alerts', { method: 'POST', body: { book_id: bookId } });
}

export function unsubscribeAvailabilityAlert(bookId: string) {
  return apiFetch<{ message: string }>(`/my/availability-alerts/${encodeURIComponent(bookId)}`, { method: 'DELETE' });
}

export type CustomerNotification = {
  id: string;
  channel: string;
  template_code: string | null;
  subject: string | null;
  body: string;
  reference_type: string | null;
  reference_id: string | null;
  status: string;
  scheduled_at: string;
  sent_at: string | null;
  read_at: string | null;
  metadata: Record<string, unknown>;
};

export type NotificationPage = {
  data: CustomerNotification[];
  meta: { page: number; pageSize: number; total: number; totalPages: number; unread_count: number };
};

export function getMyNotifications(page = 1, pageSize = 20, status?: 'unread' | 'read') {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) query.set('status', status);
  return apiFetch<NotificationPage>(`/my/notifications?${query.toString()}`);
}

export function getUnreadNotificationCount() {
  return apiFetch<{ data: { unread_count: number } }>('/my/notifications/unread-count');
}

export function markNotificationRead(id: string) {
  return apiFetch<{ data: { id: string; unread_count: number } }>(`/my/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
}

export function markAllNotificationsRead() {
  return apiFetch<{ data: { unread_count: number } }>('/my/notifications/read-all', { method: 'PATCH' });
}

export type PublicReview = { id: string; rating: number; comment: string | null; created_at: string; reviewer_name: string };

export type PublicReviewPage = {
  data: PublicReview[];
  stats: { averageRating: number; totalReviews: number; distribution: Record<string, number> };
  meta: { page: number; pageSize: number; total: number; totalPages: number };
};

export function getBookReviews(bookId: string, page = 1, pageSize = 10) {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return apiFetch<PublicReviewPage>(`/public/reviews/book/${encodeURIComponent(bookId)}?${query.toString()}`, { skipAuth: true });
}

export type MyReview = { id: string; book_id: string; rating: number; comment: string | null; status: string; created_at: string; updated_at: string };

/** can_review: true/false from the reader's returned loans; null = could not be checked now. */
export function getMyReviewForBook(bookId: string) {
  return apiFetch<{ data: MyReview | null; can_review: boolean | null }>(`/my/reviews/book/${encodeURIComponent(bookId)}`);
}

export function saveMyReview(bookId: string, rating: number, comment: string) {
  return apiFetch<{ data: MyReview }>('/my/reviews', { method: 'POST', body: { book_id: bookId, rating, comment } });
}

export function deleteMyReview(bookId: string) {
  return apiFetch<{ message: string }>(`/my/reviews/book/${encodeURIComponent(bookId)}`, { method: 'DELETE' });
}
