import { useTheme } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { truncate, type ToolStatus } from '@/lib/chatItems';

/** Characters of a tool result shown when a card is expanded. */
export const RESULT_PREVIEW_MAX = 600;
const ARGS_PREVIEW_MAX = 400;

const STATUS_TEXT: Record<ToolStatus, string> = { running: 'running', done: 'done', 'no-result': 'no result' };

type Props = {
  name: string;
  /** One-line summary, secrets masked. */
  args: string;
  /** Full arguments, shown only when expanded. */
  rawArgs: string;
  status: ToolStatus;
  result?: string;
};

/**
 * A compact, inline card for one tool call of a Bot Chat turn: name and a short args summary,
 * a spinner while it runs, then collapsed; a done card expands to its full args and a truncated
 * result. Only the header carries the accessibility label, so the expanded text is read too.
 */
export function ToolCard({ name, args, rawArgs, status, result }: Props) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const label = [`Tool ${name}`, args, STATUS_TEXT[status]].filter(Boolean).join(', ');

  const headerRow = (
    <View style={styles.row}>
      {status === 'running' ? (
        <ActivityIndicator testID="tool-spinner" size="small" color={colors.primary} />
      ) : (
        <Text style={[styles.icon, { color: colors.text }]}>{status === 'done' ? (expanded ? '▾' : '▸') : '·'}</Text>
      )}
      <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
        {name}
      </Text>
      {args ? (
        <Text style={[styles.args, { color: colors.text }]} numberOfLines={1}>
          {args}
        </Text>
      ) : null}
      {status !== 'done' ? <Text style={[styles.state, { color: colors.text }]}>{STATUS_TEXT[status]}</Text> : null}
    </View>
  );

  const cardStyle = [styles.card, { backgroundColor: colors.card, borderColor: colors.border }];
  if (status !== 'done') {
    return (
      <View accessible accessibilityLabel={label} style={cardStyle}>
        {headerRow}
      </View>
    );
  }
  return (
    <View style={cardStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((e) => !e)}>
        {headerRow}
      </Pressable>
      {expanded ? (
        <View style={[styles.details, { borderColor: colors.border }]}>
          {rawArgs ? (
            <Text testID="tool-args" selectable style={[styles.detail, { color: colors.text }]}>
              {truncate(rawArgs, ARGS_PREVIEW_MAX)}
            </Text>
          ) : null}
          <Text testID="tool-result" selectable style={[styles.detail, { color: colors.text }]}>
            {truncate(result ?? '', RESULT_PREVIEW_MAX) || '(empty result)'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { alignSelf: 'flex-start', maxWidth: '85%', borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  icon: { width: 14, textAlign: 'center', opacity: 0.6 },
  name: { fontSize: 13, fontWeight: '600', fontFamily: 'monospace' },
  args: { flexShrink: 1, fontSize: 12, opacity: 0.6, fontFamily: 'monospace' },
  state: { fontSize: 12, opacity: 0.6 },
  details: { marginTop: 6, paddingTop: 6, gap: 6, borderTopWidth: StyleSheet.hairlineWidth },
  detail: { fontSize: 12, fontFamily: 'monospace', opacity: 0.85 },
});
