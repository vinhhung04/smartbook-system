import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Fine, VnpayPaymentIntentStatus } from '../types/borrow';

/**
 * The VNPay link the reader opened last, remembered on the device so that coming back
 * to the app (or reopening it after it was killed) re-checks that exact transaction with
 * the server. Not a secret — txn_ref only identifies the intent, and every status read
 * is checked against the signed-in customer — but kept per user so a second account on
 * the same phone never sees it.
 */
export type StoredPayment = {
  txn_ref: string;
  fine_id: string;
  amount: number;
  expires_at: string;
  started_at: string;
};

const keyFor = (userId: string) => `smartbook_pending_vnpay:${userId}`;

export async function loadStoredPayments(userId: string): Promise<StoredPayment[]> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.txn_ref === 'string') : [];
  } catch {
    return [];
  }
}

async function saveStoredPayments(userId: string, items: StoredPayment[]) {
  await AsyncStorage.setItem(keyFor(userId), JSON.stringify(items));
}

export async function rememberPayment(userId: string, payment: StoredPayment) {
  const items = (await loadStoredPayments(userId)).filter((item) => item.fine_id !== payment.fine_id);
  await saveStoredPayments(userId, [payment, ...items].slice(0, 20));
}

export async function forgetPayment(userId: string, txnRef: string) {
  const items = await loadStoredPayments(userId);
  await saveStoredPayments(userId, items.filter((item) => item.txn_ref !== txnRef));
}

export type PaymentView = {
  tone: 'success' | 'warning' | 'danger' | 'primary';
  message: string;
  /** The intent reached a final state on the server: stop tracking it locally. */
  final: boolean;
  /** Money was recorded against the fine. */
  settled: boolean;
};

/**
 * What to tell the reader about a VNPay intent. Only the server's status counts — the
 * browser redirect back to the app proves nothing about payment.
 */
export function describePaymentStatus(status: VnpayPaymentIntentStatus | 'PROCESSING' | 'UNKNOWN'): PaymentView {
  switch (status) {
    case 'SUCCESS':
      return { tone: 'success', message: 'Thanh toán thành công — khoản phạt đã được ghi nhận.', final: true, settled: true };
    case 'FAILED':
      return { tone: 'danger', message: 'Giao dịch không được ghi nhận (thất bại hoặc đã hủy). Nếu ngân hàng đã trừ tiền, hãy liên hệ thư viện kèm mã giao dịch để được đối soát.', final: true, settled: false };
    case 'EXPIRED':
      return { tone: 'danger', message: 'Liên kết thanh toán đã hết hạn mà chưa nhận được xác nhận. Bạn có thể tạo giao dịch mới.', final: true, settled: false };
    case 'PROCESSING':
    case 'PENDING':
      return { tone: 'warning', message: 'Đang chờ VNPay xác nhận. Nếu bạn đã thanh toán, vui lòng đợi — không cần thanh toán lại.', final: false, settled: false };
    default:
      return { tone: 'primary', message: 'Chưa kiểm tra được trạng thái giao dịch. Kiểm tra lại khi có mạng.', final: false, settled: false };
  }
}

export type PayDecision =
  | { kind: 'pay' }
  | { kind: 'wait'; txnRef: string; until: string }
  | { kind: 'settled' };

/**
 * Whether a new VNPay link may be opened for this fine now. A link that is still pending
 * (on the server, or remembered locally and not yet expired) blocks a second one: paying
 * both would charge twice while only one can be applied.
 */
export function decidePayment(fine: Pick<Fine, 'id' | 'pending_payment'>, remaining: number, stored: StoredPayment | null, now = Date.now()): PayDecision {
  if (remaining <= 0) return { kind: 'settled' };
  const server = fine.pending_payment;
  if (server && new Date(server.expires_at).getTime() > now) return { kind: 'wait', txnRef: server.txn_ref, until: server.expires_at };
  if (stored && stored.fine_id === fine.id && new Date(stored.expires_at).getTime() > now) {
    return { kind: 'wait', txnRef: stored.txn_ref, until: stored.expires_at };
  }
  return { kind: 'pay' };
}
