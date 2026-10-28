/**
 * SmartBook Mobile Design System — Native Edition.
 *
 * One brand (the web's ink indigo), three themes built from it (./themes):
 *   customer — a light reading room: editorial serif titles, covers first;
 *   staff    — a light operations app: high contrast, codes and quantities loud;
 *   login    — neutral, because the role is unknown until the JWT comes back.
 *
 * Every family here ships a full Vietnamese set (the previous display face,
 * Sora, did not, so every accented title fell back mid-word).
 */
import { Easing } from 'react-native-reanimated';

export const fontFamily = {
  /** Customer titles: Fraunces, the web's display face. */
  serif: 'Fraunces_600SemiBold',
  serifBold: 'Fraunces_700Bold',
  /** Everything else: Be Vietnam Pro, drawn for Vietnamese. */
  regular: 'BeVietnamPro_400Regular',
  medium: 'BeVietnamPro_500Medium',
  semibold: 'BeVietnamPro_600SemiBold',
  bold: 'BeVietnamPro_700Bold',
  /** Codes, locations and counts only: data, not decoration. */
  mono: 'RobotoMono_400Regular',
  monoBold: 'RobotoMono_700Bold',
} as const;

/** The brand, shared by every theme. */
export const brand = {
  ink: '#1D1A4A',
  inkDeep: '#14123A',
  inkRaised: '#2B2766',
  indigo: '#4338CA',
  indigoDeep: '#3730A3',
  /** The one warm light (the web's lamp over the display table). */
  lamp: '#F6DFB4',
  paper: '#FFFFFF',
} as const;

/** 4-pt grid. */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radii = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/** Minimum touch target: 44pt (iOS) / 48dp (Android); visuals smaller than this get hitSlop. */
export const size = {
  touch: 48,
  control: 52,
  controlCompact: 44,
  icon: 20,
  iconSmall: 16,
} as const;

/**
 * Motion (expo-animation skill): press 120 ms, small state 180 ms, sheets on a
 * spring. Never ease-in on UI. Tab switches and screen pushes use the platform.
 */
export const motion = {
  press: 120,
  state: 180,
  enter: 260,
  pressScale: 0.97,
  easeOut: Easing.bezier(0.23, 1, 0.32, 1),
  easeInOut: Easing.bezier(0.77, 0, 0.175, 1),
  spring: { duration: 300, dampingRatio: 0.8 },
} as const;
