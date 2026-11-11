import { ActivityIndicator, Text, View, type DimensionValue } from 'react-native';
import Animated, { cubicBezier, useReducedMotion } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme-context';
import { fontFamily, radii, space } from '../tokens';
import { Button, type IconName } from './primitives';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary';

export function useTone(tone: Tone) {
  const { colors } = useTheme();
  const map: Record<Tone, { fg: string; bg: string }> = {
    success: { fg: colors.success, bg: colors.successSoft },
    warning: { fg: colors.warning, bg: colors.warningSoft },
    danger: { fg: colors.danger, bg: colors.dangerSoft },
    info: { fg: colors.info, bg: colors.infoSoft },
    neutral: { fg: colors.neutral, bg: colors.neutralSoft },
    primary: { fg: colors.primary, bg: colors.primarySoft },
  };
  return map[tone];
}

const TONE_ICON: Record<Tone, IconName> = {
  success: 'checkmark-circle',
  warning: 'time',
  danger: 'alert-circle',
  info: 'information-circle',
  neutral: 'ellipse',
  primary: 'ellipse',
};

/** Status as words plus an icon on a tinted pill: never colour alone. */
export function StatusBadge({ tone, label, icon }: { tone: Tone; label: string; icon?: IconName | null }) {
  const { fg, bg } = useTone(tone);
  const glyph = icon === null ? null : icon ?? TONE_ICON[tone];
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radii.pill, backgroundColor: bg }}
      accessible
      accessibilityLabel={`Trạng thái: ${label}`}
    >
      {glyph ? <Ionicons name={glyph} size={glyph === 'ellipse' ? 7 : 14} color={fg} /> : null}
      <Text style={{ fontFamily: fontFamily.semibold, fontSize: 12.5, color: fg }}>{label}</Text>
    </View>
  );
}

interface StateProps {
  icon?: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}

/** Nothing here yet: say why and offer the next step. */
export function EmptyState({ icon = 'albums-outline', title, message, actionLabel, onAction, compact = false }: StateProps) {
  const { colors, type } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: compact ? space.xl : space.xxxl, paddingHorizontal: space.xl, gap: space.md }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={26} color={colors.textSecondary} />
      </View>
      <Text style={[type.heading, { textAlign: 'center' }]}>{title}</Text>
      {message ? <Text style={[type.caption, { textAlign: 'center', maxWidth: 320 }]}>{message}</Text> : null}
      {actionLabel && onAction ? <View style={{ marginTop: space.sm }}><Button label={actionLabel} onPress={onAction} variant="secondary" size="md" fullWidth={false} /></View> : null}
    </View>
  );
}

/** A request failed: what happened, and a retry that is the obvious next tap. */
export function ErrorState({ title = 'Chưa tải được dữ liệu', message, onRetry, compact = false }: { title?: string; message?: string | null; onRetry?: () => void; compact?: boolean }) {
  const { colors, type } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: compact ? space.xl : space.xxxl, paddingHorizontal: space.xl, gap: space.md }} accessibilityRole="alert">
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="cloud-offline-outline" size={26} color={colors.danger} />
      </View>
      <Text style={[type.heading, { textAlign: 'center' }]}>{title}</Text>
      {message ? <Text style={[type.caption, { textAlign: 'center', maxWidth: 320 }]}>{message}</Text> : null}
      {onRetry ? <View style={{ marginTop: space.sm }}><Button label="Thử lại" icon="refresh" onPress={onRetry} variant="secondary" size="md" fullWidth={false} /></View> : null}
    </View>
  );
}

/** Inline banner for an error that should not replace the content (e.g. a failed refresh). */
export function InlineAlert({ tone = 'danger', title, message, actionLabel, onAction }: { tone?: Tone; title?: string; message: string; actionLabel?: string; onAction?: () => void }) {
  const { fg, bg } = useTone(tone);
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radii.md, backgroundColor: bg }} accessibilityRole="alert">
      <Ionicons name={TONE_ICON[tone]} size={20} color={fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Text style={{ fontFamily: fontFamily.semibold, fontSize: 14.5, color: colors.textPrimary }}>{title}</Text> : null}
        <Text style={{ fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 20, color: colors.textPrimary }}>{message}</Text>
        {actionLabel && onAction ? (
          <Text onPress={onAction} accessibilityRole="button" style={{ marginTop: space.xs, fontFamily: fontFamily.semibold, fontSize: 14, color: fg, paddingVertical: space.xs }}>
            {actionLabel}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function LoadingState({ label = 'Đang tải…' }: { label?: string }) {
  const { colors, type } = useTheme();
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: space.xxxl, gap: space.md }} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={colors.primary} />
      <Text style={type.caption}>{label}</Text>
    </View>
  );
}

const PULSE = {
  '0%': { opacity: 1 },
  '50%': { opacity: 0.45 },
  '100%': { opacity: 1 },
};

/** Placeholder block shaped like the content it stands for; it breathes only while loading. */
export function Skeleton({ width = '100%', height = 16, radius = radii.xs }: { width?: DimensionValue; height?: number; radius?: number }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: colors.surfaceRaised },
        reduced ? null : { animationName: PULSE, animationDuration: 1200, animationIterationCount: 'infinite', animationTimingFunction: 'ease-in-out' },
      ]}
    />
  );
}

/**
 * A fill that slides to its value. The fill is absolutely positioned with no
 * children, so animating its width costs no layout of anything else.
 */
export function ProgressBar({ value, tone = 'primary', height = 8, accessibilityLabel }: { value: number; tone?: Tone; height?: number; accessibilityLabel?: string }) {
  const { colors } = useTheme();
  const { fg } = useTone(tone);
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View
      style={{ height, borderRadius: height / 2, backgroundColor: colors.surfaceRaised, overflow: 'hidden' }}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
    >
      <Animated.View
        style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct * 100}%`, borderRadius: height / 2, backgroundColor: fg,
          transitionProperty: 'width', transitionDuration: 260, transitionTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
        }}
      />
    </View>
  );
}

/** Where the worker is in a multi-step workflow: done, current, next. Order shown by position and words. */
export function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space.xs }} accessibilityRole="progressbar" accessibilityLabel={`Bước ${current + 1} trên ${steps.length}: ${steps[current] ?? ''}`}>
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <View key={step} style={{ flex: 1, gap: 6 }}>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: done || active ? colors.primary : colors.border }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              {done ? <Ionicons name="checkmark" size={13} color={colors.textSecondary} /> : null}
              <Text
                numberOfLines={1}
                style={{ flexShrink: 1, fontFamily: active ? fontFamily.semibold : fontFamily.medium, fontSize: 12, color: active ? colors.textPrimary : done ? colors.textSecondary : colors.textMuted }}
              >
                {step}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
