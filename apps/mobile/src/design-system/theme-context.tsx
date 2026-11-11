import { createContext, useContext, type ReactNode } from 'react';
import { customerTheme, loginTheme, staffTheme, type Theme, type ThemeName } from './themes';

const THEMES: Record<ThemeName, Theme> = { customer: customerTheme, staff: staffTheme, login: loginTheme };

const ThemeContext = createContext<Theme>(staffTheme);

/** Each area's layout says which half of the app it is; components below read it. */
export function ThemeProvider({ name, children }: { name: ThemeName; children: ReactNode }) {
  // The workspace pins @types/react 18 for this app, so the React 19 `use`/bare-context forms don't type-check.
  return <ThemeContext.Provider value={THEMES[name]}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
