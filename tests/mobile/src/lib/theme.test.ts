import { DarkTheme, DefaultTheme } from 'expo-router';
import { placeholderColor } from '@mobile/lib/theme';

/** WCAG contrast ratio between two `#rrggbb` or `rgb(r, g, b)` colors. */
function contrast(a: string, b: string) {
  const luminance = (color: string) => {
    const hex = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    const channels = hex
      ? hex.slice(1).map((h) => parseInt(h, 16))
      : color.match(/\d+/g)!.slice(0, 3).map(Number);
    const [r, g, bl] = channels.map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('placeholderColor', () => {
  it.each([
    ['light', DefaultTheme],
    ['dark', DarkTheme],
  ])('is readable on the %s background, and dimmer than the text', (_name, theme) => {
    const color = placeholderColor(theme);
    expect(contrast(color, theme.colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color, theme.colors.background)).toBeLessThan(contrast(theme.colors.text, theme.colors.background));
  });

  it('differs between light and dark themes', () => {
    expect(placeholderColor(DefaultTheme)).not.toBe(placeholderColor(DarkTheme));
  });
});
