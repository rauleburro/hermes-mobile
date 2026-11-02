import { renderHook } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { botHue, colors, contrastRatio, radius, sizes, spacing, typography } from '@mobile/theme';
import { useTheme } from '@mobile/theme/useTheme';

function withScheme(scheme: 'light' | 'dark' | 'unspecified' | null | undefined) {
  jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(scheme as ReactNative.ColorSchemeName);
}

afterEach(() => jest.restoreAllMocks());

describe('useTheme', () => {
  it('returns the dark set when the system scheme is dark', async () => {
    withScheme('dark');
    const { result } = await renderHook(() => useTheme());
    expect(result.current.scheme).toBe('dark');
    expect(result.current.dark).toBe(true);
    expect(result.current.colors).toBe(colors.dark);
  });

  it('returns the light set when the system scheme is light', async () => {
    withScheme('light');
    const { result } = await renderHook(() => useTheme());
    expect(result.current.scheme).toBe('light');
    expect(result.current.dark).toBe(false);
    expect(result.current.colors).toBe(colors.light);
  });

  it.each([null, undefined, 'unspecified' as const])('falls back to light for %s', async (scheme) => {
    withScheme(scheme);
    const { result } = await renderHook(() => useTheme());
    expect(result.current.scheme).toBe('light');
    expect(result.current.dark).toBe(false);
    expect(result.current.colors).toBe(colors.light);
  });

  it('exposes the shared scales and the bot hue helper', async () => {
    withScheme('light');
    const { result } = await renderHook(() => useTheme());
    expect(result.current.typography).toBe(typography);
    expect(result.current.spacing).toBe(spacing);
    expect(result.current.radius).toBe(radius);
    expect(result.current.sizes).toBe(sizes);
    expect(result.current.botHue).toBe(botHue);
  });

  it.each(['light', 'dark'] as const)('has a placeholder readable on the %s background', async (scheme) => {
    withScheme(scheme);
    const { result } = await renderHook(() => useTheme());
    const { placeholder, colors: roles } = result.current;
    expect(contrastRatio(placeholder, roles.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(placeholder, roles.bg)).toBeLessThan(contrastRatio(roles.text, roles.bg));
  });
});
