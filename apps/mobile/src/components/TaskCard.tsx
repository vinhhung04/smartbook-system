import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { TaskEntry } from '../hooks/useDashboardTasks';
import { PRIORITY_LABEL, TASK_TYPE_LABEL, type TaskPhase } from '../lib/taskRoutes';
import { PressableScale, StatusBadge, fontFamily, radii, space, useTheme, type IconName, type Tone } from '../design-system';

const TYPE_ICON: Record<string, IconName> = {
  PICKING: 'basket-outline',
  PUTAWAY: 'file-tray-stacked-outline',
  OUTBOUND: 'car-outline',
  TRANSFER_RECEIVING: 'swap-horizontal-outline',
  RECEIVING: 'download-outline',
  PURCHASE_REQUEST: 'cart-outline',
  EXCEPTION_REPORT: 'warning-outline',
  STAFF_TASK: 'clipboard-outline',
  STOCK_AUDIT: 'checkbox-outline',
};

// Each phase has its own icon as well as its colour, so status never relies on colour alone.
const PHASE: Record<TaskPhase, { icon: IconName; tone: Tone }> = {
  todo: { icon: 'ellipse-outline', tone: 'primary' },
  in_progress: { icon: 'time-outline', tone: 'warning' },
  waiting: { icon: 'hourglass-outline', tone: 'neutral' },
  done: { icon: 'checkmark-circle', tone: 'neutral' },
};

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

function dueInfo(iso: string | null | undefined, phase: TaskPhase): { text: string; overdue: boolean } | null {
  const label = formatDate(iso);
  if (!label || !iso) return null;
  const overdue = phase !== 'done' && new Date(iso).getTime() < Date.now();
  return { text: overdue ? `Quá hạn ${label}` : `Hạn ${label}`, overdue };
}

type Props = {
  entry: TaskEntry;
  onOpen: (entry: TaskEntry) => void;
  compact?: boolean;
};

/**
 * One task, readable in a glance while walking: what kind of work (icon + type),
 * which document (the title, usually its code), where, its state, how urgent,
 * and the next action in words. Done tasks fade back; overdue turns red with a
 * calendar icon, not by colour alone.
 */
export function TaskCard({ entry, onOpen, compact = false }: Props) {
  const { colors, type } = useTheme();
  const { task, phase, route, statusLabel } = entry;
  const phaseView = PHASE[phase];
  const priority = String(task.priority || '').toUpperCase();
  const showPriority = priority === 'HIGH' || priority === 'URGENT';
  const due = dueInfo(task.due_date, phase);
  const created = formatDate(task.created_at);
  const openable = route.kind === 'screen';
  const typeLabel = TASK_TYPE_LABEL[task.type] ?? task.type;
  const meta = [task.warehouse, created ? `tạo ${created}` : null].filter(Boolean).join(', ');
  const active = phase === 'todo' || phase === 'in_progress';

  return (
    <PressableScale
      onPress={() => onOpen(entry)}
      accessibilityRole="button"
      accessibilityLabel={`${typeLabel} ${task.title}, ${statusLabel}${showPriority ? `, ưu tiên ${PRIORITY_LABEL[priority]}` : ''}${due ? `, ${due.text}` : ''}`}
      accessibilityHint={openable ? route.cta : route.reason}
      style={{
        padding: space.lg, gap: space.md, borderRadius: radii.md, backgroundColor: colors.surface, opacity: phase === 'done' ? 0.7 : 1,
        borderWidth: 1, borderColor: showPriority && active ? colors.danger : colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
        <View style={{ width: 40, height: 40, borderRadius: radii.sm, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={TYPE_ICON[task.type] ?? 'document-outline'} size={20} color={colors.textPrimary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontFamily: fontFamily.semibold, fontSize: 13, color: colors.textSecondary }}>{typeLabel}</Text>
          <Text style={{ fontFamily: fontFamily.monoBold, fontSize: 15.5, lineHeight: 21, color: colors.textPrimary }} numberOfLines={2}>{task.title}</Text>
          {meta ? <Text style={type.caption} numberOfLines={1}>{meta}</Text> : null}
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <StatusBadge tone={phaseView.tone} label={statusLabel} icon={phaseView.icon} />
        {showPriority ? <StatusBadge tone="danger" label={`Ưu tiên ${PRIORITY_LABEL[priority].toLowerCase()}`} icon="flag" /> : null}
        {task.is_repick ? <StatusBadge tone="warning" label="Lấy bù" icon="repeat" /> : null}
        {due ? <StatusBadge tone={due.overdue ? 'danger' : 'neutral'} label={due.text} icon="calendar-outline" /> : null}
      </View>

      {!compact && task.description ? <Text style={type.caption} numberOfLines={2}>{task.description}</Text> : null}

      {active ? (
        openable ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: space.md, borderRadius: radii.sm, backgroundColor: colors.primarySoft }}>
            <Text style={{ fontFamily: fontFamily.semibold, fontSize: 15, color: colors.primary }}>{route.cta}</Text>
            <Ionicons name="arrow-forward" size={18} color={colors.primary} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
            <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} style={{ marginTop: 1 }} />
            <Text style={[type.caption, { flex: 1 }]}>{route.reason}</Text>
          </View>
        )
      ) : null}
    </PressableScale>
  );
}
