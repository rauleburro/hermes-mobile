import { botHue, BOT_HUE_NAMES } from '@mobile/theme/botHue';
import { contrastRatio } from '@mobile/theme/contrast';

describe('botHue', () => {
  it('always gives the default Bot indigo', () => {
    expect(botHue('default').name).toBe('indigo');
  });

  it('is deterministic', () => {
    expect(botHue('research-bot')).toEqual(botHue('research-bot'));
  });

  it('returns one of the 8 named hues with a fill and a tint', () => {
    expect(BOT_HUE_NAMES).toEqual(['indigo', 'teal', 'green', 'olive', 'orange', 'rose', 'violet', 'sky']);
    const hue = botHue('writer');
    expect(BOT_HUE_NAMES).toContain(hue.name);
    expect(hue.fill).toMatch(/^#[0-9A-F]{6}$/i);
    expect(hue.tint).toMatch(/^#[0-9A-F]{8}$/i);
    expect(hue.tint.slice(0, 7).toLowerCase()).toBe(hue.fill.toLowerCase());
  });

  it('spreads different ids across several hues', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `bot-${i}`);
    const names = new Set(ids.map((id) => botHue(id).name));
    expect(names.size).toBeGreaterThanOrEqual(4);
  });

  it('keeps the hue of known ids stable across releases (a hash change would recolor every Bot)', () => {
    expect(botHue('research-bot').name).toBe('orange');
    expect(botHue('writer').name).toBe('orange');
    expect(botHue('ops').name).toBe('rose');
    expect(botHue('coder').name).toBe('sky');
  });

  it('never gives a Bot other than the primary the primary indigo', () => {
    for (let i = 0; i < 5_000; i++) expect(botHue(`bot-${i}`).name).not.toBe('indigo');
  });

  it('reaches every other hue, spread roughly evenly', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 7_000; i++) {
      const name = botHue(`bot-${i}`).name;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual(BOT_HUE_NAMES.filter((n) => n !== 'indigo').sort());
    for (const count of counts.values()) expect(count).toBeGreaterThan(700); // 1000 each if perfectly even
  });

  it('keeps white text readable on every fill', () => {
    for (const name of BOT_HUE_NAMES) {
      const id = findIdFor(name);
      expect(contrastRatio(botHue(id).fill, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('names the text color to draw on a fill: white, readable on every hue', () => {
    for (const name of BOT_HUE_NAMES) {
      const hue = botHue(findIdFor(name));
      expect(hue.onFill).toBe('#FFFFFF');
      expect(contrastRatio(hue.fill, hue.onFill)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

/** Finds an id that maps to the given hue: `default` for indigo, a probe id for every other hue. */
function findIdFor(name: string): string {
  if (name === 'indigo') return 'default';
  for (let i = 0; i < 10_000; i++) {
    if (botHue(`probe-${i}`).name === name) return `probe-${i}`;
  }
  throw new Error(`no id maps to ${name}`);
}
