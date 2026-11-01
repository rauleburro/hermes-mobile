import { useTheme } from 'expo-router';
import { lexer, type Token, type Tokens } from 'marked';
import { type ReactNode, useMemo } from 'react';
import { type ColorValue, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

// Renders an assistant reply written in Markdown with plain React Native components.
// `marked` only tokenizes; rendering is ours, so raw HTML is never interpreted: HTML
// tokens are shown as the literal text the agent wrote.

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
const HEADING_SIZES = [26, 22, 19, 17, 16, 15];
// Only these open in the system browser. Anything else (app deep links, javascript:)
// stays plain text so a reply cannot drive the app.
const OPENABLE = /^(https?:|mailto:)/i;

type Colors = { text: ColorValue; border: ColorValue; primary: ColorValue };

export function Markdown({ children }: { children: string }) {
  const { colors } = useTheme();
  const tokens = useMemo(() => lexer(children), [children]);
  return <View style={styles.root}>{renderBlocks(tokens, colors, 'b')}</View>;
}

function renderBlocks(tokens: Token[], colors: Colors, prefix: string): ReactNode[] {
  return tokens.map((token, i) => renderBlock(token, colors, `${prefix}-${i}`)).filter((n) => n !== null);
}

function renderBlock(token: Token, colors: Colors, key: string): ReactNode {
  const text = { color: colors.text };
  switch (token.type) {
    case 'space':
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
      const t = token as Tokens.List;
      const start = typeof t.start === 'number' ? t.start : 1;
      return (
        <View key={key} style={styles.list}>
          {t.items.map((item, i) => (
            <View key={`${key}-${i}`} style={styles.listItem}>
              <Text style={[styles.paragraph, styles.marker, text]}>{t.ordered ? `${start + i}.` : '•'}</Text>
              <View style={styles.listBody}>{renderBlocks(item.tokens, colors, `${key}-${i}`)}</View>
            </View>
          ))}
        </View>
      );
    }
    case 'blockquote': {
      const t = token as Tokens.Blockquote;
      return (
        <View key={key} testID="markdown-blockquote" style={[styles.blockquote, { borderLeftColor: colors.border }]}>
          {renderBlocks(t.tokens, colors, key)}
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
      return <View key={key} style={[styles.hr, { backgroundColor: colors.border }]} />;
    default:
      // Raw HTML blocks, tables and anything else: show the source text as written.
      return (
        <Text key={key} selectable style={[styles.paragraph, text]}>
          {(('text' in token && typeof token.text === 'string' ? token.text : token.raw) ?? '').trimEnd()}
        </Text>
      );
  }
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
