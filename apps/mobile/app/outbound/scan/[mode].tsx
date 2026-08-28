import { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import * as outboundApi from '../../../src/api/outbound';
import { ApiError } from '../../../src/auth/auth-context';
import {
  SESSION_SCAN_CAP,
  createSession,
  saveSession,
  successCount,
  type OutboundSession,
  type ScanAttempt,
} from '../../../src/lib/outboundSession';
import { resolveScannedCode, type OutboundMode } from '../../../src/lib/outboundScan';
import { notifyScanError, notifyScanSuccess } from '../../../src/scanner/haptics';
import { ScanField } from '../../../src/scanner/ScanField';
import { colors, radius, spacing, typography } from '../../../src/theme/tokens';

const MODE_LABEL: Record<OutboundMode, string> = {
  outbound: 'Xuất kho',
  transfer: 'Điều chuyển kho',
};

export default function OutboundScanSessionScreen() {
  const { mode: rawMode } = useLocalSearchParams<{ mode: string }>();
  const mode: OutboundMode = rawMode === 'transfer' ? 'transfer' : 'outbound';

  const [session, setSession] = useState<OutboundSession>(() => createSession(mode));
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const finalizedRef = useRef(false);

  const [scanInput, setScanInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Persist as soon as the session starts so it shows up in history even if the
  // app is killed mid-session, then finalize (set ended_at) on unmount if the
  // user backs out instead of tapping "Kết thúc phiên" or hitting the 50 cap.
  useEffect(() => {
    saveSession(sessionRef.current).catch(() => {});
    return () => {
      if (!finalizedRef.current) {
        saveSession({ ...sessionRef.current, ended_at: new Date().toISOString() }).catch(() => {});
      }
    };
  }, []);

  const finishSession = useCallback((finalSession: OutboundSession, message: string) => {
    finalizedRef.current = true;
    saveSession(finalSession)
      .catch(() => {})
      .finally(() => {
        Alert.alert('Đã kết thúc phiên', message, [{ text: 'OK', onPress: () => router.replace('/outbound') }]);
      });
  }, []);

  async function handleScanSubmit(value: string) {
    const code = value.trim();
    if (!code || isProcessing) return;

    setIsProcessing(true);
    let attempt: ScanAttempt;
    try {
      const [available, mine] = await Promise.all([outboundApi.getAvailableTasks(), outboundApi.getMyTasks()]);
      const resolved = resolveScannedCode(code, mode, available.data, mine.data);

      if (resolved.kind === 'not-found') {
        attempt = { code, success: false, message: 'Không tìm thấy đơn với mã này', order_number: null, timestamp: new Date().toISOString() };
      } else if (resolved.kind === 'wrong-mode') {
        attempt = {
          code,
          success: false,
          message: `Mã này thuộc "${MODE_LABEL[resolved.correctMode]}" — chuyển chế độ để quét`,
          order_number: null,
          timestamp: new Date().toISOString(),
        };
      } else {
        if (resolved.kind === 'claim-then-confirm') {
          await outboundApi.claimSelf(resolved.claimEndpoint);
        }
        const result = await outboundApi.confirmOutbound(resolved.taskType, resolved.taskId, code);
        attempt = {
          code,
          success: true,
          message: `Đã xác nhận ${result.data.status === 'COMPLETED' ? 'xuất kho' : 'điều chuyển'}: ${resolved.orderNumber}`,
          order_number: resolved.orderNumber,
          timestamp: new Date().toISOString(),
        };
      }
    } catch (err) {
      attempt = {
        code,
        success: false,
        message: err instanceof ApiError ? err.message : 'Xử lý thất bại, vui lòng thử lại',
        order_number: null,
        timestamp: new Date().toISOString(),
      };
    }

    if (attempt.success) notifyScanSuccess();
    else notifyScanError();

    const nextSession: OutboundSession = { ...sessionRef.current, attempts: [...sessionRef.current.attempts, attempt] };
    setSession(nextSession);
    saveSession(nextSession).catch(() => {});
    setScanInput('');
    setIsProcessing(false);

    if (successCount(nextSession) >= SESSION_SCAN_CAP) {
      finishSession(
        { ...nextSession, ended_at: new Date().toISOString() },
        `Đã quét đủ ${SESSION_SCAN_CAP} kiện hàng. Bắt đầu phiên mới để tiếp tục.`,
      );
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
      <Stack.Screen options={{ headerShown: true, title: MODE_LABEL[mode] }} />
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerText}>
            Đã quét: {count}/{SESSION_SCAN_CAP} kiện
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${(count / SESSION_SCAN_CAP) * 100}%` }]} />
          </View>
        </View>

        <View style={styles.scanBox}>
          <ScanField
            value={scanInput}
            onChangeText={setScanInput}
            onSubmit={handleScanSubmit}
            placeholder={`Quét hoặc nhập mã ${mode === 'outbound' ? 'đơn xuất kho' : 'điều chuyển kho'}`}
            autoFocus
            editable={!isProcessing}
          />
          {isProcessing ? <ActivityIndicator color={colors.primary} style={styles.spinner} /> : null}
        </View>

        <FlatList
          data={[...session.attempts].reverse()}
          keyExtractor={(_, index) => String(session.attempts.length - index)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>Chưa quét kiện nào trong phiên này</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={item.success ? styles.rowTitleOk : styles.rowTitleFail}>{item.code}</Text>
              <Text style={item.success ? styles.rowMessageOk : styles.rowMessageFail}>{item.message}</Text>
            </View>
          )}
        />

        <Pressable style={({ pressed }) => [styles.endButton, pressed && styles.buttonPressed]} onPress={handleEndSession}>
          <Text style={styles.endButtonText}>Kết thúc phiên</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    padding: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  headerText: {
    ...typography.caption,
    fontWeight: '700',
  },
  progressTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  scanBox: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.xs + 2,
  },
  spinner: {
    marginTop: spacing.xs,
  },
  list: {
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    padding: spacing.lg,
  },
  row: {
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowTitleOk: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
  rowTitleFail: {
    fontWeight: '700',
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  rowMessageOk: {
    color: colors.success,
    fontSize: 12,
    marginTop: 2,
  },
  rowMessageFail: {
    color: colors.danger,
    fontSize: 12,
    marginTop: 2,
  },
  endButton: {
    margin: spacing.lg,
    backgroundColor: colors.neutral,
    borderRadius: radius.md,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  endButtonText: {
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 16,
  },
});
