import type { CustomerNotification } from '../api/customerEngagement';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where tapping a notification leads, from its reference_type + reference_id (the rows
 * borrow-service writes in lib/notifications createNotificationRecord). Only known types
 * with a valid id open a screen; anything else just stays in the list as read.
 */
export function notificationTarget(notification: Pick<CustomerNotification, 'reference_type' | 'reference_id' | 'metadata'>): string | null {
  const id = notification.reference_id;
  const loanId = typeof notification.metadata?.loan_id === 'string' ? notification.metadata.loan_id : null;
  switch (notification.reference_type) {
    case 'LOAN_TRANSACTION':
      return id && UUID.test(id) ? `/customer/my-books/loan/${id}` : null;
    case 'LOAN_ITEM':
      // reference_id is the loan *item*; only a loan id in metadata leads somewhere real.
      return loanId && UUID.test(loanId) ? `/customer/my-books/loan/${loanId}` : null;
    case 'LOAN_RESERVATION':
      return id && UUID.test(id) ? `/customer/my-books/reservation/${id}` : null;
    case 'FINE':
      return '/customer/wallet';
    case 'BOOK':
      return id && UUID.test(id) ? `/customer/book/${id}` : null;
    default:
      return null;
  }
}
