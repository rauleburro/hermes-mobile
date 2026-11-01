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
import { dropChat, readChat, writeChat } from '@/lib/cache';

/** `id` is the Hermes message id (history rows only); ids grow monotonically within a session. */
type Line = { key: string; role: MessageRole | 'status'; text: string; id?: number };

/** Where the history stood before a turn: the newest message id, or the row count when ids are missing. */
type Baseline = { maxId: number | null; count: number };

const numericId = (id: SessionMessage['id']) => {
  const n = typeof id === 'number' ? id : Number(id);
  return id !== undefined && id !== null && id !== '' && Number.isFinite(n) ? n : undefined;
};

function baselineOf(lines: Line[]): Baseline {
  const ids = lines.map((l) => l.id);
  const allIds = ids.every((id) => id !== undefined);
  return { maxId: allIds && ids.length ? Math.max(...(ids as number[])) : allIds ? 0 : null, count: lines.length };
}

/** History rows that belong to turns after the baseline. The history is a sliding window, so ids win over counts. */
function rowsAfter(fresh: Line[], baseline: Baseline): Line[] {
  const { maxId } = baseline;
  if (maxId !== null && fresh.every((l) => l.id !== undefined)) return fresh.filter((l) => l.id! > maxId);
  return fresh.slice(baseline.count);
}

type ChatState =
  | { kind: 'loading' }
  | { kind: 'ready'; sessionId: string }
  | { kind: 'missing' }
  | { kind: 'unreachable' }
  | { kind: 'error'; message: string };

/** What went wrong with the last turn, and what the user can do about it. */
type Notice =
  | { kind: 'not-sent'; message: string; clientMessageId: string; text: string }
  | { kind: 'lost'; message: string }
  | { kind: 'info'; message: string };

