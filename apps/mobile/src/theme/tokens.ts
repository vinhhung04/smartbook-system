/**
 * Shared design tokens for the mobile app. Keeps colors, spacing, radii,
 * typography and shadows consistent across every screen.
 *
 * Visual language: "Ca làm việc" (the shift) — a calm reading-lamp green
 * gives today's real numbers room to be the loudest thing on the screen,
 * instead of costuming the whole app as a physical object again.
 */
import { Platform } from 'react-native';

export const fonts = {
  display: 'Sora_600SemiBold',
  displayBold: 'Sora_700Bold',
  body: 'Manrope_400Regular',
  bodyMedium: 'Manrope_500Medium',
  bodySemibold: 'Manrope_600SemiBold',
  mono: 'RobotoMono_400Regular',
  monoSemibold: 'RobotoMono_700Bold',
};

export const colors = {
  bg: '#F6F7F5',
  surface: '#FFFFFF',
  surfaceRaised: '#ECEFEA',
  border: '#DEE3DD',
  borderStrong: '#C3CBC2',

  textPrimary: '#1B211D',
  textSecondary: '#5B6660',
  textMuted: '#96A199',
  onPrimary: '#FFFFFF',

  primary: '#1F8A6B',
  primarySoft: 'rgba(31,138,107,0.10)',
  primaryBorder: 'rgba(31,138,107,0.35)',

  success: '#2E8F5C',
  successSoft: 'rgba(46,143,92,0.10)',
  successBorder: 'rgba(46,143,92,0.35)',

  danger: '#C0392E',
  dangerSoft: 'rgba(192,57,46,0.10)',
  dangerBorder: 'rgba(192,57,46,0.35)',

  warning: '#B5791A',
  warningSoft: 'rgba(181,121,26,0.10)',
  warningBorder: 'rgba(181,121,26,0.35)',

  neutral: '#6D766F',
  neutralSoft: 'rgba(109,118,111,0.12)',

  overlay: 'rgba(16,20,17,0.78)',
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
  sm: 6,
  md: 12,
  lg: 18,
  pill: 999,
};

export const typography = {
  h1: { fontFamily: fonts.display, fontSize: 28, color: colors.textPrimary },
  h2: { fontFamily: fonts.display, fontSize: 22, color: colors.textPrimary },
  h3: { fontFamily: fonts.display, fontSize: 18, color: colors.textPrimary },
  body: { fontFamily: fonts.body, fontSize: 16, color: colors.textPrimary },
  bodyBold: { fontFamily: fonts.bodySemibold, fontSize: 16, color: colors.textPrimary },
  caption: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.textSecondary },
  label: {
    fontFamily: fonts.monoSemibold,
    fontSize: 11,
    color: colors.textSecondary,
    letterSpacing: 1.1,
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
    web: { boxShadow: '0px 4px 16px rgba(27,33,29,0.07)', borderWidth: 1, borderColor: colors.border },
    default: {
      shadowColor: '#1B211D',
      shadowOpacity: 0.08,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
      borderWidth: 1,
      borderColor: colors.border,
    },
  }),
};
