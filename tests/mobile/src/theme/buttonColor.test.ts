import { buttonColor } from '@mobile/theme/buttonColor';
import { contrastRatio } from '@mobile/theme/contrast';
import { colors } from '@mobile/theme/tokens';

describe.each(['light', 'dark'] as const)('buttonColor (%s)', (scheme) => {
  const c = colors[scheme];

  it('accent: on Android the fill (React Native draws the label white on it), on iOS the text role', () => {
    expect(buttonColor(c, 'accent', 'android')).toBe(c.accentFill);
    expect(buttonColor(c, 'accent', 'ios')).toBe(c.accent);
  });

  it('danger: on Android the fill, on iOS the text role', () => {
    expect(buttonColor(c, 'danger', 'android')).toBe(c.dangerFill);
    expect(buttonColor(c, 'danger', 'ios')).toBe(c.danger);
  });

  it.each(['accent', 'danger'] as const)('%s on Android: the white label reads on the fill (>= 4.5)', (kind) => {
    expect(c.onAccentFill).toBe('#FFFFFF'); // what React Native draws on Android
    expect(contrastRatio('#FFFFFF', buttonColor(c, kind, 'android'))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['accent', 'danger'] as const)('%s on iOS: the label reads on the background (>= 4.5)', (kind) => {
    expect(contrastRatio(buttonColor(c, kind, 'ios'), c.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('uses the current platform by default', () => {
    expect(buttonColor(c, 'accent')).toBe(buttonColor(c, 'accent', require('react-native').Platform.OS));
  });
});
