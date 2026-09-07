/**
 * Customer-app design tokens — dark, cinematic, browsing-first. Same export
 * shape as ./tokens.ts (fonts/colors/spacing/radius/typography/shadow) so any
 * screen can swap its import line for this one with no other code changes.
 *
 * Visual language: the other half of the "reading lamp" the staff app is
 * named after — staff is daytime/productive/green, customer is
 * nighttime/browsing/amber-on-black. Not Netflix red on purpose: red is
 * already this app's `danger` color (overdue/unpaid), so a red brand accent
 * would collide with error states.
 */
import { Platform } from 'react-native';
import { fonts, spacing } from './tokens';

export { fonts, spacing };

export const colors = {
  bg: '#0A0A0C',
  bgElevated: '#141417',
  surface: '#1C1C20',
  surfaceRaised: '#26262B',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.16)',

  textPrimary: '#F5F3EF',
  textSecondary: 'rgba(245,243,239,0.64)',
  textMuted: 'rgba(245,243,239,0.40)',
  onPrimary: '#1A1206',

  primary: '#E8A33D',
  primarySoft: 'rgba(232,163,61,0.14)',
  primaryBorder: 'rgba(232,163,61,0.40)',
  accentGradientStart: '#F4C06B',
  accentGradientEnd: '#B5651D',

  success: '#5FBE8B',
  successSoft: 'rgba(95,190,139,0.14)',
  successBorder: 'rgba(95,190,139,0.40)',

  danger: '#FF6B5E',
  dangerSoft: 'rgba(255,107,94,0.14)',
  dangerBorder: 'rgba(255,107,94,0.40)',

  warning: '#F2C14E',
  warningSoft: 'rgba(242,193,78,0.14)',
  warningBorder: 'rgba(242,193,78,0.40)',

  neutral: '#8B8B93',
  neutralSoft: 'rgba(139,139,147,0.14)',

  overlay: 'rgba(0,0,0,0.82)',
};

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
  pill: 999,
};

export const typography = {
  h1: { fontFamily: fonts.displayBold, fontSize: 34, color: colors.textPrimary, letterSpacing: -0.4 },
  h2: { fontFamily: fonts.displayBold, fontSize: 24, color: colors.textPrimary },
  h3: { fontFamily: fonts.display, fontSize: 19, color: colors.textPrimary },
  body: { fontFamily: fonts.body, fontSize: 16, color: colors.textPrimary },
  bodyBold: { fontFamily: fonts.bodySemibold, fontSize: 16, color: colors.textPrimary },
  caption: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.textSecondary },
  label: {
    fontFamily: fonts.monoSemibold,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
  },
  code: {
    fontFamily: fonts.mono,
    fontSize: 15,
    color: colors.textPrimary,
    letterSpacing: 0.2,
  },
};

export const shadow = {
  card: Platform.select({
    web: { boxShadow: '0px 8px 24px rgba(0,0,0,0.5)', borderWidth: 1, borderColor: colors.border },
    default: {
      shadowColor: '#000',
      shadowOpacity: 0.5,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 6,
      borderWidth: 1,
      borderColor: colors.border,
    },
  }),
  glow: Platform.select({
    web: { boxShadow: '0px 0px 24px rgba(232,163,61,0.35)' },
    default: {
      shadowColor: colors.primary,
      shadowOpacity: 0.45,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 0 },
      elevation: 8,
    },
  }),
};
