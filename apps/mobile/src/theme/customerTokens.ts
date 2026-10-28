/**
 * Reader-app tokens in the original export shape, now derived from the Native
 * Edition design system (src/design-system): a light reading room instead of
 * the old dark cinema. New code uses useTheme() and the design-system parts.
 */
import { customerTheme, fontFamily, radii } from '../design-system';
import { fonts as staffFonts, spacing } from './tokens';

export { spacing };

export const fonts = { ...staffFonts, display: fontFamily.serif, displayBold: fontFamily.serifBold };

const c = customerTheme.colors;

export const colors = {
  bg: c.bg,
  bgElevated: c.surface,
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
  primaryBorder: 'rgba(67,56,202,0.35)',
  // Flat now: both ends of the old gradient are the brand colour.
  accentGradientStart: c.primary,
  accentGradientEnd: c.primary,

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

export const radius = {
  sm: radii.sm,
  md: radii.md,
  lg: radii.lg,
  pill: radii.pill,
};

const t = customerTheme.type;

export const typography = {
  h1: t.display,
  h2: t.title,
  h3: t.heading,
  body: t.body,
  bodyBold: t.bodyStrong,
  caption: t.caption,
  label: t.label,
  code: t.code,
};

export const shadow = {
  card: customerTheme.shadow.card,
  glow: customerTheme.shadow.raised,
};
