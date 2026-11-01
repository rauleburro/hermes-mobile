import { useTheme } from 'expo-router';
import { Lexer, type Token, type Tokens } from 'marked';
import { type ReactNode, useMemo } from 'react';
import { type ColorValue, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

// Renders an assistant reply written in Markdown with plain React Native components.
// `marked` only tokenizes; rendering is ours, so raw HTML is never interpreted: HTML
// tokens are shown as the literal text the agent wrote. Images are never loaded
// (only their alt text is shown), so a reply cannot make the phone fetch a URL.

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
const HEADING_SIZES = [26, 22, 19, 17, 16, 15];
// Only these open in the system browser. Anything else (app deep links, javascript:)
// stays plain text so a reply cannot drive the app.
const OPENABLE = /^(https?:|mailto:)/i;

// Guards against hostile or degenerate replies. A reply that trips one is shown as
// plain text instead of crashing the chat or freezing the JS thread.
// - Size: real replies are a few KB; 30 KB is ~10 screens of text. Beyond that we skip
//   parsing entirely (linear cost guard, and it bounds deep-list inputs too).
const MAX_LENGTH = 30_000;
// - Emphasis: marked's emphasis matching is quadratic in the delimiters of one
//   paragraph (8000 `_a ` takes minutes). 200 `*`/`_`/`~` in one paragraph is far more
//   than any real prose and lexes in a few ms; denser paragraphs stay plain text.
const MAX_INLINE_DELIMITERS = 200;
// - Nesting: blockquotes and lists deeper than this render their source as plain text.
const MAX_DEPTH = 8;

type Colors = { text: ColorValue; border: ColorValue; primary: ColorValue };

class GuardedLexer extends Lexer {
  override inlineTokens(src: string, tokens: Token[] = []): Token[] {
    if (countDelimiters(src) > MAX_INLINE_DELIMITERS) {
      tokens.push({ type: 'text', raw: src, text: src } as Tokens.Text);
      return tokens;
    }
    return super.inlineTokens(src, tokens);
  }
}

function countDelimiters(src: string): number {
  let n = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c === 42 || c === 95 || c === 126) n++; // * _ ~
  }
  return n;
}

/** Tokens for `text`, or null when it must be shown as plain text. */
function parse(text: string): Token[] | null {
  if (text.length > MAX_LENGTH) return null;
  try {
    return new GuardedLexer().lex(text);
  } catch {
    // e.g. RangeError (stack overflow) on thousands of nested blockquotes.
    return null;
  }
}

/**
 * Whether `text` renders at least one link that can be opened (http/https/mailto).
 * Containers use it to avoid grouping a reply into one accessibility element, which
 * would hide its links from screen readers.
 */
export function hasOpenableLinks(text: string): boolean {
  const tokens = parse(text);
  return tokens ? tokens.some(containsOpenableLink) : false;
}

function containsOpenableLink(token: Token): boolean {
  if (token.type === 'link' && OPENABLE.test((token as Tokens.Link).href)) return true;
  const children: Token[] = [
    ...(('tokens' in token && Array.isArray(token.tokens) ? token.tokens : []) as Token[]),
    ...(token.type === 'list' ? (token as Tokens.List).items : []),
  ];
  return children.some(containsOpenableLink);
}

export function Markdown({ children }: { children: string }) {
  const { colors } = useTheme();
  const tokens = useMemo(() => parse(children), [children]);
  return (
    <View style={styles.root}>
      {tokens ? (
        renderBlocks(tokens, colors, 'b', 0)
      ) : (
        <Text selectable style={[styles.paragraph, { color: colors.text }]}>
          {children}
        </Text>
      )}
    </View>
  );
}

function renderBlocks(tokens: Token[], colors: Colors, prefix: string, depth: number): ReactNode[] {
  return tokens.map((token, i) => renderBlock(token, colors, `${prefix}-${i}`, depth)).filter((n) => n !== null);
}

function plainBlock(text: string, colors: Colors, key: string) {
  return (
    <Text key={key} selectable style={[styles.paragraph, { color: colors.text }]}>
      {text.trimEnd()}
    </Text>
  );
}

