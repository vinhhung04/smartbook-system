import { useCallback, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Alert, Text, View } from 'react-native';

import * as pickingApi from '../../../../src/api/picking';
import { ApiError, useAuth } from '../../../../src/auth/auth-context';
import { notifyScanError, notifyScanSuccess } from '../../../../src/scanner/haptics';
import { ScanField } from '../../../../src/scanner/ScanField';
import { useSubmitLock } from '../../../../src/lib/submitLock';
import type { PickingTaskDetail, PickingTaskType } from '../../../../src/types/picking';
import {
  Button, Card, ErrorState, InlineAlert, LoadingState, ProgressBar, Screen, ScreenHeader, SectionHeader, StatusBadge, StepIndicator, fontFamily, radii, space, useTheme,
} from '../../../../src/design-system';

const STEPS = ['Nhận phiếu', 'Lấy hàng', 'Hoàn tất'];

export default function TaskDetailScreen() {
  const { taskType, taskId } = useLocalSearchParams<{ taskType: PickingTaskType; taskId: string }>();
  const { user } = useAuth();
  const { colors, type } = useTheme();
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
  const [isDeclaringShortage, setIsDeclaringShortage] = useState(false);
  const actionLock = useSubmitLock();

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

  // useFocusEffect (not a plain mount-only useEffect) — this screen stays mounted
  // underneath /picking/[taskType]/[taskId]/scan while the user is there confirming a
  // line, so coming back here after a partial pick used to show stale picked_qty (still
  // 0/N) and hide "Khai báo thiếu hàng" until the screen was fully remounted from scratch.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setIsLoading(true);
      load().finally(() => {
        if (!cancelled) setIsLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  async function handleConfirmPresence(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    await actionLock.run(async () => {
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
    });
  }

  async function declareShortage() {
    await actionLock.run(async () => {
      setIsDeclaringShortage(true);
      try {
        const result = await pickingApi.declareShortage(taskType, taskId);
        Alert.alert(
          'Đã khai báo thiếu hàng',
          result.data?.order_number
            ? `Đã tạo REPICK ${result.data.order_number} — nhân viên khác có thể nhận và lấy bù.`
            : 'Đã tạo REPICK để lấy bù phần còn thiếu.',
          [{ text: 'OK', onPress: () => router.replace('/picking') }],
        );
      } catch (err) {
        Alert.alert('Khai báo thiếu hàng thất bại', err instanceof ApiError ? err.message : 'Vui lòng thử lại');
      } finally {
        setIsDeclaringShortage(false);
      }
    });
  }

  function handleDeclareShortage() {
    Alert.alert(
      'Khai báo thiếu hàng?',
      'Hệ thống sẽ tạo đơn REPICK để lấy bù phần còn thiếu — nhân viên khác cũng có thể nhận đơn REPICK này.',
      [
        { text: 'Hủy', style: 'cancel' },
        { text: 'Xác nhận', style: 'destructive', onPress: () => void declareShortage() },
      ],
    );
  }

  if (isLoading) {
    return (<><ScreenHeader title="Phiếu lấy hàng" /><Screen scroll={false}><LoadingState label="Đang mở phiếu…" /></Screen></>);
  }

  if (error) {
    return (<><ScreenHeader title="Phiếu lấy hàng" /><Screen scroll={false}><ErrorState message={error} onRetry={() => { setIsLoading(true); void load().finally(() => setIsLoading(false)); }} /></Screen></>);
  }

  if (needsClaim) {
    return (
      <>
        <ScreenHeader title="Nhận phiếu" />
        <Screen>
          <StepIndicator steps={STEPS} current={0} />
          <View style={{ gap: space.sm }}>
            <Text style={type.title} accessibilityRole="header">Xác nhận vị trí để bắt đầu</Text>
            <Text style={type.body}>Quét hoặc nhập mã vị trí kệ bạn đang đứng. Phiếu được giao cho bạn ngay sau bước này.</Text>
          </View>
          <ScanField
            value={locationInput}
            onChangeText={setLocationInput}
            onSubmit={handleConfirmPresence}
            placeholder="Mã vị trí kệ"
            autoFocus
            editable={!isConfirmingPresence}
          />
          {isConfirmingPresence ? <LoadingState label="Đang xác nhận vị trí…" /> : null}
          {presenceMessage ? <InlineAlert message={presenceMessage} /> : null}
        </Screen>
      </>
    );
  }

  if (!task) {
    return (<><ScreenHeader title="Phiếu lấy hàng" /><Screen scroll={false}><ErrorState title="Không tìm thấy phiếu" onRetry={() => router.replace('/picking')} /></Screen></>);
  }

  const totalPickedQty = task.lines.reduce((sum, l) => sum + l.picked_qty, 0);
  const totalRequestedQty = task.lines.reduce((sum, l) => sum + l.requested_qty, 0);
  const canDeclareShortage = totalPickedQty > 0 && task.lines.some((l) => l.remaining_qty > 0);
  const current = task.current_line;

  return (
    <>
      <ScreenHeader title={task.order_number} />
      <Screen
        footer={current ? (
          <Button label="Bắt đầu quét lấy hàng" icon="scan" onPress={() => router.push(`/picking/${taskType}/${taskId}/scan`)} />
        ) : (
          <Button label="Về danh sách phiếu" variant="secondary" icon="list" onPress={() => router.replace('/picking')} />
        )}
      >
        <StepIndicator steps={STEPS} current={current ? 1 : 2} />

        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <StatusBadge tone="neutral" label={`Kho ${task.source_warehouse_code ?? '—'}`} icon="business-outline" />
            <StatusBadge tone={task.remaining_line_count > 0 ? 'primary' : 'success'} label={`Còn ${task.remaining_line_count} dòng`} icon={task.remaining_line_count > 0 ? 'list' : 'checkmark-circle'} />
            {task.task_class === 'REPICK' ? (
              <StatusBadge tone="warning" icon="repeat" label={`Lấy bù${task.repick_sequence ? ` lần ${task.repick_sequence}` : ''}${task.parent_order_number ? `, gốc ${task.parent_order_number}` : ''}`} />
            ) : null}
          </View>
          <View style={{ gap: 6 }}>
            <ProgressBar value={totalRequestedQty > 0 ? totalPickedQty / totalRequestedQty : 0} tone={current ? 'primary' : 'success'} accessibilityLabel="Tiến độ lấy hàng" />
            <Text style={type.caption}>Đã lấy {totalPickedQty}/{totalRequestedQty} sản phẩm</Text>
          </View>
        </View>

        {current ? (
          // Where to walk, then what to pick: the location is the loudest thing on screen.
          <View style={{ padding: space.lg, gap: space.md, borderRadius: radii.md, backgroundColor: colors.inkField }}>
            <Text style={{ fontFamily: fontFamily.medium, fontSize: 13.5, color: colors.onInkMuted }}>Đến vị trí</Text>
            <Text selectable style={{ fontFamily: fontFamily.monoBold, fontSize: 30, lineHeight: 36, color: colors.onInk, letterSpacing: 1 }}>
              {current.source_location_code ?? '—'}
            </Text>
            <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.14)' }} />
            <Text style={{ fontFamily: fontFamily.semibold, fontSize: 17, lineHeight: 23, color: colors.onInk }}>{current.book_title}</Text>
            <Text selectable style={{ fontFamily: fontFamily.mono, fontSize: 14, color: colors.onInkMuted }}>
              SKU {current.sku ?? '—'}  ·  Mã {current.barcode ?? '—'}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
              <Text style={{ fontFamily: fontFamily.bold, fontSize: 30, color: '#F6DFB4', fontVariant: ['tabular-nums'] }}>{current.remaining_qty}</Text>
              <Text style={{ fontFamily: fontFamily.medium, fontSize: 15, color: colors.onInkMuted }}>cần lấy, trên {current.requested_qty}</Text>
            </View>
          </View>
        ) : (
          <InlineAlert tone="success" title="Đã lấy xong" message="Tất cả sản phẩm trong phiếu này đã được lấy." />
        )}

        <View style={{ gap: space.md }}>
          <SectionHeader title="Toàn bộ danh sách" caption={`${task.lines.length} dòng`} />
          <Card padded={false}>
            {task.lines.map((line, index) => {
              const done = line.remaining_qty === 0;
              return (
                <View
                  key={line.line_id}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderTopWidth: index > 0 ? 1 : 0, borderTopColor: colors.border }}
                  accessible
                  accessibilityLabel={`${line.book_title}, đã lấy ${line.picked_qty} trên ${line.requested_qty}${done ? ', xong' : ''}`}
                >
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ fontFamily: fontFamily.medium, fontSize: 15, lineHeight: 21, color: done ? colors.textMuted : colors.textPrimary }} numberOfLines={2}>{line.book_title}</Text>
                    {done ? <StatusBadge tone="success" label="Xong" /> : null}
                  </View>
                  <Text style={{ fontFamily: fontFamily.bold, fontSize: 17, color: done ? colors.success : colors.textPrimary, fontVariant: ['tabular-nums'] }}>
                    {line.picked_qty}/{line.requested_qty}
                  </Text>
                </View>
              );
            })}
          </Card>
        </View>

        {canDeclareShortage ? (
          <View style={{ gap: space.sm }}>
            <Text style={type.caption}>Kệ không đủ hàng? Khai báo thiếu để hệ thống tạo phiếu lấy bù cho phần còn lại.</Text>
            <Button label="Khai báo thiếu hàng, tạo phiếu lấy bù" icon="alert-circle-outline" variant="secondary" loading={isDeclaringShortage} loadingLabel="Đang khai báo…" onPress={handleDeclareShortage} />
          </View>
        ) : null}
      </Screen>
    </>
  );
}
