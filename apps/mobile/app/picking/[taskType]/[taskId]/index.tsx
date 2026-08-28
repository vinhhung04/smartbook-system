import { useCallback, useEffect, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import * as pickingApi from '../../../../src/api/picking';
import { ApiError, useAuth } from '../../../../src/auth/auth-context';
import { notifyScanError, notifyScanSuccess } from '../../../../src/scanner/haptics';
import { ScanField } from '../../../../src/scanner/ScanField';
import type { PickingTaskDetail, PickingTaskType } from '../../../../src/types/picking';
import { colors, radius, shadow, spacing, typography } from '../../../../src/theme/tokens';

export default function TaskDetailScreen() {
  const { taskType, taskId } = useLocalSearchParams<{ taskType: PickingTaskType; taskId: string }>();
  const { user } = useAuth();
  const [task, setTask] = useState<PickingTaskDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Regular staff get a 403 from the detail endpoint until the task is assigned to
  // them. Managers/admins bypass that check entirely (canManageAssignment), so for
  // them a successful response can still describe a task assigned to someone else —
  // check assigned_picker_user_id explicitly rather than trusting a 200 alone.
  const [needsClaim, setNeedsClaim] = useState(false);

  const [locationInput, setLocationInput] = useState('');
  const [presenceMessage, setPresenceMessage] = useState<string | null>(null);
  const [isConfirmingPresence, setIsConfirmingPresence] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const detail = await pickingApi.getTaskDetail(taskType, taskId);
      if (detail.assigned_picker_user_id === user?.id) {
        setTask(detail);
        setNeedsClaim(false);
      } else {
        setNeedsClaim(true);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setNeedsClaim(true);
      } else {
        setError(err instanceof ApiError ? err.message : 'Không tải được phiếu');
      }
    }
  }, [taskType, taskId, user?.id]);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

  async function handleConfirmPresence(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setIsConfirmingPresence(true);
    setPresenceMessage(null);
    try {
      // Claiming happens here, not when the row was tapped — confirming a position
      // is what logically assigns the task to this picker.
      await pickingApi.claimSelf(taskType, taskId);
      const result = await pickingApi.confirmPresence(taskType, taskId, trimmed);
      notifyScanSuccess();
      setPresenceMessage(`Đã xác nhận vị trí: ${result.data.location_code}`);
      setLocationInput('');
      await load();
    } catch (err) {
      notifyScanError();
      setPresenceMessage(err instanceof ApiError ? err.message : 'Xác nhận vị trí thất bại');
    } finally {
      setIsConfirmingPresence(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  if (needsClaim) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Nhận phiếu' }} />
        <View style={styles.claimContainer}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Xác nhận vị trí để bắt đầu</Text>
            <Text style={styles.claimHint}>Quét hoặc nhập vị trí hiện tại của bạn — phiếu sẽ được gán cho bạn ngay sau bước này.</Text>
            <ScanField
              value={locationInput}
              onChangeText={setLocationInput}
              onSubmit={handleConfirmPresence}
              placeholder="Quét hoặc nhập mã vị trí kệ"
              autoFocus
              editable={!isConfirmingPresence}
            />
            {isConfirmingPresence ? <ActivityIndicator color={colors.primary} /> : null}
            {presenceMessage ? <Text style={styles.error}>{presenceMessage}</Text> : null}
          </View>
        </View>
      </>
    );
  }

  if (!task) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Không tìm thấy phiếu</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: task.order_number }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.warehouse}>
          Kho: {task.source_warehouse_code ?? '-'} · còn {task.remaining_line_count} dòng
        </Text>

        {task.current_line ? (
          <View style={styles.currentLineCard}>
            <Text style={styles.currentLineLabel}>Đang lấy</Text>
            <Text style={styles.bookTitle}>{task.current_line.book_title}</Text>
            <Text style={styles.lineDetail}>Mã vị trí: {task.current_line.source_location_code ?? '-'}</Text>
            <Text style={styles.lineDetail}>
              SKU: {task.current_line.sku ?? '-'} · Mã sản phẩm: {task.current_line.barcode ?? '-'}
            </Text>
            <Text style={styles.lineDetail}>
              Cần lấy: {task.current_line.remaining_qty} / {task.current_line.requested_qty}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.scanButton, pressed && styles.buttonPressed]}
              onPress={() => router.push(`/picking/${taskType}/${taskId}/scan`)}
            >
              <Text style={styles.scanButtonText}>Bắt đầu quét lấy hàng</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.doneBox}>
            <Text style={styles.done}>Đã lấy xong tất cả sản phẩm trong phiếu này.</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Toàn bộ danh sách</Text>
        <View style={styles.lineList}>
          {task.lines.map((line) => (
            <View key={line.line_id} style={styles.lineRow}>
              <Text style={line.remaining_qty === 0 ? styles.lineRowTitleDone : styles.lineRowTitle}>
                {line.book_title}
              </Text>
              <Text style={styles.lineRowQty}>
                {line.picked_qty}/{line.requested_qty}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  claimContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.bg,
  },
  error: {
    color: colors.danger,
    fontWeight: '600',
  },
  warehouse: {
    ...typography.caption,
  },
  sectionTitle: {
    ...typography.label,
  },
  card: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: spacing.sm,
    ...shadow.card,
  },
  claimHint: {
    ...typography.caption,
  },
  currentLineCard: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    gap: 4,
  },
  currentLineLabel: {
    ...typography.label,
    color: colors.primary,
  },
  bookTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 2,
  },
  lineDetail: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  scanButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.success,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  scanButtonText: {
    color: colors.onPrimary,
    fontWeight: '700',
  },
  doneBox: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  done: {
    color: colors.success,
    fontWeight: '600',
    textAlign: 'center',
  },
  lineList: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    ...shadow.card,
  },
  lineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lineRowTitle: {
    flex: 1,
    marginRight: spacing.sm,
    color: colors.textPrimary,
  },
  lineRowTitleDone: {
    flex: 1,
    marginRight: spacing.sm,
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  lineRowQty: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
});
