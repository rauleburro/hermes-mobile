import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A native `Button` draws its `color` as the text color on iOS and as the fill (white label) on Android,
 * so the RN defaults fall short of AA on both. Every `<Button` takes its color from `buttonColor`.
 */
const SRC = path.resolve(__dirname, '../../../../apps/mobile/src');

function buttonsWithoutThemeColor(file: string, source: string) {
  const bad: string[] = [];
  for (const match of source.matchAll(/<Button\b[\s\S]*?\/>/g)) {
    if (!/\bcolor=\{buttonColor\(/.test(match[0])) {
      const line = source.slice(0, match.index).split('\n').length;
      bad.push(`${file}:${line}  ${match[0].replace(/\s+/g, ' ').slice(0, 70)}`);
    }
  }
  return bad;
}

function appSourceFiles() {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .map((f) => f.split(path.sep).join('/'))
    .filter((f) => /\.tsx$/.test(f))
    .sort();
}

describe('buttonsWithoutThemeColor', () => {
  it.each([
    '<Button title="Go" onPress={go} />',
    '<Button title="Go" color="red" onPress={go} />',
    "<Button title=\"Go\"\n  color={colors.accent}\n  onPress={go} />",
    '<Button title="Go" color={Platform.OS === "android" ? colors.dangerFill : colors.danger} onPress={() => go()} />',
  ])('flags %j', (source) => {
    expect(buttonsWithoutThemeColor('x.tsx', source)).toHaveLength(1);
  });

  it.each([
    "<Button title=\"Go\" color={buttonColor(colors, 'accent')} onPress={go} />",
    "<Button\n  title=\"Go\"\n  color={buttonColor(colors, 'danger')}\n  onPress={() => go()}\n/>",
    '<ButtonLike title="Go" />',
  ])('lets %j through', (source) => {
    expect(buttonsWithoutThemeColor('x.tsx', source)).toEqual([]);
  });
});

describe('app sources', () => {
  it('draw every native Button with a color from buttonColor', () => {
    const files = appSourceFiles();
    expect(files).toContain('app/bot/[botId].tsx');
    const offenders = files.flatMap((f) => buttonsWithoutThemeColor(f, readFileSync(path.join(SRC, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
