import { useTheme } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Markdown } from '@/components/Markdown';
import { hasOpenableLinks } from '@/lib/markdown';

export type MessageRole = 'user' | 'assistant';

/**
 * One chat line. A final assistant reply renders as Markdown; user text and replies
 * still streaming stay literal. The bubble is one accessibility element ("Bot: …")
 * unless it holds links, so a screen reader can still reach each link.
 */
export function MessageBubble({ role, text, streaming = false }: { role: MessageRole; text: string; streaming?: boolean }) {
  const { colors } = useTheme();
  const isUser = role === 'user';
  const markdown = !isUser && !streaming;
  const grouped = useMemo(() => !markdown || !hasOpenableLinks(text), [markdown, text]);
  return (
    <View
      accessible={grouped}
      accessibilityLabel={grouped ? `${isUser ? 'You' : 'Bot'}: ${text}` : undefined}
      style={[
        styles.bubble,
        isUser
          ? [styles.user, { backgroundColor: colors.primary }]
          : [styles.assistant, { backgroundColor: colors.card, borderColor: colors.border }],
      ]}>
      {markdown ? (
        <Markdown>{text}</Markdown>
      ) : (
        <Text selectable style={[styles.text, { color: isUser ? '#fff' : colors.text }]}>
          {text}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '85%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  user: { alignSelf: 'flex-end' },
  assistant: { alignSelf: 'flex-start', borderWidth: StyleSheet.hairlineWidth },
  text: { fontSize: 16 },
});
