import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Text, View } from 'react-native';

import * as transferApi from '../../src/api/transferReceiving';
import { isOutcomeUnknown } from '../../src/api/client';
import { ApiError, useAuth } from '../../src/auth/auth-context';
import { isWarehouseManager } from '../../src/auth/access';
import { ScanStep } from '../../src/components/ScanStep';
import { StampBadge } from '../../src/components/StampBadge';
import { useTransferReceiving } from '../../src/hooks/useTransferReceiving';
import { useSubmitLock } from '../../src/lib/submitLock';
import { matchesCode } from '../../src/scanner/matching';
import { notifyScanError, notifyScanSuccess } from '../../src/scanner/haptics';
import { ScanField } from '../../src/scanner/ScanField';
import { Button, Card, EmptyState, ErrorState, InfoRow, LoadingState, Screen, ScreenHeader, fontFamily, space, useTheme } from '../../src/design-system';

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
  const { colors } = useTheme();

  if (done) {
    return (
      <>
        <ScreenHeader title="Đã nhận hàng" />
        <Screen scroll={false}>
          <EmptyState
            icon="checkmark-done-circle"
            title="Đã xác nhận nhận hàng"
            message={`Hàng đã vào khu chờ cất của kho${done.receiptNumber ? ` (phiếu nhập ${done.receiptNumber})` : ''}. Bước tiếp theo là cất lên kệ.`}
          />
          <View style={{ gap: space.sm }}>
            {done.receiptId ? (
              <Button label="Cất hàng lên kệ ngay" icon="arrow-forward" onPress={() => router.replace(`/putaway/receipt/${done.receiptId}`)} />
            ) : null}
            <Button label="Về danh sách" variant="secondary" onPress={() => router.replace('/transfer-receiving')} />
          </View>
        </Screen>
      </>
    );
  }

  if (isLoading && !row) {
    return (<><ScreenHeader title="Nhận điều chuyển" /><Screen scroll={false}><LoadingState label="Đang mở phiếu…" /></Screen></>);
  }

  if (!row) {
    return (
      <>
        <ScreenHeader title="Nhận điều chuyển" />
        <Screen scroll={false}>
          <ErrorState
            title="Không mở được phiếu"
            message={error ?? 'Phiếu này không còn chờ nhận (đã được nhận hoặc không thuộc kho của bạn).'}
          />
          <Button label="Về danh sách" variant="secondary" onPress={() => router.replace('/transfer-receiving')} />
        </Screen>
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

  const claimed = Boolean(transfer.received_by_user_id);

  return (
    <>
      <ScreenHeader title={transfer.transfer_number} />
      <Screen>
        <Card>
          <Text selectable style={{ fontFamily: fontFamily.monoBold, fontSize: 20, color: colors.textPrimary }}>{transfer.transfer_number}</Text>
          <InfoRow label="Từ kho" value={transfer.from_warehouse_name ?? transfer.from_warehouse_code ?? '?'} />
          <InfoRow label="Đến kho" value={transfer.to_warehouse_name ?? transfer.to_warehouse_code ?? '?'} />
          {transfer.total_quantity > 0 ? <InfoRow label="Đã gửi" value={`${transfer.total_quantity} sản phẩm`} /> : null}
        </Card>
        {assignedToOther ? <StampBadge text="Phiếu đang giao cho nhân viên khác." tone="warning" /> : null}

        {!claimed ? (
          <ScanStep n={1} title="Nhận việc" done={false} caption="Nhận phiếu để người khác không xử lý trùng.">
            <Button label="Nhận việc này" icon="hand-left-outline" loading={busy === 'claim'} loadingLabel="Đang nhận…" disabled={busy !== null} onPress={handleClaim} />
          </ScanStep>
        ) : null}

        {canConfirm ? (
          <>
            <ScanStep n={claimed ? 1 : 2} title="Quét mã trên kiện hàng" done={verified}>
              <ScanField value={scanInput} onChangeText={setScanInput} onSubmit={handleScan} placeholder="Quét hoặc nhập mã phiếu điều chuyển" autoFocus />
              {scanMessage ? <StampBadge text={scanMessage.text} tone={scanMessage.ok ? 'success' : 'danger'} /> : null}
            </ScanStep>

            <ScanStep n={claimed ? 2 : 3} title="Xác nhận nhận hàng" done={false} caption={verified ? undefined : 'Quét đúng mã kiện trước khi xác nhận.'}>
              <Button
                label="Đã nhận đủ hàng"
                icon="checkmark-circle"
                loading={busy === 'confirm'}
                loadingLabel="Đang xác nhận…"
                disabled={!verified || busy !== null}
                onPress={handleConfirm}
              />
              <Button label="Thiếu hoặc hư hỏng? Báo cáo sự cố" icon="warning-outline" variant="ghost" onPress={() => router.push('/exceptions/new')} />
            </ScanStep>
          </>
        ) : null}
      </Screen>
    </>
  );
}
