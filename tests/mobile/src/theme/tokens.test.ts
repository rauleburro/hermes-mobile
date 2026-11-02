import { BOT_HUE_NAMES, botHue } from '@mobile/theme/botHue';
import { contrastRatio } from '@mobile/theme/contrast';
import { colors, radius, sizes, spacing, typography } from '@mobile/theme/tokens';

const ROLES = [
  'bg',
  'surface',
  'elevated',
  'text',
  'textSecondary',
  'textTertiary',
  'separator',
  'accent',
  'attention',
  'danger',
  'dangerFill',
  'onDangerFill',
  'accentFill',
  'onAccentFill',
  'success',
];

describe('color roles', () => {
  it.each(['light', 'dark'] as const)('%s defines exactly the 15 roles', (scheme) => {
    expect(Object.keys(colors[scheme]).sort()).toEqual([...ROLES].sort());
  });

  it('light and dark share the same set of roles', () => {
    expect(Object.keys(colors.light).sort()).toEqual(Object.keys(colors.dark).sort());
  });
});

describe.each(['light', 'dark'] as const)('contrast (%s)', (scheme) => {
  const c = colors[scheme];

  it.each([
    ['text', 4.5],
    ['textSecondary', 4.5],
    ['textTertiary', 3],
    ['accent', 4.5],
    ['danger', 4.5],
  ] as const)('%s on bg is at least %s', (role, min) => {
    expect(contrastRatio(c[role], c.bg)).toBeGreaterThanOrEqual(min);
  });

  it('the danger fill carries a readable label (Android draws a Button label on its fill)', () => {
    expect(contrastRatio(c.onDangerFill, c.dangerFill)).toBeGreaterThanOrEqual(4.5);
  });

  it('text on surface is at least 4.5', () => {
    expect(contrastRatio(c.text, c.surface)).toBeGreaterThanOrEqual(4.5);
  });
});

// Every foreground/background pair the app draws (floor 4.5; no tertiary text is drawn).
describe.each(['light', 'dark'] as const)('contrast of the pairs the app draws (%s)', (scheme) => {
  const c = colors[scheme];
  const roles = [
    ['text', 'bg'],
    ['textSecondary', 'bg'],
    ['accent', 'bg'],
    ['danger', 'bg'],
    ['text', 'surface'], // assistant bubble, ToolCard, notice
    ['textSecondary', 'surface'], // ToolCard name and state
    ['accent', 'surface'], // ToolCard spinner
    ['text', 'elevated'], // code
    ['accent', 'elevated'], // link in code
    ['onDangerFill', 'dangerFill'],
    ['onAccentFill', 'accentFill'],
  ] as const;

  it.each(roles)('%s on %s is at least 4.5', (fg, bg) => {
    expect(contrastRatio(c[fg], c[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(BOT_HUE_NAMES)('the label on the %s hue fill is at least 4.5', (name) => {
    const hue = [...Array(200).keys()].map((i) => botHue(`bot-${i}`)).concat(botHue('default')).find((h) => h.name === name)!;
    expect(contrastRatio(hue.onFill, hue.fill)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('scales', () => {
  it('typography', () => {
    expect(typography.largeTitle).toEqual({ fontSize: 28, lineHeight: 34, fontWeight: '700' });
    expect(typography.title).toEqual({ fontSize: 20, lineHeight: 25, fontWeight: '600' });
    expect(typography.headline).toEqual({ fontSize: 17, lineHeight: 22, fontWeight: '600' });
    expect(typography.body).toEqual({ fontSize: 17, lineHeight: 24, fontWeight: '400' });
    expect(typography.callout).toEqual({ fontSize: 15, lineHeight: 20, fontWeight: '400' });
    expect(typography.footnote).toEqual({ fontSize: 13, lineHeight: 18, fontWeight: '400' });
    expect(typography.mono).toMatchObject({ fontSize: 14, lineHeight: 20, fontWeight: '400' });
    expect(typeof typography.mono.fontFamily).toBe('string');
  });

  it('spacing, radius and sizes', () => {
    expect(spacing).toEqual({ xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 });
    expect(radius).toEqual({ sm: 8, md: 12, lg: 20, tail: 6, full: 9999 });
    expect(sizes).toEqual({
      roundButton: 44,
      avatarRoster: 56,
      avatarHero: 96,
      avatarPill: 28,
      avatarInline: 20,
      composerMin: 48,
    });
  });
});
