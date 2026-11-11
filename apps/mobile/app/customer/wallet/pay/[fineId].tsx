import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { AppState, Text, View } from 'react-native';
import * as Linking from 'expo-linking';

import * as customerBorrowApi from '../../../../src/api/customerBorrow';
import { ApiError, useAuth } from '../../../../src/auth/auth-context';
import { getFineStatusDisplay, getFineTypeLabel } from '../../../../src/lib/fineStatus';
import { fineRemaining, formatVnd, toMoney } from '../../../../src/lib/money';
import {
  decidePayment,
  describePaymentStatus,
  forgetPayment,
  loadStoredPayments,
  rememberPayment,
  type PaymentView,
  type StoredPayment,
} from '../../../../src/lib/pendingPayment';
import { useSubmitLock } from '../../../../src/lib/submitLock';
import { Button, Card, ErrorState, InfoRow, InlineAlert, LoadingState, Screen, ScreenHeader, StatusBadge, fontFamily, space, useTheme } from '../../../../src/design-system';
import type { Fine } from '../../../../src/types/borrow';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

const VIEW_TITLE: Record<PaymentView['tone'], string> = {
  success: 'Đã ghi nhận thanh toán',
  warning: 'Đang chờ xác nhận',
  danger: 'Thanh toán chưa thành công',
  primary: 'Trạng thái thanh toán',
};

function methodLabel(method: string) {
  return method === 'VNPAY' ? 'VNPay' : method === 'CASH' ? 'Tiền mặt tại quầy' : method;
}

