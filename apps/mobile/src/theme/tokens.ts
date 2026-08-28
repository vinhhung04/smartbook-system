/**
 * Shared design tokens for the mobile app. Keeps colors, spacing, radii,
 * typography and shadows consistent across every screen.
 */

export const colors = {
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',

  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
  onPrimary: '#FFFFFF',

  primary: '#2563EB',
  primarySoft: '#EFF6FF',
  primaryBorder: '#BFDBFE',

  success: '#16A34A',
  successSoft: '#F0FDF4',
  successBorder: '#BBF7D0',

  danger: '#DC2626',
  dangerSoft: '#FEF2F2',
  dangerBorder: '#FECACA',

  warning: '#D97706',
  warningSoft: '#FFFBEB',
  warningBorder: '#FDE68A',

  neutral: '#334155',
  neutralSoft: '#F1F5F9',

  overlay: 'rgba(15, 23, 42, 0.72)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};

export const typography = {
  h1: { fontSize: 24, fontWeight: '700' as const, color: colors.textPrimary },
  h2: { fontSize: 19, fontWeight: '700' as const, color: colors.textPrimary },
  h3: { fontSize: 16, fontWeight: '700' as const, color: colors.textPrimary },
  body: { fontSize: 16, fontWeight: '400' as const, color: colors.textPrimary },
  bodyBold: { fontSize: 16, fontWeight: '600' as const, color: colors.textPrimary },
  caption: { fontSize: 13, fontWeight: '500' as const, color: colors.textSecondary },
  label: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: colors.textSecondary,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
};

export const shadow = {
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
};
