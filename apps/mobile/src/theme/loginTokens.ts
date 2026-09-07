/**
 * Login-screen-only tokens. Deliberately NOT imported from tokens.ts (staff
 * green) or customerTokens.ts (customer amber) — role is unknown until after
 * auth succeeds, so this screen has to read as neither.
 *
 * v3: a full reset to a light, paper-and-ink "library catalog card" — no
 * glass, no dark backdrop. Grounded in the actual materials of a library
 * (paper, ink, book-cloth binding, gilt page edges) rather than borrowing
 * Apple's material language a third time.
 */
import { fonts, spacing, radius } from './tokens';

export { fonts, spacing, radius };

export const colors = {
  paperTop: '#FBF5E9',
  paperBottom: '#F0E4CC',

  cardStock: '#FFFDF7',
  cardRule: 'rgba(140,50,66,0.18)',

  ink: '#2E2015',
  inkSoft: '#6B5847',
  inkMuted: '#A6957A',

  accent: '#8C3242',
  accentDeep: '#5E1F2A',
  accentSoft: 'rgba(140,50,66,0.08)',
  onAccent: '#FBF5E9',

  gold: '#C9A44C',
  goldSoft: 'rgba(201,164,76,0.16)',

  danger: '#B3261E',
  dangerSoft: 'rgba(179,38,30,0.08)',
  dangerBorder: 'rgba(179,38,30,0.3)',
};
