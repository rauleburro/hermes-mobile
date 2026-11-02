export type BotHueName = 'indigo' | 'teal' | 'green' | 'olive' | 'orange' | 'rose' | 'violet' | 'sky';

export type BotHue = {
  name: BotHueName;
  /** Solid color for avatars and the user's bubbles (white text on top). */
  fill: string;
  /** Text color to draw on `fill`: readable (AA) on every hue. */
  onFill: string;
  /** The same color at low alpha, for chips and spinner tracks. */
  tint: string;
};

const FILLS: Record<BotHueName, string> = {
  indigo: '#4F46E5',
  teal: '#0F766E',
  green: '#15803D',
  olive: '#5F6B12',
  orange: '#C2410C',
  rose: '#BE123C',
  violet: '#7C3AED',
  sky: '#0369A1',
};

/** Order matters: the hash indexes into it. */
export const BOT_HUE_NAMES: BotHueName[] = ['indigo', 'teal', 'green', 'olive', 'orange', 'rose', 'violet', 'sky'];

const TINT_ALPHA = '26';
const ON_FILL = '#FFFFFF';

/** FNV-1a, 32-bit: stable across runs and installs. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The accent hue of a Bot. The primary Bot (`default`) is always indigo. */
export function botHue(botId: string): BotHue {
  const name = botId === 'default' ? 'indigo' : BOT_HUE_NAMES[hash(botId) % BOT_HUE_NAMES.length]!;
  const fill = FILLS[name];
  return { name, fill, onFill: ON_FILL, tint: `${fill}${TINT_ALPHA}` };
}
