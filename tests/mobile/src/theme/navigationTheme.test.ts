import { DarkTheme, DefaultTheme } from 'expo-router';
import { colors } from '@mobile/theme';
import { navigationTheme } from '@mobile/theme/navigationTheme';

describe('navigationTheme', () => {
  it.each([
    ['light', DefaultTheme, false],
    ['dark', DarkTheme, true],
  ] as const)('maps the %s tokens onto the navigation colors and keeps the stock fonts', (scheme, stock, dark) => {
    const roles = colors[scheme];
    const theme = navigationTheme(scheme);
    expect(theme.dark).toBe(dark);
    expect(theme.colors).toEqual({
      primary: roles.accent,
      background: roles.bg,
      card: roles.bg,
      text: roles.text,
      border: roles.separator,
      notification: roles.danger,
    });
    expect(theme.fonts).toBe(stock.fonts);
  });
});