function renderBlock(token: Token, colors: Colors, key: string, depth: number): ReactNode {
  const text = { color: colors.text };
  switch (token.type) {
    case 'space':
    case 'checkbox': // shown as the list item's marker instead
      return null;
    case 'heading': {
      const t = token as Tokens.Heading;
      const fontSize = HEADING_SIZES[t.depth - 1] ?? 15;
      return (
        <Text key={key} selectable accessibilityRole="header" style={[styles.heading, text, { fontSize }]}>
          {renderInline(t.tokens, colors, key)}
        </Text>
      );
    }
    case 'paragraph':
    case 'text': {
      const t = token as Tokens.Paragraph | Tokens.Text;
      return (
        <Text key={key} selectable style={[styles.paragraph, text]}>
          {t.tokens ? renderInline(t.tokens, colors, key) : t.text}
        </Text>
      );
    }
    case 'list': {
      if (depth >= MAX_DEPTH) return plainBlock(token.raw, colors, key);
      const t = token as Tokens.List;
      const start = typeof t.start === 'number' ? t.start : 1;
      return (
        <View key={key} style={styles.list}>
          {t.items.map((item, i) => (
            <View key={`${key}-${i}`} style={styles.listItem}>
              <Text style={[styles.paragraph, styles.marker, text]}>{marker(t, item, start + i)}</Text>
              <View style={styles.listBody}>{renderBlocks(item.tokens, colors, `${key}-${i}`, depth + 1)}</View>
            </View>
          ))}
        </View>
      );
    }
    case 'blockquote': {
      if (depth >= MAX_DEPTH) return plainBlock(token.raw, colors, key);
      const t = token as Tokens.Blockquote;
      return (
        <View key={key} testID="markdown-blockquote" style={[styles.blockquote, { borderLeftColor: colors.border }]}>
          {renderBlocks(t.tokens, colors, key, depth + 1)}
        </View>
      );
    }
    case 'code': {
      const t = token as Tokens.Code;
      return (
        <ScrollView
          key={key}
          testID="markdown-code-block"
          horizontal
          style={[styles.codeBlock, { backgroundColor: colors.border }]}
          contentContainerStyle={styles.codeBlockContent}>
          <Text selectable style={[styles.code, text]}>
            {t.text}
          </Text>
        </ScrollView>
      );
    }
    case 'hr':
      return <View key={key} testID="markdown-hr" style={[styles.hr, { backgroundColor: colors.border }]} />;
    default:
      // Raw HTML blocks, tables and anything else: show the source text as written.
      return plainBlock(('text' in token && typeof token.text === 'string' ? token.text : token.raw) ?? '', colors, key);
  }
}

function marker(list: Tokens.List, item: Tokens.ListItem, n: number): string {
  if (item.task) return item.checked ? '☑' : '☐';
  return list.ordered ? `${n}.` : '•';
}

function renderInline(tokens: Token[], colors: Colors, prefix: string): ReactNode[] {
  return tokens.map((token, i) => {
    const key = `${prefix}-${i}`;
    switch (token.type) {
      case 'strong':
        return (
          <Text key={key} style={styles.strong}>
            {renderInline((token as Tokens.Strong).tokens, colors, key)}
          </Text>
        );
      case 'em':
        return (
          <Text key={key} style={styles.em}>
            {renderInline((token as Tokens.Em).tokens, colors, key)}
          </Text>
        );
      case 'del':
        return (
          <Text key={key} style={styles.del}>
            {renderInline((token as Tokens.Del).tokens, colors, key)}
          </Text>
        );
      case 'codespan':
        return (
          <Text key={key} style={[styles.code, { backgroundColor: colors.border }]}>
            {(token as Tokens.Codespan).text}
          </Text>
        );
      case 'link': {
        const t = token as Tokens.Link;
        const label = renderInline(t.tokens, colors, key);
        if (!OPENABLE.test(t.href)) return <Text key={key}>{label}</Text>;
        return (
          <Text
            key={key}
            accessibilityRole="link"
            style={[styles.link, { color: colors.primary }]}
            onPress={() => {
              Linking.openURL(t.href).catch(() => {});
            }}>
            {label}
          </Text>
        );
      }
      case 'br':
        return '\n';
      case 'checkbox': // loose task lists put it inline; the list marker shows it
        return null;
      case 'text': {
        const t = token as Tokens.Text;
        return t.tokens ? <Text key={key}>{renderInline(t.tokens, colors, key)}</Text> : t.text;
      }
      case 'image':
        return (token as Tokens.Image).text;
      default:
        // `html` (shown literally), `escape` and anything unknown.
        return 'text' in token && typeof token.text === 'string' ? token.text : token.raw;
    }
  });
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  heading: { fontWeight: 'bold' },
  paragraph: { fontSize: 16, lineHeight: 22 },
  strong: { fontWeight: 'bold' },
  em: { fontStyle: 'italic' },
  del: { textDecorationLine: 'line-through' },
  link: { textDecorationLine: 'underline' },
  code: { fontFamily: MONO, fontSize: 14 },
  // A horizontal ScrollView grows to fill its column parent unless told not to.
  codeBlock: { borderRadius: 8, flexGrow: 0 },
  codeBlockContent: { padding: 10 },
  list: { gap: 4 },
  listItem: { flexDirection: 'row', gap: 6 },
  marker: { minWidth: 16 },
  listBody: { flex: 1, gap: 4 },
  blockquote: { borderLeftWidth: 3, paddingLeft: 10, gap: 8, opacity: 0.85 },
  hr: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
});
