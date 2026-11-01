import { useTheme } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

export type MessageRole = 'user' | 'assistant';

/**
 * One chat line. Assistant and user text render here only, so swapping the assistant's
 * plain Text for a rich renderer is a one-line change.
 */
export function MessageBubble({ role, text }: { role: MessageRole; text: string }) {
  const { colors } = useTheme();
  const isUser = role === 'user';
  return (
    <View
      accessible
      accessibilityLabel={`${isUser ? 'You' : 'Bot'}: ${text}`}
      style={[
        styles.bubble,
        isUser
          ? [styles.user, { backgroundColor: colors.primary }]
          : [styles.assistant, { backgroundColor: colors.card, borderColor: colors.border }],
      ]}>
      <Text selectable style={[styles.text, { color: isUser ? '#fff' : colors.text }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '85%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  user: { alignSelf: 'flex-end' },
  assistant: { alignSelf: 'flex-start', borderWidth: StyleSheet.hairlineWidth },
  text: { fontSize: 16 },
});
