import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { truncate, type ToolStatus } from '@/lib/chatItems';
import { typography, useTheme } from '@/theme';

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
        <ActivityIndicator testID="tool-spinner" size="small" color={colors.accent} />
      ) : (
        <Text style={[styles.icon, { color: colors.textSecondary }]}>{status === 'done' ? (expanded ? '▾' : '▸') : '·'}</Text>
      )}
      <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
        {name}
      </Text>
      {args ? (
        <Text style={[styles.args, { color: colors.textSecondary }]} numberOfLines={1}>
          {args}
        </Text>
      ) : null}
      {status !== 'done' ? <Text style={[styles.state, { color: colors.textSecondary }]}>{STATUS_TEXT[status]}</Text> : null}
    </View>
  );

  const cardStyle = [styles.card, { backgroundColor: colors.surface, borderColor: colors.separator }];
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
        <View style={[styles.details, { borderColor: colors.separator }]}>
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
  icon: { width: 14, textAlign: 'center' },
  name: { ...typography.mono, fontWeight: '600' },
  args: { ...typography.footnote, flexShrink: 1, fontFamily: typography.mono.fontFamily },
  state: { ...typography.footnote },
  details: { marginTop: 6, paddingTop: 6, gap: 6, borderTopWidth: StyleSheet.hairlineWidth },
  detail: { ...typography.footnote, fontFamily: typography.mono.fontFamily },
});
