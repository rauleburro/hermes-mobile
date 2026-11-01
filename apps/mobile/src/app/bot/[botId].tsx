import type { RunEvent, SessionMessage } from '@hermes-mobile/api';
import * as Crypto from 'expo-crypto';
import { Stack, useLocalSearchParams, useTheme } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MessageBubble, type MessageRole } from '@/components/MessageBubble';
import { BffError, followBotRun, getBotChat, getBotMessages, sendBotMessage, stopBotRun } from '@/lib/bff';

type Line = { key: string; role: MessageRole | 'status'; text: string };

type ChatState =
  | { kind: 'loading' }
  | { kind: 'ready'; sessionId: string }
  | { kind: 'missing' }
  | { kind: 'unreachable' }
  | { kind: 'error'; message: string };

function toLines(messages: SessionMessage[]): Line[] {
  return messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m, i) => ({ key: `h-${m.id ?? i}`, role: m.role as MessageRole, text: m.content ?? '' }));
}

/** Seconds since `since` while it is set, ticking once a second. */
function useElapsed(since: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}

export default function BotChatScreen() {
  const { botId, name } = useLocalSearchParams<{ botId: string; name?: string }>();
  const { colors } = useTheme();
  const [state, setState] = useState<ChatState>({ kind: 'loading' });
  const [history, setHistory] = useState<Line[]>([]);
  const [pending, setPending] = useState<Line[]>([]);
  const [draft, setDraft] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [workingSince, setWorkingSince] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const elapsed = useElapsed(workingSince);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { sessionId } = await getBotChat(botId);
        const messages = await getBotMessages(botId, sessionId);
        if (!active) return;
        setHistory(toLines(messages));
        setState({ kind: 'ready', sessionId });
      } catch (e) {
        if (!active) return;
        if (e instanceof BffError && e.code === 'bot_chat_missing') setState({ kind: 'missing' });
        else if (e instanceof BffError && e.code === 'bot_unreachable') setState({ kind: 'unreachable' });
        else setState({ kind: 'error', message: (e as Error).message });
      }
    })();
    return () => {
      active = false;
      abortRef.current?.abort();
    };
  }, [botId]);

  // Bot Chat turns go through Hermes' Bot Chat queue: the stream only carries the final event.
  const handleEvent = useCallback((event: RunEvent) => {
    switch (event.event) {
      case 'run.completed':
        if (event.output) setPending((p) => [...p, { key: `a-${event.run_id}`, role: 'assistant', text: event.output! }]);
        break;
      case 'run.failed':
      case 'run.cancelled':
      case 'run.interrupted':
        setPending((p) => [...p, { key: `f-${event.run_id}`, role: 'status', text: `Run ended: ${event.error ?? event.event}` }]);
        break;
    }
  }, []);

  /** Reloads the Bot Chat and keeps only pending lines the history doesn't hold yet. */
  async function reconcile(sessionId: string) {
    try {
      const fresh = toLines(await getBotMessages(botId, sessionId));
      setHistory(fresh);
      setPending((p) => p.filter((l) => l.role === 'status' || !fresh.some((h) => h.role === l.role && h.text === l.text)));
    } catch {
      // Keep what we have; the next visit reloads it.
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || workingSince !== null || state.kind !== 'ready') return;
    const clientMessageId = Crypto.randomUUID();
    const controller = new AbortController();
    abortRef.current = controller;
    setDraft('');
    setPending((p) => [...p.filter((l) => l.role !== 'status'), { key: `u-${clientMessageId}`, role: 'user', text }]);
    setWorkingSince(Date.now());
    try {
      const { runId: id } = await sendBotMessage(botId, clientMessageId, text);
      setRunId(id);
      await followBotRun(botId, id, handleEvent, controller.signal);
    } catch (e) {
      if (!controller.signal.aborted) {
        setPending((p) => [...p, { key: `e-${clientMessageId}`, role: 'status', text: `Message failed: ${(e as Error).message}` }]);
      }
    } finally {
      setRunId(null);
      setWorkingSince(null);
      if (!controller.signal.aborted) await reconcile(state.sessionId);
    }
  }

  const title = name || botId;
  const header = (
    <Stack.Screen
      options={{
        title,
        headerRight: () =>
          runId ? <Button title="Stop" color="#d33" onPress={() => stopBotRun(botId, runId).catch(() => {})} /> : undefined,
      }}
    />
  );

  if (state.kind !== 'ready') {
    const message =
      state.kind === 'loading'
        ? 'Loading…'
        : state.kind === 'missing'
          ? `${title} has no Bot Chat yet. Open this Bot once in Hermes Desktop (Bots tab) to create it, then come back.`
          : state.kind === 'unreachable'
            ? "The BFF can't reach this Bot: it has no API key for it yet."
            : `Could not load the Bot Chat: ${state.message}`;
    return (
      <View style={styles.notice}>
        {header}
        <Text style={[styles.noticeText, { color: colors.text }]}>{message}</Text>
      </View>
    );
  }

  const working = workingSince !== null;
  const lines: Line[] = [...history, ...pending];
  if (working) lines.push({ key: 'working', role: 'status', text: `Working… ${elapsed}s` });

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      {header}
      <FlatList
        style={styles.flex}
        contentContainerStyle={styles.list}
        data={[...lines].reverse()}
        inverted
        keyExtractor={(l) => l.key}
        renderItem={({ item }) =>
          item.role === 'status' ? (
            <Text style={[styles.status, { color: colors.text }]}>{item.text}</Text>
          ) : (
            <MessageBubble role={item.role} text={item.text} />
          )
        }
      />
      <View style={[styles.composer, { borderColor: colors.border }]}>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border }]}
          value={draft}
          onChangeText={setDraft}
          placeholder={`Message ${title}`}
          multiline
          editable={!working}
        />
        <Button title="Send" onPress={send} disabled={!draft.trim() || working} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: 12, gap: 8 },
  status: { alignSelf: 'center', opacity: 0.6, fontSize: 13 },
  notice: { flex: 1, padding: 24, justifyContent: 'center' },
  noticeText: { fontSize: 16, textAlign: 'center', lineHeight: 22 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 8, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, maxHeight: 140, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, fontSize: 16 },
});
