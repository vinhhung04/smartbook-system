import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { TaskEntry } from '../hooks/useDashboardTasks';
import { PRIORITY_LABEL, TASK_TYPE_LABEL, type TaskPhase } from '../lib/taskRoutes';
import { colors, fonts, radius, shadow, spacing, typography } from '../theme/tokens';

type IconName = keyof typeof Ionicons.glyphMap;

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

// Each phase has its own icon as well as its color, so status never relies on color alone.
const PHASE_STYLE: Record<TaskPhase, { icon: IconName; color: string; bg: string }> = {
  todo: { icon: 'ellipse-outline', color: colors.primary, bg: colors.primarySoft },
  in_progress: { icon: 'time-outline', color: colors.warning, bg: colors.warningSoft },
  waiting: { icon: 'hourglass-outline', color: colors.neutral, bg: colors.neutralSoft },
  done: { icon: 'checkmark-circle', color: colors.neutral, bg: colors.neutralSoft },
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

export function TaskCard({ entry, onOpen, compact = false }: Props) {
  const { task, phase, route, statusLabel } = entry;
  const phaseStyle = PHASE_STYLE[phase];
  const priority = String(task.priority || '').toUpperCase();
  const showPriority = priority === 'HIGH' || priority === 'URGENT';
  const due = dueInfo(task.due_date, phase);
  const created = formatDate(task.created_at);
  const openable = route.kind === 'screen';

  const meta = [TASK_TYPE_LABEL[task.type] ?? task.type, task.warehouse, created ? `Tạo ${created}` : null].filter(Boolean).join(' · ');

  return (
    <Pressable
      style={({ pressed }) => [styles.card, phase === 'done' && styles.cardDone, pressed && openable && styles.cardPressed]}
      onPress={() => onOpen(entry)}
      accessibilityRole="button"
      accessibilityLabel={`${TASK_TYPE_LABEL[task.type] ?? task.type} ${task.title}, ${statusLabel}${showPriority ? `, ưu tiên ${PRIORITY_LABEL[priority]}` : ''}${due ? `, ${due.text}` : ''}`}
      accessibilityHint={openable ? route.cta : route.reason}
    >
      <View style={styles.topRow}>
        <View style={[styles.typeIcon, { backgroundColor: phaseStyle.bg }]}>
          <Ionicons name={TYPE_ICON[task.type] ?? 'document-outline'} size={18} color={phaseStyle.color} />
        </View>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>{task.title}</Text>
          <Text style={styles.meta} numberOfLines={1}>{meta}</Text>
        </View>
      </View>

      <View style={styles.badges}>
        <View style={[styles.badge, { backgroundColor: phaseStyle.bg }]}>
          <Ionicons name={phaseStyle.icon} size={12} color={phaseStyle.color} />
          <Text style={[styles.badgeText, { color: phaseStyle.color }]}>{statusLabel}</Text>
        </View>
        {showPriority ? (
          <View style={[styles.badge, styles.badgeDanger]}>
            <Ionicons name="flag" size={12} color={colors.danger} />
            <Text style={[styles.badgeText, { color: colors.danger }]}>{PRIORITY_LABEL[priority]}</Text>
          </View>
        ) : null}
        {task.is_repick ? (
          <View style={[styles.badge, styles.badgeWarning]}>
            <Text style={[styles.badgeText, { color: colors.warning }]}>LẤY BÙ</Text>
          </View>
        ) : null}
        {due ? (
          <View style={[styles.badge, due.overdue ? styles.badgeDanger : styles.badgeNeutral]}>
            <Ionicons name="calendar-outline" size={12} color={due.overdue ? colors.danger : colors.textSecondary} />
            <Text style={[styles.badgeText, { color: due.overdue ? colors.danger : colors.textSecondary }]}>{due.text}</Text>
          </View>
        ) : null}
      </View>

      {!compact && task.description ? <Text style={styles.description} numberOfLines={2}>{task.description}</Text> : null}

      {phase === 'todo' || phase === 'in_progress' ? (
        openable ? (
          <View style={styles.cta}>
            <Text style={styles.ctaText}>{route.cta}</Text>
            <Ionicons name="arrow-forward" size={16} color={colors.primary} />
          </View>
        ) : (
          <View style={styles.note}>
            <Ionicons name="information-circle-outline" size={14} color={colors.textMuted} />
            <Text style={styles.noteText}>{route.reason}</Text>
          </View>
        )
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: spacing.sm,
    ...shadow.card,
  },
  cardDone: {
    opacity: 0.75,
  },
  cardPressed: {
    opacity: 0.85,
  },
  topRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  typeIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 16,
    color: colors.textPrimary,
  },
  meta: {
    ...typography.caption,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
  },
  badgeDanger: {
    backgroundColor: colors.dangerSoft,
  },
  badgeWarning: {
    backgroundColor: colors.warningSoft,
  },
  badgeNeutral: {
    backgroundColor: colors.surfaceRaised,
  },
  badgeText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 12,
  },
  description: {
    ...typography.caption,
    color: colors.textPrimary,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  ctaText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 14,
    color: colors.primary,
  },
  note: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
  },
  noteText: {
    ...typography.caption,
    flex: 1,
    color: colors.textMuted,
  },
});
