import { Platform, type TextStyle, type ViewStyle } from 'react-native';
import { brand, fontFamily } from './tokens';

export type ThemeName = 'customer' | 'staff' | 'login';

export interface ThemeColors {
  bg: string;
  surface: string;
  surfaceRaised: string;
  /** A filled field of brand ink for the one strong band on a screen. */
  inkField: string;
  onInk: string;
  onInkMuted: string;
  border: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  onPrimary: string;
  focus: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  neutral: string;
  neutralSoft: string;
  overlay: string;
}

export interface Theme {
  name: ThemeName;
  colors: ThemeColors;
  type: {
    display: TextStyle;
    title: TextStyle;
    heading: TextStyle;
    body: TextStyle;
    bodyStrong: TextStyle;
    callout: TextStyle;
    caption: TextStyle;
    label: TextStyle;
    code: TextStyle;
    number: TextStyle;
  };
  shadow: { card: ViewStyle; raised: ViewStyle };
}

function shadows(color: string): Theme['shadow'] {
  return {
    card: Platform.select<ViewStyle>({
      web: { boxShadow: '0px 1px 2px rgba(20,18,58,0.06), 0px 6px 16px -10px rgba(20,18,58,0.18)' } as ViewStyle,
      default: { shadowColor: color, shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
    })!,
    raised: Platform.select<ViewStyle>({
      web: { boxShadow: '0px 16px 32px -16px rgba(20,18,58,0.35)' } as ViewStyle,
      default: { shadowColor: color, shadowOpacity: 0.16, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
    })!,
  };
}

const semantic = {
  success: '#0E7A4F',
  successSoft: '#E3F4EC',
  warning: '#9A5600',
  warningSoft: '#FCF0DC',
  danger: '#BE2A32',
  dangerSoft: '#FCE8E8',
  info: '#1F5FBF',
  infoSoft: '#E5EEFB',
};

/** Reader app: a light reading room. Serif titles; covers carry the colour. */
export const customerTheme: Theme = {
  name: 'customer',
  colors: {
    bg: '#F6F7FB',
    surface: '#FFFFFF',
    surfaceRaised: '#EEF0F8',
    inkField: brand.ink,
    onInk: '#FFFFFF',
    onInkMuted: '#C9CCEA',
    border: '#E2E4EE',
    borderStrong: '#C9CCDB',
    textPrimary: '#16143A',
    textSecondary: '#4A4E66',
    textMuted: '#6E7389',
    primary: brand.indigo,
    primaryPressed: brand.indigoDeep,
    primarySoft: '#ECEBFB',
    onPrimary: '#FFFFFF',
    focus: brand.indigo,
    ...semantic,
    neutral: '#5C6178',
    neutralSoft: '#EEEFF4',
    overlay: 'rgba(20,18,58,0.55)',
  },
  type: {
    display: { fontFamily: fontFamily.serif, fontSize: 32, lineHeight: 36, letterSpacing: -0.6, color: '#16143A' },
    title: { fontFamily: fontFamily.serif, fontSize: 26, lineHeight: 31, letterSpacing: -0.4, color: '#16143A' },
    heading: { fontFamily: fontFamily.serif, fontSize: 20, lineHeight: 25, letterSpacing: -0.2, color: '#16143A' },
    body: { fontFamily: fontFamily.regular, fontSize: 16, lineHeight: 24, color: '#16143A' },
    bodyStrong: { fontFamily: fontFamily.semibold, fontSize: 16, lineHeight: 22, color: '#16143A' },
    callout: { fontFamily: fontFamily.medium, fontSize: 15, lineHeight: 21, color: '#16143A' },
    caption: { fontFamily: fontFamily.regular, fontSize: 13.5, lineHeight: 19, color: '#4A4E66' },
    label: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 18, color: '#4A4E66' },
    code: { fontFamily: fontFamily.mono, fontSize: 15, letterSpacing: 0.2, color: '#16143A' },
    number: { fontFamily: fontFamily.serif, fontSize: 28, lineHeight: 32, color: '#16143A' },
  },
  shadow: shadows(brand.inkDeep),
};

/** Staff app: task-first operations. One sans family, codes in mono, high contrast. */
export const staffTheme: Theme = {
  name: 'staff',
  colors: {
    bg: '#F2F3F7',
    surface: '#FFFFFF',
    surfaceRaised: '#E9EBF1',
    inkField: brand.ink,
    onInk: '#FFFFFF',
    onInkMuted: '#C9CCEA',
    border: '#DADDE6',
    borderStrong: '#BCC1CE',
    textPrimary: '#121528',
    textSecondary: '#454B5E',
    textMuted: '#6A7084',
    primary: brand.indigoDeep,
    primaryPressed: brand.ink,
    primarySoft: '#E9E8F8',
    onPrimary: '#FFFFFF',
    focus: brand.indigo,
    ...semantic,
    neutral: '#575D70',
    neutralSoft: '#ECEDF2',
    overlay: 'rgba(18,21,40,0.6)',
  },
  type: {
    display: { fontFamily: fontFamily.bold, fontSize: 28, lineHeight: 34, letterSpacing: -0.5, color: '#121528' },
    title: { fontFamily: fontFamily.bold, fontSize: 22, lineHeight: 28, letterSpacing: -0.3, color: '#121528' },
    heading: { fontFamily: fontFamily.semibold, fontSize: 17, lineHeight: 23, color: '#121528' },
    body: { fontFamily: fontFamily.regular, fontSize: 16, lineHeight: 23, color: '#121528' },
    bodyStrong: { fontFamily: fontFamily.semibold, fontSize: 16, lineHeight: 22, color: '#121528' },
    callout: { fontFamily: fontFamily.medium, fontSize: 15, lineHeight: 21, color: '#121528' },
    caption: { fontFamily: fontFamily.regular, fontSize: 13.5, lineHeight: 19, color: '#454B5E' },
    label: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 18, color: '#454B5E' },
    code: { fontFamily: fontFamily.monoBold, fontSize: 15, letterSpacing: 0.3, color: '#121528' },
    number: { fontFamily: fontFamily.bold, fontSize: 30, lineHeight: 34, letterSpacing: -0.5, color: '#121528' },
  },
  shadow: shadows('#121528'),
};

/** Before sign-in: the brand alone, committing to neither side. */
export const loginTheme: Theme = {
  ...customerTheme,
  name: 'login',
  colors: { ...customerTheme.colors, bg: '#FFFFFF', primary: brand.ink, primaryPressed: brand.inkDeep, primarySoft: '#ECEBF5' },
};
