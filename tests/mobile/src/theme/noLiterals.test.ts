import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Screens and components take colors and text sizes from the theme (src/theme), never from
 * literals. This scans the app sources outside src/theme and lists file:line for each offender.
 */
const SRC = path.resolve(__dirname, '../../../../apps/mobile/src');

const NAMED_COLORS =
  'white|black|red|green|blue|gray|grey|yellow|orange|purple|pink|brown|cyan|magenta|silver|gold|navy|teal|maroon|olive|lime|aqua|fuchsia';

type Rule = { name: string; pattern: RegExp };

const RULES: Rule[] = [
  // '#fff', "#d33", `#1B1D22`, '#11223344': a quoted hex color (3, 4, 6 or 8 digits), not a URL or a bare '#'.
  { name: 'hex color', pattern: /(['"`])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\1/g },
  { name: 'rgb()/rgba() color', pattern: /\brgba?\(/g },
  // color: 'white', backgroundColor: "red", <Button color="red" />, placeholderTextColor={'gray'}
  { name: 'named color', pattern: new RegExp(`\\b\\w*[cC]olor\\w*\\s*[:=]\\s*\\{?\\s*(['"])(?:${NAMED_COLORS})\\1`, 'gi') },
  { name: 'literal fontSize', pattern: /\bfontSize\s*:\s*\d/g },
  { name: "useTheme from 'expo-router'", pattern: /import\s*(?:type\s*)?\{[^}]*\buseTheme\b[^}]*\}\s*from\s*['"]expo-router['"]/g },
];

/** Drops whole-line comments so a note mentioning a color is not an offender. */
function withoutComments(source: string) {
  return source
    .split('\n')
    .map((line) => (/^\s*(\/\/|\/\*|\*)/.test(line) ? '' : line))
    .join('\n');
}

function findOffenders(file: string, source: string) {
  const code = withoutComments(source);
  const found: string[] = [];
  for (const { name, pattern } of RULES) {
    for (const match of code.matchAll(pattern)) {
      const line = code.slice(0, match.index).split('\n').length;
      found.push(`${file}:${line}  ${name}: ${match[0].replace(/\s+/g, ' ').slice(0, 60)}`);
    }
  }
  return found;
}

function appSourceFiles() {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .map((f) => f.split(path.sep).join('/'))
    .filter((f) => /\.tsx?$/.test(f) && !f.startsWith('theme/'))
    .sort();
}

describe('findOffenders', () => {
  it.each([
    ["backgroundColor: '#fff'", 'hex color'],
    ['color="#d33"', 'hex color'],
    ["borderColor: '#11223344'", 'hex color'],
    ["color: `#1B1D22`", 'hex color'],
    ["{ color: 'rgba(0, 0, 0, 0.5)' }", 'rgb()/rgba() color'],
    ["{ color: 'rgb(1,2,3)' }", 'rgb()/rgba() color'],
    ["{ color: 'white' }", 'named color'],
    ['<Button color="red" />', 'named color'],
    ["backgroundColor: 'Gray'", 'named color'],
    ['{ fontSize: 16 }', 'literal fontSize'],
    ['{ fontSize:14 }', 'literal fontSize'],
    ["import { router, useTheme } from 'expo-router';", "useTheme from 'expo-router'"],
    ["import {\n  Stack,\n  useTheme,\n} from 'expo-router';", "useTheme from 'expo-router'"],
  ])('flags %j', (source, rule) => {
    expect(findOffenders('x.tsx', source).join('\n')).toContain(rule);
  });

  it.each([
    "const url = 'https://example.com/#abc123';",
    "const heading = '#';",
    "const md = '# Title';",
    "const id = '#abcde';",
    "{ color: colors.text }",
    "{ fontSize: size * 0.38 }",
    "{ fontSize: typography.body.fontSize }",
    "{ color: 'transparent' }",
    "// color: '#fff' in a note",
    " * fontSize: 16 in a doc comment",
    "import { useTheme } from '@/theme';",
    "import { router } from 'expo-router';",
  ])('lets %j through', (source) => {
    expect(findOffenders('x.tsx', source)).toEqual([]);
  });
});

describe('app sources', () => {
  it('finds the app sources outside src/theme', () => {
    const files = appSourceFiles();
    expect(files).toContain('components/MessageBubble.tsx');
    expect(files.some((f) => f.startsWith('theme/'))).toBe(false);
  });

  it('take colors and text sizes from the theme, with no literals', () => {
    const offenders = appSourceFiles().flatMap((f) => findOffenders(f, readFileSync(path.join(SRC, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
