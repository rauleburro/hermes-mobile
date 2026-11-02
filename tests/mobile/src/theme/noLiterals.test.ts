import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Screens and components take colors and text sizes from the theme (src/theme), never from
 * literals. This scans the app sources outside src/theme and lists file:line for each offender.
 */
const SRC = path.resolve(__dirname, '../../../../apps/mobile/src');

/** CSS named colors (not `transparent`, which is no color). Matched only as a quoted value of a color prop. */
const NAMED_COLORS =
  'aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgrey|darkgreen|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|grey|green|greenyellow|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgrey|lightgreen|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen';

type Rule = { name: string; pattern: RegExp };

const RULES: Rule[] = [
  // '#fff', "#d33", `#1B1D22`, '#11223344': a quoted hex color (3, 4, 6 or 8 digits), not a URL or a bare '#'.
  { name: 'hex color', pattern: /(['"`])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\1/g },
  { name: 'rgb()/rgba() color', pattern: /\brgba?\(/g },
  { name: 'hsl()/hsla()/hwb() color', pattern: /\b(?:hsla?|hwb)\(/g },
  // color: 'white', backgroundColor: "red", <Button color="red" />, placeholderTextColor={'gray'}
  { name: 'named color', pattern: new RegExp(`\\b\\w*[cC]olor\\w*\\s*[:=]\\s*\\{?\\s*(['"])(?:${NAMED_COLORS})\\1`, 'gi') },
  { name: 'literal fontSize', pattern: /\bfontSize\s*:\s*\d/g },
  { name: "useTheme from 'expo-router'", pattern: /import\s*(?:type\s*)?\{[^}]*\buseTheme\b[^}]*\}\s*from\s*(['"])expo-router(?:\/[^'"]*)?\1/g },
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
    ["import { useTheme } from 'expo-router/react-navigation';", "useTheme from 'expo-router'"],
    ['import { useTheme } from "expo-router/react-navigation";', "useTheme from 'expo-router'"],
    ['import { useTheme } from "expo-router";', "useTheme from 'expo-router'"],
    ["{ color: 'hsl(210, 50%, 40%)' }", 'hsl()/hsla()/hwb() color'],
    ["{ color: 'hsla(210, 50%, 40%, 0.5)' }", 'hsl()/hsla()/hwb() color'],
    ["{ backgroundColor: 'hwb(210 10% 20%)' }", 'hsl()/hsla()/hwb() color'],
    ["{ color: 'crimson' }", 'named color'],
    ['{ backgroundColor: "darkgray" }', 'named color'],
    ["{ borderColor: 'lightgray' }", 'named color'],
    ["{ color: 'gray' }", 'named color'],
    ["{ color: 'SlateGray' }", 'named color'],
    ['<Button color="navy" />', 'named color'],
    ["{ tintColor: 'teal' }", 'named color'],
    ["{ color: 'silver' }", 'named color'],
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
    "import { router } from 'expo-router/react-navigation';",
    "import { useHeaderHeight } from 'expo-router/react-navigation';",
    "import { useTheme } from 'expo-router-theme-kit';",
    "const navy = colors.text;",
    "{ color: teal }",
    "const crimson = 1; const gray = 2;",
    "{ name: 'crimson' }",
    "const hue = 'teal';",
    "{ color: colors.gray }",
    "const shsl = hslider(3);",
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
