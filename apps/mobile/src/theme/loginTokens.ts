/**
 * Before sign-in the role is unknown, so the entry screens commit to neither
 * half of the app: the brand alone (ink and white), from the design system.
 */
import { brand, loginTheme } from '../design-system';
import { fonts, radius, spacing } from './tokens';

export { fonts, spacing, radius };

export const colors = {
  paperTop: '#FFFFFF',
  paperBottom: '#FFFFFF',
  cardStock: '#FFFFFF',
  cardRule: loginTheme.colors.border,
  ink: loginTheme.colors.textPrimary,
  inkSoft: loginTheme.colors.textSecondary,
  inkMuted: loginTheme.colors.textMuted,
  accent: brand.ink,
  accentDeep: brand.inkDeep,
  accentSoft: loginTheme.colors.primarySoft,
  onAccent: '#FFFFFF',
  gold: brand.lamp,
  goldSoft: 'rgba(246,223,180,0.35)',
  danger: loginTheme.colors.danger,
  dangerSoft: loginTheme.colors.dangerSoft,
  dangerBorder: 'rgba(190,42,50,0.3)',
};
