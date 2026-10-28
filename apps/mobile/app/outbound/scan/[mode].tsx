import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, FlatList, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import * as outboundApi from '../../../src/api/outbound';
import { isOutcomeUnknown } from '../../../src/api/client';
import { ApiError, useAuth } from '../../../src/auth/auth-context';
import {
  SESSION_SCAN_CAP,
  alreadyConfirmedInSession,
  createSession,
  saveSession,
  successCount,
  type OutboundSession,
  type ScanAttempt,
} from '../../../src/lib/outboundSession';
import { canConfirmOutbound } from '../../../src/lib/outboundRules';
import { resolveScannedCode, type OutboundMode } from '../../../src/lib/outboundScan';
import { notifyScanError, notifyScanSuccess } from '../../../src/scanner/haptics';
import { ScanField } from '../../../src/scanner/ScanField';
import { ChecklistMeter } from '../../../src/components/ChecklistMeter';
import { BottomActionBar, Button, EmptyState, LoadingState, ScreenHeader, fontFamily, radii, space, useTheme } from '../../../src/design-system';

const MODE_LABEL: Record<OutboundMode, string> = {
  outbound: 'Xuất kho',
  transfer: 'Điều chuyển kho',
};

export default function OutboundScanSessionScreen() {
  const { mode: rawMode } = useLocalSearchParams<{ mode: string }>();
  const mode: OutboundMode = rawMode === 'transfer' ? 'transfer' : 'outbound';
  const { user } = useAuth();
  const userId = user?.id ?? 'anonymous';
  const { colors, type } = useTheme();
  // Synchronous guard: the scanner's Enter can fire twice before isProcessing re-renders.
  const processingRef = useRef(false);

  const [session, setSession] = useState<OutboundSession>(() => createSession(mode));
  const sessionRef = useRef(session);
  const finalizedRef = useRef(false);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const [scanInput, setScanInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Persist as soon as the session starts so it shows up in history even if the
  // app is killed mid-session, then finalize (set ended_at) on unmount if the
  // user backs out instead of tapping "Kết thúc phiên" or hitting the 50 cap.
  useEffect(() => {
    saveSession(userId, sessionRef.current).catch(() => {});
    return () => {
      if (!finalizedRef.current) {
        saveSession(userId, { ...sessionRef.current, ended_at: new Date().toISOString() }).catch(() => {});
      }
    };
  }, [userId]);

  const finishSession = useCallback((finalSession: OutboundSession, message: string) => {
    finalizedRef.current = true;
    saveSession(userId, finalSession)
      .catch(() => {})
      .finally(() => {
        Alert.alert('Đã kết thúc phiên', message, [{ text: 'OK', onPress: () => router.replace('/outbound') }]);
      });
  }, [userId]);

  async function handleScanSubmit(value: string) {
    const code = value.trim();
    if (!code || processingRef.current) return;

    processingRef.current = true;
    setIsProcessing(true);
    let attempt: ScanAttempt;
    let pending: { taskType: OutboundMode; taskId: string; orderNumber: string } | null = null;
    try {
      const [available, mine] = await Promise.all([outboundApi.getAvailableTasks(), outboundApi.getMyTasks()]);
      const resolved = resolveScannedCode(code, mode, available.data, mine.data);

      if (resolved.kind === 'not-found') {
        attempt = { code, success: false, message: 'Không có đơn đang chờ xuất với mã này (đơn có thể đã được xuất kho)', order_number: null, timestamp: new Date().toISOString() };
      } else if (resolved.kind === 'wrong-mode') {
        attempt = {
          code,
          success: false,
          message: `Mã này thuộc "${MODE_LABEL[resolved.correctMode]}" — chuyển chế độ để quét`,
          order_number: null,
          timestamp: new Date().toISOString(),
        };
      } else if (alreadyConfirmedInSession(sessionRef.current, resolved.orderNumber)) {
        attempt = {
          code,
          success: false,
          message: `Đơn ${resolved.orderNumber} đã được xác nhận trong phiên này — không xác nhận lại.`,
          order_number: resolved.orderNumber,
          timestamp: new Date().toISOString(),
        };
      } else {
        // A REPICKING order may already have a fully-picked repick chain — the list
        // data alone doesn't carry aggregate_remaining_qty, so that one status needs
        // an extra lookup before deciding readiness. Every other status is judged
        // from the list data already in hand.
        const ready =
          resolved.status === 'REPICKING'
            ? await outboundApi
                .getOrderStatusDetail(resolved.taskType, resolved.taskId)
                .then((detail) => canConfirmOutbound(detail.status, detail.aggregate_remaining_qty))
            : canConfirmOutbound(resolved.status);

        if (!ready) {
          attempt = {
            code,
            success: false,
            message:
              resolved.status === 'REPICKING'
                ? `Đơn ${resolved.orderNumber} đang lấy bù (REPICK), chưa lấy đủ hàng`
                : `Đơn ${resolved.orderNumber} chưa sẵn sàng xuất kho (trạng thái: ${resolved.status})`,
            order_number: resolved.orderNumber,
            timestamp: new Date().toISOString(),
          };
        } else {
          if (resolved.kind === 'claim-then-confirm') {
            await outboundApi.claimSelf(resolved.taskType, resolved.taskId);
          }
          pending = { taskType: resolved.taskType, taskId: resolved.taskId, orderNumber: resolved.orderNumber };
          const result = await outboundApi.confirmOutbound(resolved.taskType, resolved.taskId, code);
          attempt = {
            code,
            success: true,
            message: `Đã xác nhận ${result.data.status === 'COMPLETED' ? 'xuất kho' : 'điều chuyển'}: ${resolved.orderNumber}`,
            order_number: resolved.orderNumber,
            timestamp: new Date().toISOString(),
          };
        }
      }
    } catch (err) {
      if (pending && isOutcomeUnknown(err)) {
        // The confirm may have gone through. Ask the server instead of reporting a
        // failure (which invites a second confirm) or a success it never confirmed.
        attempt = await recheckAfterUnknown(code, pending);
      } else {
        attempt = {
          code,
          success: false,
          message: err instanceof ApiError ? err.message : 'Xử lý thất bại, vui lòng thử lại',
          order_number: pending?.orderNumber ?? null,
          timestamp: new Date().toISOString(),
        };
      }
    }

    if (attempt.success) notifyScanSuccess();
    else notifyScanError();

    const nextSession: OutboundSession = { ...sessionRef.current, attempts: [...sessionRef.current.attempts, attempt] };
    sessionRef.current = nextSession;
    setSession(nextSession);
    saveSession(userId, nextSession).catch(() => {});
    setScanInput('');
    processingRef.current = false;
    setIsProcessing(false);

    if (successCount(nextSession) >= SESSION_SCAN_CAP) {
      finishSession(
        { ...nextSession, ended_at: new Date().toISOString() },
        `Đã quét đủ ${SESSION_SCAN_CAP} kiện hàng. Bắt đầu phiên mới để tiếp tục.`,
      );
    }
  }

  async function recheckAfterUnknown(code: string, task: { taskType: OutboundMode; taskId: string; orderNumber: string }): Promise<ScanAttempt> {
    const timestamp = new Date().toISOString();
    try {
      const detail = await outboundApi.getOrderStatusDetail(task.taskType, task.taskId);
      const done = ['COMPLETED', 'SHIPPED', 'IN_TRANSIT', 'RECEIVED'].includes(detail.status);
      return done
        ? { code, success: true, uncertain: true, message: `Mất kết nối nhưng máy chủ đã ghi nhận: ${task.orderNumber} (${detail.status}).`, order_number: task.orderNumber, timestamp }
        : { code, success: false, uncertain: true, message: `Mất kết nối — đơn ${task.orderNumber} chưa được xác nhận (trạng thái ${detail.status}). Có thể quét lại.`, order_number: task.orderNumber, timestamp };
    } catch {
      return {
        code,
        success: false,
        uncertain: true,
        message: `Chưa rõ đơn ${task.orderNumber} đã xuất kho chưa (mất kết nối). Kiểm tra lại trước khi quét lại.`,
        order_number: task.orderNumber,
        timestamp,
      };
    }
  }

  function handleEndSession() {
    Alert.alert('Kết thúc phiên?', `Đã quét ${successCount(session)}/${SESSION_SCAN_CAP} kiện.`, [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Kết thúc',
        style: 'destructive',
        onPress: () => finishSession({ ...sessionRef.current, ended_at: new Date().toISOString() }, 'Phiên đã được lưu vào lịch sử.'),
      },
    ]);
  }

  const count = successCount(session);

  return (
    <>
      <ScreenHeader title={MODE_LABEL[mode]} />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ padding: space.lg, gap: space.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }} accessible accessibilityLabel={`Đã quét ${count} trên ${SESSION_SCAN_CAP} kiện`}>
            <Text style={{ fontFamily: fontFamily.bold, fontSize: 34, color: colors.textPrimary, fontVariant: ['tabular-nums'] }}>{count}</Text>
            <Text style={type.body}>/{SESSION_SCAN_CAP} kiện đã xác nhận</Text>
          </View>
          <ChecklistMeter value={count} max={SESSION_SCAN_CAP} />
          <ScanField
            value={scanInput}
            onChangeText={setScanInput}
            onSubmit={handleScanSubmit}
            placeholder={`Quét hoặc nhập mã ${mode === 'outbound' ? 'đơn xuất kho' : 'điều chuyển kho'}`}
            autoFocus
            editable={!isProcessing}
          />
          {isProcessing ? <LoadingState label="Đang kiểm tra đơn…" /> : null}
        </View>

        <FlatList
          data={[...session.attempts].reverse()}
          keyExtractor={(_, index) => String(session.attempts.length - index)}
          contentContainerStyle={{ padding: space.lg, paddingBottom: 140, gap: space.sm }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<EmptyState icon="scan-outline" title="Chưa quét kiện nào" message="Quét mã trên đơn hoặc kiện hàng để xác nhận xuất." compact />}
          renderItem={({ item, index }) => {
            const tone = item.success ? colors.success : item.uncertain ? colors.warning : colors.danger;
            const latest = index === 0;
            return (
              <View
                style={{
                  flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.md, borderRadius: radii.sm,
                  backgroundColor: latest ? (item.success ? colors.successSoft : item.uncertain ? colors.warningSoft : colors.dangerSoft) : colors.surface,
                  borderWidth: 1, borderColor: latest ? tone : colors.border,
                }}
                accessible
                accessibilityLabel={`${item.success ? 'Thành công' : item.uncertain ? 'Chưa rõ' : 'Lỗi'}, mã ${item.code}, ${item.message}`}
                accessibilityLiveRegion={latest ? 'polite' : 'none'}
              >
                <Ionicons name={item.success ? 'checkmark-circle' : item.uncertain ? 'help-circle' : 'close-circle'} size={22} color={tone} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text selectable style={{ fontFamily: fontFamily.monoBold, fontSize: 15, color: colors.textPrimary }}>{item.code}</Text>
                  <Text style={{ fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 20, color: colors.textSecondary }}>{item.message}</Text>
                </View>
              </View>
            );
          }}
        />

        <BottomActionBar>
          <Button label="Kết thúc phiên" icon="stop-circle-outline" variant="secondary" onPress={handleEndSession} />
        </BottomActionBar>
      </View>
    </>
  );
}
