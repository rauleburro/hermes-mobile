import type { ApprovalChoice, RunEvent, SessionMessage } from '@hermes-mobile/api';
import * as Crypto from 'expo-crypto';
import { Stack, useLocalSearchParams, useTheme } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { followRun, getMessages, resolveApproval, sendMessage, stopRun } from '@/lib/bff';

type Bubble = { key: string; role: 'user' | 'assistant' | 'status'; text: string };

const APPROVAL_LABELS: Record<ApprovalChoice, string> = {
  once: 'Allow once',
  session: 'Allow for this session',
  always: 'Always allow',
  deny: 'Deny',
};

function toBubbles(messages: SessionMessage[]): Bubble[] {
  return messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m, i) => ({ key: String(m.id ?? i), role: m.role as 'user' | 'assistant', text: m.content ?? '' }));
}

export default function ChatScreen() {
  const { sessionId, title } = useLocalSearchParams<{ sessionId: string; title?: string }>();
  const { colors } = useTheme();
  const [history, setHistory] = useState<Bubble[]>([]);
  const [pending, setPending] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    try {
      setHistory(toBubbles(await getMessages(sessionId)));
    } catch (e) {
      Alert.alert('Could not load messages', (e as Error).message);
    }
  }, [sessionId]);

  useEffect(() => {
    let active = true;
    getMessages(sessionId)
      .then((messages) => active && setHistory(toBubbles(messages)))
      .catch((e) => Alert.alert('Could not load messages', (e as Error).message));
    return () => {
      active = false;
      abortRef.current?.abort();
    };
  }, [sessionId]);

  const handleEvent = useCallback((event: RunEvent) => {
    switch (event.event) {
      case 'message.delta':
        setPending((p) => {
          const last = p.at(-1);
          if (last?.role === 'assistant') return [...p.slice(0, -1), { ...last, text: last.text + event.delta }];
          return [...p, { key: `a-${event.seq ?? Date.now()}`, role: 'assistant', text: event.delta }];
        });
        break;
      case 'tool.started':
        setPending((p) => [...p, { key: `t-${event.seq ?? Date.now()}`, role: 'status', text: `⚙︎ ${event.tool}…` }]);
        break;
      case 'tool.failed':
        setPending((p) => [...p, { key: `tf-${event.seq ?? Date.now()}`, role: 'status', text: `✕ ${event.tool} failed` }]);
        break;
      case 'approval.request':
        Alert.alert(
          'Hermes needs approval',
          event.description ?? event.command ?? 'A tool call needs your approval.',
          event.choices.map((choice) => ({
            text: APPROVAL_LABELS[choice] ?? choice,
            style: choice === 'deny' ? 'destructive' : 'default',
            onPress: () => {
              resolveApproval(event.run_id, choice, event.request_id, event.execution_generation).catch((e) =>
                Alert.alert('Approval failed', (e as Error).message),
              );
            },
          })),
          { cancelable: false },
        );
        break;
      case 'run.failed':
      case 'run.interrupted':
        setPending((p) => [...p, { key: `f-${Date.now()}`, role: 'status', text: `Run ended: ${event.error ?? event.event}` }]);
        break;
    }
  }, []);

  async function send() {
    const text = draft.trim();
    if (!text || runId) return;
    const clientMessageId = Crypto.randomUUID();
    setDraft('');
    setPending([{ key: clientMessageId, role: 'user', text }]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { runId: id } = await sendMessage(sessionId, clientMessageId, text);
      setRunId(id);
      await followRun(id, handleEvent, controller.signal);
    } catch (e) {
      if (!controller.signal.aborted) Alert.alert('Message failed', (e as Error).message);
    } finally {
      setRunId(null);
      if (!controller.signal.aborted) {
        await reload();
        setPending((p) => p.filter((b) => b.role === 'status' && b.text.startsWith('Run ended')));
      }
    }
  }

  const data = [...history, ...pending];
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen
        options={{
          title: title || 'Chat',
          headerRight: () => (runId ? <Button title="Stop" color="#d33" onPress={() => stopRun(runId)} /> : undefined),
        }}
      />
      <FlatList
        style={styles.flex}
        contentContainerStyle={styles.list}
        data={[...data].reverse()}
        inverted
        keyExtractor={(b) => b.key}
        renderItem={({ item }) =>
          item.role === 'status' ? (
            <Text style={[styles.status, { color: colors.text }]}>{item.text}</Text>
          ) : (
            <View
              style={[
                styles.bubble,
                item.role === 'user'
                  ? [styles.user, { backgroundColor: colors.primary }]
                  : [styles.assistant, { backgroundColor: colors.card, borderColor: colors.border }],
              ]}>
              <Text selectable style={{ color: item.role === 'user' ? '#fff' : colors.text, fontSize: 16 }}>
                {item.text}
              </Text>
            </View>
          )
        }
      />
      <View style={[styles.composer, { borderColor: colors.border }]}>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border }]}
          value={draft}
          onChangeText={setDraft}
          placeholder={runId ? 'Hermes is working…' : 'Message Hermes'}
          multiline
          editable={!runId}
        />
        <Button title="Send" onPress={send} disabled={!draft.trim() || !!runId} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: 12, gap: 8 },
  bubble: { maxWidth: '85%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  user: { alignSelf: 'flex-end' },
  assistant: { alignSelf: 'flex-start', borderWidth: StyleSheet.hairlineWidth },
  status: { alignSelf: 'center', opacity: 0.6, fontSize: 13 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 8, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, maxHeight: 140, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, fontSize: 16 },
});
