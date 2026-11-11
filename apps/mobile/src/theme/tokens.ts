/**
 * Staff-app tokens in the original export shape (fonts/colors/spacing/radius/
 * typography/shadow), now derived from the Native Edition design system
 * (src/design-system). New code should use the design-system components and
 * useTheme(); this file keeps older helpers reading the same values.
 */
import { fontFamily, radii, space, staffTheme } from '../design-system';

const c = staffTheme.colors;

export const fonts = {
  display: fontFamily.semibold,
  displayBold: fontFamily.bold,
  body: fontFamily.regular,
  bodyMedium: fontFamily.medium,
  bodySemibold: fontFamily.semibold,
  mono: fontFamily.mono,
  monoSemibold: fontFamily.monoBold,
};

export const colors = {
  bg: c.bg,
  surface: c.surface,
  surfaceRaised: c.surfaceRaised,
  border: c.border,
  borderStrong: c.borderStrong,

  textPrimary: c.textPrimary,
  textSecondary: c.textSecondary,
  textMuted: c.textMuted,
  onPrimary: c.onPrimary,

  primary: c.primary,
  primarySoft: c.primarySoft,
  primaryBorder: 'rgba(55,48,163,0.35)',

  success: c.success,
  successSoft: c.successSoft,
  successBorder: 'rgba(14,122,79,0.35)',

  danger: c.danger,
  dangerSoft: c.dangerSoft,
  dangerBorder: 'rgba(190,42,50,0.35)',

  warning: c.warning,
  warningSoft: c.warningSoft,
  warningBorder: 'rgba(154,86,0,0.35)',

  neutral: c.neutral,
  neutralSoft: c.neutralSoft,

  overlay: c.overlay,
};

export const spacing = {
  xs: space.xs,
  sm: space.sm,
  md: space.md,
  lg: space.lg,
  xl: space.xl,
  xxl: space.xxl,
};

export const radius = {
  sm: radii.xs,
  md: radii.sm,
  lg: radii.md,
  pill: radii.pill,
};

const t = staffTheme.type;

export const typography = {
  h1: t.display,
  h2: t.title,
  h3: t.heading,
  body: t.body,
  bodyBold: t.bodyStrong,
  caption: t.caption,
  // Sentence case now: tracked mono capitals were the old look's costume.
  label: t.label,
  code: t.code,
};

export const shadow = {
  card: { ...staffTheme.shadow.card, borderWidth: 1, borderColor: c.border },
};
