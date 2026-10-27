import { useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import * as transferApi from '../../src/api/transferReceiving';
import { isOutcomeUnknown } from '../../src/api/client';
import { ApiError, useAuth } from '../../src/auth/auth-context';
import { isWarehouseManager } from '../../src/auth/access';
import { StampBadge } from '../../src/components/StampBadge';
import { useTransferReceiving } from '../../src/hooks/useTransferReceiving';
import { useSubmitLock } from '../../src/lib/submitLock';
import { matchesCode } from '../../src/scanner/matching';
import { notifyScanError, notifyScanSuccess } from '../../src/scanner/haptics';
import { ScanField } from '../../src/scanner/ScanField';
import { colors, fonts, radius, shadow, spacing, typography } from '../../src/theme/tokens';

/**
 * Receive one inbound transfer: scan the transfer number on the package to make sure it
 * is the right shipment, then confirm. Confirming posts the shipped quantities into this
 * warehouse's RECEIVING area as a goods receipt, which then goes to putaway.
 */
export default function TransferReceivingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { rows, isLoading, error, reload } = useTransferReceiving();
  const row = rows.find((candidate) => candidate.item.id === id) ?? null;
  const [scanInput, setScanInput] = useState('');
  const [verified, setVerified] = useState(false);
  const [scanMessage, setScanMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<'claim' | 'confirm' | null>(null);
  const [done, setDone] = useState<{ receiptId: string | null; receiptNumber: string | null } | null>(null);
  const lock = useSubmitLock();

  if (done) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Đã nhận hàng' }} />
        <View style={styles.center}>
          <StampBadge text="Đã xác nhận nhận hàng điều chuyển" tone="success" />
          <Text style={styles.body}>
            Hàng đã vào khu chờ cất của kho{done.receiptNumber ? ` (phiếu nhập ${done.receiptNumber})` : ''}. Bước tiếp theo là cất lên kệ.
          </Text>
          {done.receiptId ? (
            <Pressable style={styles.primary} onPress={() => router.replace(`/putaway/receipt/${done.receiptId}`)} accessibilityRole="button">
              <Text style={styles.primaryText}>Cất hàng lên kệ ngay</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.secondary} onPress={() => router.replace('/transfer-receiving')} accessibilityRole="button">
            <Text style={styles.secondaryText}>Về danh sách</Text>
          </Pressable>
        </View>
      </>
    );
  }

  if (isLoading && !row) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!row) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Nhận điều chuyển' }} />
        <View style={styles.center}>
          <Text style={styles.error}>{error ?? 'Phiếu này không còn chờ nhận (đã được nhận hoặc không thuộc kho của bạn).'}</Text>
          <Pressable style={styles.secondary} onPress={() => router.replace('/transfer-receiving')} accessibilityRole="button">
            <Text style={styles.secondaryText}>Về danh sách</Text>
          </Pressable>
        </View>
      </>
    );
  }

  const transfer = row.item;
  const mine = transfer.received_by_user_id === user?.id;
  const assignedToOther = Boolean(transfer.received_by_user_id) && !mine;
  const canConfirm = mine || isWarehouseManager(user);

  function handleScan(value: string) {
    if (matchesCode([transfer.transfer_number], value)) {
      notifyScanSuccess();
      setVerified(true);
      setScanMessage({ text: 'Đúng kiện hàng của phiếu này.', ok: true });
    } else {
      notifyScanError();
      setVerified(false);
      setScanMessage({ text: `Mã không khớp. Cần quét mã ${transfer.transfer_number} trên kiện.`, ok: false });
    }
  }

  async function handleClaim() {
    await lock.run(async () => {
      setBusy('claim');
      try {
        await transferApi.claimTransferReceiving(transfer.id);
        await reload();
      } catch (err) {
        Alert.alert('Không nhận được việc', err instanceof ApiError ? err.message : 'Vui lòng thử lại.');
        await reload();
      } finally {
        setBusy(null);
      }
    });
  }

  async function confirmNow() {
    await lock.run(async () => {
      setBusy('confirm');
      try {
        const result = await transferApi.confirmTransferReceiving(transfer.id);
        notifyScanSuccess();
        setDone({ receiptId: result.data.goods_receipt_id, receiptNumber: result.data.goods_receipt_number });
      } catch (err) {
        if (isOutcomeUnknown(err)) {
          // Confirm is idempotent on the server: asking again returns the same receipt
          // if the first one landed, so retrying is safe here.
          Alert.alert('Chưa rõ đã xác nhận được chưa', 'Kết nối bị gián đoạn. Nhấn xác nhận lần nữa để kiểm tra — hệ thống không nhập trùng.');
        } else {
          Alert.alert('Không xác nhận được', err instanceof ApiError ? err.message : 'Vui lòng thử lại.');
          await reload();
        }
      } finally {
        setBusy(null);
      }
    });
  }

  function handleConfirm() {
    Alert.alert(
      'Xác nhận đã nhận đủ hàng?',
      `Toàn bộ ${transfer.total_quantity > 0 ? `${transfer.total_quantity} sản phẩm` : 'hàng'} của phiếu ${transfer.transfer_number} sẽ được nhập vào khu chờ cất. Nếu thiếu hoặc hư hỏng, hãy báo cáo sự cố trước.`,
      [
        { text: 'Kiểm tra lại', style: 'cancel' },
        { text: 'Xác nhận', onPress: () => void confirmNow() },
      ],
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: transfer.transfer_number }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.title}>{transfer.transfer_number}</Text>
          <Text style={styles.meta}>
            Từ {transfer.from_warehouse_name ?? transfer.from_warehouse_code ?? '?'} → {transfer.to_warehouse_name ?? transfer.to_warehouse_code ?? '?'}
          </Text>
          {transfer.total_quantity > 0 ? <Text style={styles.meta}>{transfer.total_quantity} sản phẩm đã gửi</Text> : null}
          {assignedToOther ? <StampBadge text="Phiếu đang giao cho nhân viên khác." tone="warning" /> : null}
        </View>

        {!transfer.received_by_user_id ? (
          <View style={styles.card}>
            <Text style={styles.step}>1. Nhận việc</Text>
            <Text style={styles.meta}>Nhận phiếu để người khác không xử lý trùng.</Text>
            <Pressable style={styles.primary} onPress={handleClaim} disabled={busy !== null} accessibilityRole="button">
              {busy === 'claim' ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primaryText}>Nhận việc này</Text>}
            </Pressable>
          </View>
        ) : null}

        {canConfirm ? (
          <>
            <View style={styles.card}>
              <Text style={styles.step}>{transfer.received_by_user_id ? '1' : '2'}. Quét mã trên kiện hàng</Text>
              <ScanField value={scanInput} onChangeText={setScanInput} onSubmit={handleScan} placeholder="Quét hoặc nhập mã phiếu điều chuyển" autoFocus />
              {scanMessage ? <StampBadge text={scanMessage.text} tone={scanMessage.ok ? 'success' : 'danger'} /> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.step}>{transfer.received_by_user_id ? '2' : '3'}. Xác nhận nhận hàng</Text>
              <Pressable
                style={[styles.confirm, (!verified || busy !== null) && styles.disabled]}
                onPress={handleConfirm}
                disabled={!verified || busy !== null}
                accessibilityRole="button"
                accessibilityState={{ disabled: !verified || busy !== null }}
              >
                {busy === 'confirm' ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primaryText}>Đã nhận đủ hàng</Text>}
              </Pressable>
              <Pressable style={styles.secondary} onPress={() => router.push('/exceptions/new')} accessibilityRole="button">
                <Text style={styles.secondaryText}>Thiếu / hư hỏng? Báo cáo sự cố</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md, backgroundColor: colors.bg },
  card: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.sm, ...shadow.card },
  title: { ...typography.h3 },
  meta: { ...typography.caption },
  step: { ...typography.bodyBold },
  body: { ...typography.body, textAlign: 'center' },
  error: { color: colors.danger, textAlign: 'center' },
  primary: { minHeight: 48, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  confirm: { minHeight: 52, borderRadius: radius.md, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: fonts.displayBold, color: colors.onPrimary, fontSize: 15 },
  secondary: { minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  secondaryText: { fontFamily: fonts.bodySemibold, color: colors.textSecondary },
  disabled: { opacity: 0.5 },
});