export default function CustomerPayFineScreen() {
  const { fineId } = useLocalSearchParams<{ fineId: string }>();
  const { user } = useAuth();
  const { colors, type } = useTheme();
  const [fine, setFine] = useState<Fine | null>(null);
  const [stored, setStored] = useState<StoredPayment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingPayment, setIsStartingPayment] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [view, setView] = useState<PaymentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const payLock = useSubmitLock();
  const checkingRef = useRef(false);

  const loadFine = useCallback(async () => {
    setError(null);
    try {
      const result = await customerBorrowApi.getMyFines();
      const match = result.data.fines.find((item) => item.id === fineId) ?? null;
      setFine(match);
      if (!match) setError('Không tìm thấy khoản phí phạt này');
      return match;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được thông tin phí phạt');
      return null;
    }
  }, [fineId]);

  // Asks the server about the link the reader opened last (or the one the server says
  // is still pending). The browser coming back to the app is never taken as "paid".
  const reconcile = useCallback(async () => {
    if (!user || checkingRef.current) return;
    checkingRef.current = true;
    setIsChecking(true);
    try {
      const current = await loadFine();
      const local = (await loadStoredPayments(user.id)).find((item) => item.fine_id === fineId) ?? null;
      setStored(local);
      const txnRef = local?.txn_ref ?? current?.pending_payment?.txn_ref ?? null;
      if (!txnRef) {
        setView(null);
        return;
      }
      try {
        const result = await customerBorrowApi.getVnpayFinePaymentStatus(txnRef);
        const next = describePaymentStatus(result.data.status);
        setView(next);
        if (next.final) {
          await forgetPayment(user.id, txnRef);
          setStored(null);
          if (next.settled) await loadFine();
        }
      } catch (err) {
        setView(err instanceof ApiError && err.status === 404 ? null : describePaymentStatus('UNKNOWN'));
        if (err instanceof ApiError && err.status === 404) {
          await forgetPayment(user.id, txnRef);
          setStored(null);
        }
      }
    } finally {
      checkingRef.current = false;
      setIsChecking(false);
    }
  }, [user, fineId, loadFine]);

  useEffect(() => {
    setIsLoading(true);
    reconcile().finally(() => setIsLoading(false));
  }, [reconcile]);

  // Re-check whenever the reader returns — from the system browser after VNPay, or by
  // reopening the app later. No deep link needed.
  useFocusEffect(
    useCallback(() => {
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') void reconcile();
      });
      return () => subscription.remove();
    }, [reconcile]),
  );

  async function handlePayOnline() {
    if (!fine || !user) return;
    await payLock.run(async () => {
      setIsStartingPayment(true);
      setError(null);
      try {
        const result = await customerBorrowApi.createVnpayFinePayment(fine.id);
        const payment: StoredPayment = {
          txn_ref: result.data.txn_ref,
          fine_id: fine.id,
          amount: toMoney(result.data.amount),
          expires_at: result.data.expires_at,
          started_at: new Date().toISOString(),
        };
        await rememberPayment(user.id, payment);
        setStored(payment);
        setView(describePaymentStatus('PENDING'));
        await Linking.openURL(result.data.payment_url);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'PAYMENT_PENDING') {
          // The server already has a live link for this fine: track that one instead.
          await reconcile();
        } else if (err instanceof ApiError && err.outcomeUnknown) {
          setError('Chưa rõ liên kết thanh toán đã được tạo hay chưa. Đã tải lại trạng thái — kiểm tra trước khi thử lại.');
          await reconcile();
        } else {
          setError(err instanceof ApiError ? err.message : 'Không thể khởi tạo thanh toán, vui lòng thử lại.');
        }
      } finally {
        setIsStartingPayment(false);
      }
    });
  }

  if (isLoading) {
    return (
      <>
        <ScreenHeader title="Thanh toán phí phạt" />
        <Screen scroll={false}><LoadingState label="Đang kiểm tra khoản phí…" /></Screen>
      </>
    );
  }

  if (!fine) {
    return (
      <>
        <ScreenHeader title="Thanh toán phí phạt" />
        <Screen scroll={false}><ErrorState title="Không mở được khoản phí" message={error} onRetry={() => void reconcile()} /></Screen>
      </>
    );
  }

  const remaining = fineRemaining(fine);
  const decision = decidePayment(fine, remaining, stored);
  const status = getFineStatusDisplay(fine.status);
  const payments = fine.fine_payments ?? [];

  const footer = decision.kind === 'wait' ? (
    <Button label="Kiểm tra trạng thái thanh toán" icon="refresh" variant="secondary" loading={isChecking} loadingLabel="Đang kiểm tra…" onPress={() => void reconcile()} />
  ) : decision.kind === 'pay' ? (
    <>
      <Button
        label={`Thanh toán ${formatVnd(remaining)} qua VNPay`}
        icon="card-outline"
        loading={isStartingPayment}
        loadingLabel="Đang mở VNPay…"
        onPress={handlePayOnline}
        accessibilityLabel={`Thanh toán ${formatVnd(remaining)} qua VNPay`}
      />
      <Text style={[type.caption, { textAlign: 'center' }]}>Khoản phạt chỉ được ghi nhận khi VNPay xác nhận với thư viện.</Text>
    </>
  ) : null;

  return (
    <>
      <ScreenHeader title="Thanh toán phí phạt" />
      <Screen footer={footer}>
        <View style={{ gap: space.xs }}>
          <Text style={type.caption}>{getFineTypeLabel(fine.fine_type)}</Text>
          <Text
            style={{ fontFamily: fontFamily.serif, fontSize: 40, lineHeight: 46, color: remaining > 0 ? colors.danger : colors.success, fontVariant: ['tabular-nums'] }}
            accessibilityLabel={remaining > 0 ? `Còn phải trả ${formatVnd(remaining)}` : 'Đã thanh toán đủ'}
          >
            {formatVnd(remaining)}
          </Text>
          <Text style={type.callout}>{remaining > 0 ? 'Số tiền còn phải trả' : 'Đã thanh toán đủ'}</Text>
          {status ? <View style={{ marginTop: space.xs }}><StatusBadge tone={status.tone} label={status.label} /></View> : null}
        </View>

        {view ? (
          <View accessibilityLiveRegion="polite">
            <InlineAlert
              tone={view.tone}
              title={VIEW_TITLE[view.tone]}
              message={decision.kind === 'wait' ? `${view.message}\nMã giao dịch ${decision.txnRef}, liên kết hết hạn lúc ${formatTime(decision.until)}.` : view.message}
            />
          </View>
        ) : null}

        {error ? <InlineAlert tone="danger" message={error} /> : null}

        <Card>
          <InfoRow label="Tiền phạt" value={formatVnd(fine.amount)} />
          {toMoney(fine.waived_amount) > 0 ? <InfoRow label="Được miễn" value={`− ${formatVnd(fine.waived_amount)}`} tone={colors.success} /> : null}
          {payments.length > 0 ? <InfoRow label="Đã trả" value={`− ${formatVnd(payments.reduce((sum, p) => sum + toMoney(p.amount), 0))}`} tone={colors.success} /> : null}
          <View style={{ height: 1, backgroundColor: colors.border }} />
          <InfoRow label="Còn lại" value={formatVnd(remaining)} tone={remaining > 0 ? colors.danger : colors.success} />
        </Card>

        {payments.length > 0 ? (
          <View style={{ gap: space.md }}>
            <Text style={type.heading} accessibilityRole="header">Lịch sử thanh toán</Text>
            <Card>
              {payments.map((payment) => (
                <View key={payment.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={type.bodyStrong}>{methodLabel(String(payment.payment_method))}</Text>
                    <Text style={type.caption}>{new Date(payment.paid_at).toLocaleString('vi-VN')}</Text>
                  </View>
                  <Text style={{ fontFamily: fontFamily.bold, fontSize: 15, color: colors.success, fontVariant: ['tabular-nums'] }}>{formatVnd(payment.amount)}</Text>
                </View>
              ))}
            </Card>
          </View>
        ) : null}
      </Screen>
    </>
  );
}