function toLines(messages: SessionMessage[]): Line[] {
  return messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m, i) => ({ key: `h-${m.id ?? i}`, role: m.role as MessageRole, text: m.content ?? '', id: numericId(m.id) }));
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
  // First paint comes from the local cache (synchronous), then the BFF replaces it.
  const [saved] = useState(() => readChat(botId));
  const [state, setState] = useState<ChatState>(saved ? { kind: 'ready', sessionId: saved.sessionId } : { kind: 'loading' });
  const [history, setHistory] = useState<Line[]>(() => (saved ? toLines(saved.messages) : []));
  /** Whether the history on screen is the BFF's answer or the saved copy (being refreshed, or offline). */
  const [freshness, setFreshness] = useState<'fresh' | 'updating' | 'offline'>(saved ? 'updating' : 'fresh');
  const [pending, setPending] = useState<Line[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [draft, setDraft] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [workingSince, setWorkingSince] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Where the history stood before the current turn: only rows after it can be that turn.
  const baselineRef = useRef<Baseline>({ maxId: null, count: 0 });
  const elapsed = useElapsed(workingSince);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { sessionId } = await getBotChat(botId);
        const messages = await getBotMessages(botId, sessionId);
        if (!active) return;
        writeChat(botId, sessionId, messages);
        setHistory(toLines(messages));
        setState({ kind: 'ready', sessionId });
        setFreshness('fresh');
      } catch (e) {
        if (!active) return;
        const missing = e instanceof BffError && e.code === 'bot_chat_missing';
        const unreachable = e instanceof BffError && e.code === 'bot_unreachable';
        if (missing || unreachable) dropChat(botId); // The BFF's answer beats the saved copy.
        if (missing) setState({ kind: 'missing' });
        else if (unreachable) setState({ kind: 'unreachable' });
        else if (saved) setFreshness('offline');
        else setState({ kind: 'error', message: (e as Error).message });
      }
    })();
    return () => {
      active = false;
      abortRef.current?.abort();
    };
  }, [botId, saved]);

  // Bot Chat turns go through Hermes' Bot Chat queue: the stream only carries the final event.
  // Approval requests are not actionable for Bot Chat runs through the API, so they are ignored.
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

  /**
   * Reloads the Bot Chat. A pending line is dropped once the history holds a new row
   * (after the baseline) with the same role, so an older identical reply never swallows it.
   */
  async function reconcile(sessionId: string) {
    const messages = await getBotMessages(botId, sessionId);
    writeChat(botId, sessionId, messages);
    const fresh = toLines(messages);
    const added = rowsAfter(fresh, baselineRef.current);
    const newCount = { user: added.filter((l) => l.role === 'user').length, assistant: added.filter((l) => l.role === 'assistant').length };
    setHistory(fresh);
    setPending((p) =>
      p.filter((l) => {
        if (l.role === 'status') return true;
        if (newCount[l.role] > 0) {
          newCount[l.role]--;
          return false;
        }
        return true;
      }),
    );
  }

  async function runTurn(sessionId: string, text: string, clientMessageId: string) {
    const controller = new AbortController();
    abortRef.current = controller;
    setNotice(null);
    setWorkingSince(Date.now());
    let id: string | null = null;
    try {
      ({ runId: id } = await sendBotMessage(botId, clientMessageId, text));
      setRunId(id);
      await followBotRun(botId, id, handleEvent, controller.signal);
    } catch (e) {
      if (!controller.signal.aborted) {
        const message = (e as Error).message;
        // With a runId the turn was admitted and may still complete: offer a refresh, never a resend.
        setNotice(id ? { kind: 'lost', message } : { kind: 'not-sent', message, clientMessageId, text });
      }
    } finally {
      setRunId(null);
      setWorkingSince(null);
      // "Stop requested" / "Stop failed" only make sense while the turn runs.
      setNotice((n) => (n?.kind === 'info' ? null : n));
    }
    if (!controller.signal.aborted && id) await reconcile(sessionId).catch(() => {});
  }

  function send() {
    const text = draft.trim();
    // Only send against the BFF's history: the turn is reconciled against it (baseline).
    if (!text || workingSince !== null || state.kind !== 'ready' || freshness !== 'fresh') return;
    const clientMessageId = Crypto.randomUUID();
    baselineRef.current = baselineOf(history);
    // A message that was never sent is given up when the user sends a different one;
    // left pending it would be matched against the new turn's row.
    const unsentKey = notice?.kind === 'not-sent' ? `u-${notice.clientMessageId}` : null;
    setDraft('');
    setPending((p) => [
      ...p.filter((l) => l.role !== 'status' && l.key !== unsentKey),
      { key: `u-${clientMessageId}`, role: 'user', text },
    ]);
    runTurn(state.sessionId, text, clientMessageId);
  }

  function resend() {
    if (notice?.kind !== 'not-sent' || state.kind !== 'ready') return;
    runTurn(state.sessionId, notice.text, notice.clientMessageId);
  }

  async function refresh() {
    if (state.kind !== 'ready') return;
    try {
      await reconcile(state.sessionId);
      setNotice(null);
    } catch (e) {
      setNotice({ kind: 'lost', message: (e as Error).message });
    }
  }

  function stop(id: string) {
    setNotice({ kind: 'info', message: 'Stop requested' });
    stopBotRun(botId, id).catch((e) => setNotice({ kind: 'info', message: `Stop failed: ${(e as Error).message}` }));
  }

  const title = name || botId;
  const header = (
    <Stack.Screen
      options={{
        title,
        headerRight: () => (runId ? <Button title="Stop" color="#d33" onPress={() => stop(runId)} /> : undefined),
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
      {freshness !== 'fresh' ? (
        <Text style={[styles.hint, { color: colors.text }]}>
          {freshness === 'offline' ? 'Offline · showing saved messages' : 'Updating…'}
        </Text>
      ) : null}
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
      {notice ? (
        <View style={[styles.banner, { borderColor: colors.border }]}>
          <Text style={[styles.bannerText, { color: colors.text }]}>
            {notice.kind === 'not-sent'
              ? `Message not sent: ${notice.message}`
              : notice.kind === 'lost'
                ? `Lost track of the reply (${notice.message}). It may still arrive: refresh to check the Bot Chat.`
                : notice.message}
          </Text>
          {notice.kind === 'not-sent' ? <Button title="Resend" onPress={resend} disabled={working} /> : null}
          {notice.kind === 'lost' ? <Button title="Refresh" onPress={refresh} /> : null}
        </View>
      ) : null}
      <View style={[styles.composer, { borderColor: colors.border }]}>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border }]}
          value={draft}
          onChangeText={setDraft}
          placeholder={`Message ${title}`}
          multiline
          editable={!working}
        />
        <Button title="Send" onPress={send} disabled={!draft.trim() || working || freshness !== 'fresh'} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: 12, gap: 8 },
  status: { alignSelf: 'center', opacity: 0.6, fontSize: 13 },
  hint: { textAlign: 'center', opacity: 0.6, fontSize: 12, paddingVertical: 4 },
  notice: { flex: 1, padding: 24, justifyContent: 'center' },
  noticeText: { fontSize: 16, textAlign: 'center', lineHeight: 22 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth },
  bannerText: { flex: 1, fontSize: 13 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 8, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, maxHeight: 140, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, fontSize: 16 },
});
