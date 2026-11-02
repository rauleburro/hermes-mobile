import { DarkTheme, DefaultTheme, type Theme } from 'expo-router';
import { colors } from './tokens';

/** React Navigation / expo-router theme built from our tokens; fonts come from the stock theme. */
export function navigationTheme(scheme: 'light' | 'dark'): Theme {
  const roles = colors[scheme];
  const stock = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    dark: scheme === 'dark',
    colors: {
      primary: roles.accent,
      background: roles.bg,
      card: roles.bg,
      text: roles.text,
      border: roles.separator,
      notification: roles.danger,
    },
    fonts: stock.fonts,
  };
}
