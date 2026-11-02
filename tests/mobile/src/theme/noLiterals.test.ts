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

type Match = { index: number; text: string };
type Rule = { name: string; find: (code: string) => Match[] };

const matchesOf = (pattern: RegExp) => (code: string): Match[] =>
  [...code.matchAll(pattern)].map((m) => ({ index: m.index!, text: m[0] }));

// A color prop's value runs to the next `,` `}` `;` or newline, so a literal in a ternary or `??` branch counts.
const VALUE = '[^,};\\n]*?';

// Modules whose `useTheme` is the navigation theme, not ours.
const NAV_MODULE = `(?:expo-router(?:/[^'"]*)?|@react-navigation/[^'"]*)`;
const USE_THEME = String.raw`\buseTheme\b`;

/** `import * as X from <nav module>` or `const X = require(<nav module>)`, then `X.useTheme`. */
function namespaceUseTheme(code: string): Match[] {
  const aliases = [
    ...code.matchAll(new RegExp(String.raw`import\s*\*\s*as\s+(\w+)\s+from\s*(['"])${NAV_MODULE}\2`, 'g')),
    ...code.matchAll(new RegExp(String.raw`(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*(['"])${NAV_MODULE}\2\s*\)\s*(?:;|$)`, 'gm')),
  ].map((m) => m[1]!);
  return aliases.flatMap((alias) => matchesOf(new RegExp(String.raw`\b${alias}\s*\.\s*useTheme\b`, 'g'))(code));
}

const RULES: Rule[] = [
  // '#fff', "#d33", `#1B1D22`, '#11223344': a quoted hex color (3, 4, 6 or 8 digits), not a URL or a bare '#'.
  { name: 'hex color', find: matchesOf(/(['"`])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\1/g) },
  { name: 'rgb()/rgba() color', find: matchesOf(/\brgba?\(/g) },
  { name: 'hsl()/hsla()/hwb() color', find: matchesOf(/\b(?:hsla?|hwb)\(/g) },
  // color: 'white', backgroundColor: x ?? "red", <Button color="red" />, color={dark ? 'white' : 'black'}
  {
    name: 'named color',
    find: matchesOf(new RegExp(String.raw`\b\w*[cC]olor\w*\s*[:=]${VALUE}(['"])(?:${NAMED_COLORS})\1`, 'gi')),
  },
  // fontSize: 16, fontSize: big ? 18 : 14, fontSize: size ?? 14 (a number in arithmetic, like `size * 0.38`, is computed)
  {
    name: 'literal fontSize',
    find: matchesOf(/\bfontSize\s*:(?:[^,};\n]*[?:]|[^,};\n]*(?:&&|\|\|))?\s*\(*\s*\d/g),
  },
  {
    name: "useTheme from 'expo-router'",
    find: (code) => [
      // import { useTheme } from 'expo-router', export { useTheme } from '@react-navigation/native'
      ...matchesOf(new RegExp(String.raw`(?:import|export)\s*(?:type\s*)?\{[^}]*${USE_THEME}[^}]*\}\s*from\s*(['"])${NAV_MODULE}\1`, 'g'))(code),
      // const { useTheme } = require('expo-router'), require('expo-router').useTheme
      ...matchesOf(new RegExp(String.raw`\{[^}]*${USE_THEME}[^}]*\}\s*=\s*require\(\s*(['"])${NAV_MODULE}\1\s*\)`, 'g'))(code),
      ...matchesOf(new RegExp(String.raw`require\(\s*(['"])${NAV_MODULE}\1\s*\)\s*\.\s*useTheme\b`, 'g'))(code),
      ...namespaceUseTheme(code),
    ],
  },
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
  for (const { name, find } of RULES) {
    for (const match of find(code)) {
      const line = code.slice(0, match.index).split('\n').length;
      found.push(`${file}:${line}  ${name}: ${match.text.replace(/\s+/g, ' ').slice(0, 60)}`);
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
    ["{ color: isUser ? 'white' : colors.text }", 'named color'],
    ["{ color: isUser ? colors.text : 'white' }", 'named color'],
    ["{ backgroundColor: x ?? 'black' }", 'named color'],
    ["<ActivityIndicator color={dark ? 'white' : 'black'} />", 'named color'],
    ['<Text style={{ borderColor: ok ? "teal" : colors.separator }} />', 'named color'],
    ['{ fontSize: big ? 18 : 14 }', 'literal fontSize'],
    ['{ fontSize: big ? typography.body.fontSize : 14 }', 'literal fontSize'],
    ['{ fontSize: size ?? 14 }', 'literal fontSize'],
    ['{ fontSize: size || 14 }', 'literal fontSize'],
    ['{ fontSize: (16) }', 'literal fontSize'],
    ["import * as Router from 'expo-router';\nconst t = Router.useTheme();", "useTheme from 'expo-router'"],
    ["import * as Nav from 'expo-router/react-navigation';\nNav.useTheme()", "useTheme from 'expo-router'"],
    ["const { useTheme } = require('expo-router');", "useTheme from 'expo-router'"],
    ["const t = require('expo-router').useTheme();", "useTheme from 'expo-router'"],
    ["const R = require('expo-router');\nR.useTheme();", "useTheme from 'expo-router'"],
    ["import { useTheme } from '@react-navigation/native';", "useTheme from 'expo-router'"],
    ["import { useTheme as useNavTheme } from '@react-navigation/native';", "useTheme from 'expo-router'"],
    ["import { useTheme } from '@react-navigation/elements';", "useTheme from 'expo-router'"],
    ["import * as Nav from '@react-navigation/native';\nNav.useTheme();", "useTheme from 'expo-router'"],
    ["const { useTheme } = require('@react-navigation/native');", "useTheme from 'expo-router'"],
    ["export { useTheme } from 'expo-router';", "useTheme from 'expo-router'"],
  ])('flags %j', (source, rule) => {
    expect(findOffenders('x.tsx', source).join('\n')).toContain(rule);
  });

  it.each([
    "const url = 'https://example.com/#abc123';",
    "const heading = '#';",
    "const md = '# Title';",
    "const id = '#abcde';",
    "{ color: colors.text }",
    "{ color: colors.text, name: 'white' }",
    "{ color: isUser ? hue.onFill : colors.text }",
    "{ fontSize: big ? typography.body.fontSize : typography.callout.fontSize }",
    "{ fontSize: scale(2) }",
    "{ fontSize: Math.round(size * 0.38) }",
    "{ fontSize: typography.body.fontSize, lineHeight: 24 }",
    "import * as Router from 'expo-router';\nRouter.router.push('/');",
    "import { router } from 'expo-router';\nconst useTheme = () => 1;",
    "import * as Nav from '@react-navigation/native';\nNav.useNavigation();",
    "import { useNavigation } from '@react-navigation/native';",
    "const { router } = require('expo-router');",
    "const x = require('./theme').useTheme;",
    "import { useTheme } from '@react-navigation-kit/native';",
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
