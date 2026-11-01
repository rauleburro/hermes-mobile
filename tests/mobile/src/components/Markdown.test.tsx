import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Linking, Platform, StyleSheet } from 'react-native';
import { hasOpenableLinks, Markdown } from '@mobile/components/Markdown';

// The component reads its colors from the navigation theme. Each test can switch it.
const LIGHT = { dark: false, colors: { text: 'rgb(28, 28, 30)', border: 'rgb(216, 216, 216)', primary: 'rgb(0, 122, 255)' } };
const DARK = { dark: true, colors: { text: 'rgb(229, 229, 231)', border: 'rgb(39, 39, 41)', primary: 'rgb(10, 132, 255)' } };
let mockTheme = LIGHT;
jest.mock('expo-router', () => ({ useTheme: () => mockTheme }));

beforeEach(() => {
  mockTheme = LIGHT;
  // Linking.openURL is already a jest.fn in the RN preset; clear its calls between tests.
  jest.clearAllMocks();
});

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
const styleOf = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) ?? {};

describe('Markdown', () => {
  it('renders headings as accessible headers without the # markers', async () => {
    await render(<Markdown>{'# Title\n\n### Smaller'}</Markdown>);

    expect(screen.getByRole('header', { name: 'Title' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Smaller' })).toBeOnTheScreen();
    expect(screen.queryByText(/#/)).toBeNull();
    expect(styleOf(screen.getByText('Title')).fontSize).toBeGreaterThan(styleOf(screen.getByText('Smaller')).fontSize);
  });

  it('renders bold and italic inline, without the markers', async () => {
    await render(<Markdown>{'Some **bold** and *italic* words'}</Markdown>);

    expect(styleOf(screen.getByText('bold')).fontWeight).toBe('bold');
    expect(styleOf(screen.getByText('italic')).fontStyle).toBe('italic');
    expect(screen.queryByText(/\*/)).toBeNull();
  });

  it('renders an unordered list with a bullet per item', async () => {
    await render(<Markdown>{'- first\n- second'}</Markdown>);

    expect(screen.getByText('first')).toBeOnTheScreen();
    expect(screen.getByText('second')).toBeOnTheScreen();
    expect(screen.getAllByText('•')).toHaveLength(2);
  });

  it('renders an ordered list numbered from its start', async () => {
    await render(<Markdown>{'3. third\n4. fourth'}</Markdown>);

    expect(screen.getByText('3.')).toBeOnTheScreen();
    expect(screen.getByText('4.')).toBeOnTheScreen();
    expect(screen.getByText('third')).toBeOnTheScreen();
    expect(screen.getByText('fourth')).toBeOnTheScreen();
  });

  it('renders nested lists', async () => {
    await render(<Markdown>{'1. outer\n   - inner'}</Markdown>);

    expect(screen.getByText('1.')).toBeOnTheScreen();
    expect(screen.getByText('outer')).toBeOnTheScreen();
    expect(screen.getByText('•')).toBeOnTheScreen();
    expect(screen.getByText('inner')).toBeOnTheScreen();
  });

  it('renders inline code in a monospace font', async () => {
    await render(<Markdown>{'Run `pnpm test` now'}</Markdown>);

    expect(styleOf(screen.getByText('pnpm test')).fontFamily).toBe(MONO);
    expect(screen.queryByText(/`/)).toBeNull();
  });

  it('renders fenced code blocks monospace inside a horizontal scroll view', async () => {
    await render(<Markdown>{'```ts\nconst a = 1;\nconst b = 2;\n```'}</Markdown>);

    const block = screen.getByTestId('markdown-code-block');
    expect(block.props.horizontal).toBe(true);
    const code = within(block).getByText('const a = 1;\nconst b = 2;');
    expect(styleOf(code).fontFamily).toBe(MONO);
    expect(screen.queryByText(/```/)).toBeNull();
  });

  it('keeps code blocks only as tall as their code (no flex growth inside the bubble)', async () => {
    await render(<Markdown>{'```\nx\n```'}</Markdown>);

    expect(styleOf(screen.getByTestId('markdown-code-block')).flexGrow).toBe(0);
  });

  it('renders blockquotes in their own container', async () => {
    await render(<Markdown>{'> quoted words'}</Markdown>);

    expect(within(screen.getByTestId('markdown-blockquote')).getByText('quoted words')).toBeOnTheScreen();
    expect(screen.queryByText(/>/)).toBeNull();
  });

  it('opens http(s) links in the system browser', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(<Markdown>{'See [the docs](https://example.com/docs).'}</Markdown>);

    const link = screen.getByRole('link', { name: 'the docs' });
    fireEvent.press(link);

    expect(openURL).toHaveBeenCalledWith('https://example.com/docs');
  });

  it('does not open links with other schemes (e.g. app deep links)', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(<Markdown>{'[pair](hermesmobile://pair?url=x&token=y) [js](javascript:alert(1))'}</Markdown>);

    fireEvent.press(screen.getByText('pair'));
    fireEvent.press(screen.getByText('js'));

    expect(openURL).not.toHaveBeenCalled();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows raw HTML as literal text instead of rendering it', async () => {
    await render(<Markdown>{'Hi <b>there</b>\n\n<script>alert(1)</script>'}</Markdown>);

    expect(screen.getByText('Hi <b>there</b>')).toBeOnTheScreen();
    expect(screen.getByText('<script>alert(1)</script>')).toBeOnTheScreen();
  });

  it('opens mailto links', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(<Markdown>{'[write us](mailto:team@example.com)'}</Markdown>);

    fireEvent.press(screen.getByRole('link', { name: 'write us' }));

    expect(openURL).toHaveBeenCalledWith('mailto:team@example.com');
  });

  it('does not open a blocked scheme that carries an https URL later on', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(<Markdown>{'[pair](hermesmobile://pair?url=https://x.example)'}</Markdown>);

    fireEvent.press(screen.getByText('pair'));

    expect(openURL).not.toHaveBeenCalled();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows images as their alt text only and never loads them', async () => {
    const { toJSON } = await render(<Markdown>{'Look: ![a cat](https://tracker.example/cat.png)'}</Markdown>);

    expect(screen.getByText('Look: a cat')).toBeOnTheScreen();
    expect(JSON.stringify(toJSON())).not.toMatch(/"type":"Image"|tracker\.example/);
  });

  it('renders horizontal rules, strikethrough and hard line breaks', async () => {
    await render(<Markdown>{'one  \ntwo\n\n---\n\n~~gone~~'}</Markdown>);

    expect(screen.getByText('one\ntwo')).toBeOnTheScreen();
    expect(screen.getByTestId('markdown-hr')).toBeOnTheScreen();
    expect(styleOf(screen.getByText('gone')).textDecorationLine).toBe('line-through');
  });

  it('renders task list items with a checkbox instead of a stray [ ]', async () => {
    await render(<Markdown>{'- [ ] todo\n- [x] done'}</Markdown>);

    expect(screen.getByText('☐')).toBeOnTheScreen();
    expect(screen.getByText('☑')).toBeOnTheScreen();
    expect(screen.getByText('todo')).toBeOnTheScreen();
    expect(screen.getByText('done')).toBeOnTheScreen();
    expect(screen.queryByText(/\[[ x]\]/)).toBeNull();
    expect(screen.queryByText('•')).toBeNull();
  });

  it('renders loose task list items with a checkbox instead of a stray [ ]', async () => {
    await render(<Markdown>{'- [ ] one\n\n- [x] two'}</Markdown>);

    expect(screen.getByText('☐')).toBeOnTheScreen();
    expect(screen.getByText('☑')).toBeOnTheScreen();
    expect(screen.getByText('one')).toBeOnTheScreen();
    expect(screen.getByText('two')).toBeOnTheScreen();
    expect(screen.queryByText(/\[[ x]\]/)).toBeNull();
  });

  it('shows unsupported blocks such as tables as their source text', async () => {
    await render(<Markdown>{'| a | b |\n|---|---|\n| 1 | 2 |'}</Markdown>);

    expect(screen.getByText(/\| a \| b \|/)).toBeOnTheScreen();
  });

  describe('hostile input', () => {
    it('falls back to plain text when the lexer overflows the stack (5000 nested quotes)', async () => {
      const text = '>'.repeat(5000) + ' x';
      await render(<Markdown>{text}</Markdown>);

      expect(screen.getByText(text)).toBeOnTheScreen();
    });

    it('falls back to plain text for very deep nested lists', async () => {
      const text = Array.from({ length: 2000 }, (_, i) => '  '.repeat(i) + '- x').join('\n');
      await render(<Markdown>{text}</Markdown>);

      expect(screen.getByText(text)).toBeOnTheScreen();
    });

    it('caps the rendered nesting depth and shows deeper content as plain text', async () => {
      await render(<Markdown>{'>'.repeat(30) + ' deep'}</Markdown>);

      expect(screen.getAllByTestId('markdown-blockquote').length).toBeLessThanOrEqual(8);
      expect(screen.getByText(/deep/)).toBeOnTheScreen();
    });

    it('shows replies longer than the size cap as plain text', async () => {
      // No emphasis delimiters, so only the size cap (not the emphasis guard) can trigger.
      const text = '# Title\n\n' + 'word '.repeat(7000); // ~35 KB
      await render(<Markdown>{text}</Markdown>);

      expect(screen.queryByRole('header')).toBeNull();
      expect(screen.getByText(text.trimEnd())).toBeOnTheScreen();
    });

    it.each([
      ['*a ', 2000],
      ['_a ', 8000],
    ])('keeps emphasis-heavy paragraphs (%p x %p) fast by showing them as plain text', async (unit, count) => {
      const text = unit.repeat(count).trimEnd();
      const started = Date.now();
      await render(<Markdown>{text}</Markdown>);

      expect(screen.getByText(text)).toBeOnTheScreen();
      expect(Date.now() - started).toBeLessThan(1000);
    });
  });

  it('keeps text readable in the dark theme', async () => {
    mockTheme = DARK;
    await render(<Markdown>{'plain text and `code`\n\n```\nblock\n```'}</Markdown>);

    expect(styleOf(screen.getByText(/plain text/)).color).toBe(DARK.colors.text);
    expect(styleOf(screen.getByText('block')).color).toBe(DARK.colors.text);
    expect(styleOf(screen.getByTestId('markdown-code-block')).backgroundColor).toBe(DARK.colors.border);
  });
});

describe('hasOpenableLinks', () => {
  it('finds http(s) and mailto links, also nested in lists and quotes', () => {
    expect(hasOpenableLinks('See [docs](https://example.com)')).toBe(true);
    expect(hasOpenableLinks('- item\n  - [mail](mailto:a@example.com)')).toBe(true);
    expect(hasOpenableLinks('> quoted [link](http://example.com)')).toBe(true);
  });

  it('ignores links that are shown as plain text', () => {
    expect(hasOpenableLinks('plain **text**')).toBe(false);
    expect(hasOpenableLinks('[x](javascript:alert(1))')).toBe(false);
    expect(hasOpenableLinks('`[code](https://example.com)`')).toBe(false);
  });

  it('is false for text that is too large to parse (it renders as plain text)', () => {
    expect(hasOpenableLinks(`[a](https://example.com) ${'word '.repeat(7000)}`)).toBe(false);
  });
});
