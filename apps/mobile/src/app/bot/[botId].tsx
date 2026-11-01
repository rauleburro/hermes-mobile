import type { RunEvent, SessionMessage } from '@hermes-mobile/api';
import * as Crypto from 'expo-crypto';
import { Stack, useLocalSearchParams, useTheme } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
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
import { ToolCard } from '@/components/ToolCard';
import { BffError, followBotRun, getBotChat, getBotMessages, sendBotMessage, stopBotRun } from '@/lib/bff';
import { dropChat, readChat, savedDataHint, writeChat } from '@/lib/cache';
import { buildChatItems, isFinalAnswer, maxRowId, mergeRows, type ChatItem } from '@/lib/chatItems';
import { loadConfig, pairedUrl } from '@/lib/config';
import { useTurnPolling } from '@/lib/useTurnPolling';

type Line = { key: string; role: MessageRole | 'status'; text: string };
type Item = ChatItem | { kind: 'status'; key: string; text: string };

/** Where the Bot Chat stood when a turn was sent: only rows after it can belong to that turn. */
type Baseline = { count: number; maxId: number };

const hasId = (r: SessionMessage) => r.id != null && Number.isFinite(Number(r.id));
/** User and assistant rows with text: what the positional fallback counts. */
const isTextRow = (r: SessionMessage) =>
  (r.role === 'user' || r.role === 'assistant') && r.display_kind !== 'hidden' && Boolean(r.content?.trim());

/** Rows newer than the baseline: by id when rows carry one, else by position among text rows. */
function rowsAfter(rows: SessionMessage[], { count, maxId }: Baseline) {
  let position = 0;
  return rows.filter((r) => {
    if (hasId(r)) return Number(r.id) > maxId;
    return isTextRow(r) && position++ >= count;
  });
}

/**
 * Drops pending lines the Bot Chat now holds: one per new user row, and one per new final answer
 * (interim text next to a tool call is not the reply). Matching is by role, since Hermes may store
 * text slightly differently, and only against rows after the baseline, so an older identical line
 * never swallows a new one.
 */
function dropDelivered(pending: Line[], added: SessionMessage[]): Line[] {
  const left = {
    user: added.filter((r) => r.role === 'user' && isTextRow(r)).length,
    assistant: added.filter((r) => isTextRow(r) && isFinalAnswer(r)).length,
  };
  const next = pending.filter((l) => {
    if (l.role === 'status' || left[l.role] === 0) return true;
    left[l.role]--;
    return false;
  });
  return next.length === pending.length ? pending : next;
}

/**
 * The live turn's stored final answer: one after the turn's own user row (same text, after the
 * baseline). Anchoring on that row keeps an earlier turn's late rows from passing for this one.
 */
function turnAnswer(rows: SessionMessage[], baseline: Baseline, text: string): SessionMessage | undefined {
  const added = rowsAfter(rows, baseline);
  let userAt = -1;
  added.forEach((r, i) => {
    if (r.role === 'user' && isTextRow(r) && r.content!.trim() === text) userAt = i;
  });
  if (userAt < 0) return undefined;
  return added.slice(userAt + 1).find((r) => isTextRow(r) && isFinalAnswer(r));
}

/**
 * The turn in flight, and why it ended early: its answer was polled, or polling gave up.
 * `trustRows` is false when the shown rows are stale (a reload failed): an earlier turn with the
 * same text could then pass for this one, so only the stream or the polling cap may end it.
 */
type Turn = { text: string; end: 'answered' | 'expired' | null; trustRows: boolean };

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
  | { kind: 'stale'; message: string }
  | { kind: 'info'; message: string };

/** The paired BFF's URL, read before a fetch so its result is saved under the BFF it came from. */
const currentBff = () => loadConfig().then((c) => c?.url ?? null, () => null);

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
  // First paint comes from the paired BFF's saved copy (synchronous), then the BFF replaces it.
  // The saved copy is text only, so tool cards only ever come from the BFF.
  const [saved] = useState(() => readChat(pairedUrl(), botId));
  const [state, setState] = useState<ChatState>(saved ? { kind: 'ready', sessionId: saved.sessionId } : { kind: 'loading' });
  const [rows, setRows] = useState<SessionMessage[]>(() => saved?.messages ?? []);
  /** Whether the rows on screen are the BFF's answer or the saved copy (being refreshed, or offline). */
  const [freshness, setFreshness] = useState<'fresh' | 'updating' | 'offline'>(saved ? 'updating' : 'fresh');
  /** Why the saved copy is on screen after a failed load ("Offline", or the BFF's error). */
  const [savedHint, setSavedHint] = useState<string | null>(null);
  /** Whether rows (saved or fresh) are on screen, so a failed load keeps them rather than erroring. */
  const shownRef = useRef(saved !== null);
  const freshnessRef = useRef(freshness);
  useEffect(() => {
    freshnessRef.current = freshness;
  }, [freshness]);
  const loadGenRef = useRef(0);
  const [pending, setPending] = useState<Line[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [draft, setDraft] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [workingSince, setWorkingSince] = useState<number | null>(null);
  // True from send until the run's terminal event: the Bot Chat is polled for tool progress.
  const [polling, setPolling] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const rowsRef = useRef<SessionMessage[]>(rows);
  const baselineRef = useRef<Baseline>({ count: 0, maxId: -Infinity });
  // The live turn's baseline row id, for render: unanswered tool calls after it are running.
  const [liveAfterId, setLiveAfterId] = useState(-Infinity);
  const elapsed = useElapsed(workingSince);

  /** Shows a new set of Bot Chat rows and drops the pending lines they now hold. */
  const showRows = useCallback((next: SessionMessage[]) => {
    if (next === rowsRef.current) return;
    rowsRef.current = next;
    setRows(next);
    // Against the baseline as of now: a send right after may move it before the updater runs.
    const added = rowsAfter(next, baselineRef.current);
    setPending((p) => dropDelivered(p, added));
  }, []);

  const turnRef = useRef<Turn | null>(null);
  // Set when a reload of the Bot Chat failed, so the shown rows may miss a finished turn.
  const staleRef = useRef(false);

  /** Ends the turn without waiting for its stream, which may never end (e.g. a half-open connection). */
  const endTurnEarly = useCallback((reason: 'answered' | 'expired') => {
    const turn = turnRef.current;
    if (!turn || turn.end) return;
    turn.end = reason;
    setPolling(false);
    abortRef.current?.abort();
  }, []);

  const onPolledRows = useCallback(
    (polled: SessionMessage[]) => {
      const next = mergeRows(rowsRef.current, polled);
      showRows(next);
      const turn = turnRef.current;
      if (turn?.trustRows && turnAnswer(next, baselineRef.current, turn.text)) endTurnEarly('answered');
    },
    [showRows, endTurnEarly],
  );
  const onPollExpired = useCallback(() => endTurnEarly('expired'), [endTurnEarly]);
  // Never polls next to the saved copy: polling is per turn, and a turn only starts on the BFF's rows (see send).
  useTurnPolling(botId, polling, onPolledRows, onPollExpired);

  /** Loads the Bot Chat from the BFF and replaces whatever is on screen. Only the latest load applies. */
  const load = useCallback(async () => {
    const gen = ++loadGenRef.current;
    const bff = await currentBff();
    if (shownRef.current) setFreshness((f) => (f === 'fresh' ? f : 'updating'));
    try {
      const { sessionId } = await getBotChat(botId);
      const messages = await getBotMessages(botId, sessionId);
      if (gen !== loadGenRef.current) return;
      if (bff) writeChat(bff, botId, sessionId, messages);
      shownRef.current = true;
      rowsRef.current = messages;
      setRows(messages);
      setState({ kind: 'ready', sessionId });
      setFreshness('fresh');
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      const missing = e instanceof BffError && e.code === 'bot_chat_missing';
      const unreachable = e instanceof BffError && e.code === 'bot_unreachable';
      if (missing || unreachable) {
        dropChat(botId); // The BFF's answer beats the saved copy.
        shownRef.current = false;
        setFreshness('fresh');
      }
      if (missing) setState({ kind: 'missing' });
      else if (unreachable) setState({ kind: 'unreachable' });
      else if (shownRef.current) {
        setSavedHint(savedDataHint(e, 'messages'));
        setFreshness('offline');
      } else setState({ kind: 'error', message: (e as Error).message });
    }
  }, [botId]);

  useEffect(() => {
    // State only changes once the load has data (load awaits first); scheduling it keeps that explicit.
    let live = true;
    Promise.resolve().then(() => {
      if (live) load();
    });
    const loads = loadGenRef;
    return () => {
      live = false;
      loads.current++; // Drop a load still in flight.
      abortRef.current?.abort();
    };
  }, [load]);

  // Showing the saved copy: try again when the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'active' && freshnessRef.current !== 'fresh') load();
    });
    return () => sub.remove();
  }, [load]);

  // Bot Chat turns go through Hermes' Bot Chat queue: the stream only carries the final event.
  // Approval requests are not actionable for Bot Chat runs through the API, so they are ignored.
  // Progress comes from polling the Bot Chat (useTurnPolling) until the terminal event.
  const handleEvent = useCallback((event: RunEvent) => {
    switch (event.event) {
      case 'run.completed': {
        setPolling(false);
        // The poll may already have shown the stored answer: don't add a second copy.
        const turn = turnRef.current;
        const shown = Boolean(turn?.trustRows && turnAnswer(rowsRef.current, baselineRef.current, turn.text));
        if (event.output && !shown) setPending((p) => [...p, { key: `a-${event.run_id}`, role: 'assistant', text: event.output! }]);
        break;
      }
      case 'run.failed':
      case 'run.cancelled':
      case 'run.interrupted':
        setPolling(false);
        setPending((p) => [...p, { key: `f-${event.run_id}`, role: 'status', text: `Run ended: ${event.error ?? event.event}` }]);
        break;
    }
  }, []);

  /** Reloads the Bot Chat; pending lines it now holds are dropped (see dropDelivered). */
  async function reconcile(sessionId: string) {
    const bff = await currentBff();
    const messages = await getBotMessages(botId, sessionId);
    if (bff) writeChat(bff, botId, sessionId, messages);
    setFreshness('fresh');
    showRows(messages);
    staleRef.current = false;
  }

  async function runTurn(sessionId: string, text: string, clientMessageId: string, trustRows: boolean) {
    const controller = new AbortController();
    abortRef.current = controller;
    const turn: Turn = { text, end: null, trustRows };
    turnRef.current = turn;
    setNotice(null);
    setWorkingSince(Date.now());
    setPolling(true);
    let id: string | null = null;
    try {
      ({ runId: id } = await sendBotMessage(botId, clientMessageId, text));
      setRunId(id);
      if (!controller.signal.aborted) await followBotRun(botId, id, handleEvent, controller.signal);
    } catch (e) {
      if (!controller.signal.aborted) {
        const message = (e as Error).message;
        // With a runId the turn was admitted and may still complete: offer a refresh, never a resend.
        setNotice(id ? { kind: 'lost', message } : { kind: 'not-sent', message, clientMessageId, text });
      }
    } finally {
      setRunId(null);
      setWorkingSince(null);
      setPolling(false);
      // "Stop requested" / "Stop failed" only make sense while the turn runs.
      setNotice((n) => (n?.kind === 'info' ? null : n));
    }
    if (turn.end === 'expired') setNotice({ kind: 'lost', message: 'no reply after 10 minutes' });
    // An abort without an early end is an unmount: nothing to reload.
    if ((!controller.signal.aborted || turn.end) && id) {
      // Stale until the reload lands: a turn sent meanwhile must not trust the rows on screen.
      staleRef.current = true;
      await reconcile(sessionId).catch((e) => {
        staleRef.current = true;
        setNotice({ kind: 'stale', message: (e as Error).message });
      });
    }
  }

  async function send() {
    const text = draft.trim();
    // Only send against the BFF's rows: the turn is reconciled against them (baseline).
    if (!text || workingSince !== null || state.kind !== 'ready' || freshness !== 'fresh') return;
    const clientMessageId = Crypto.randomUUID();
    // A message that was never sent is given up when the user sends a different one;
    // left pending it would be matched against the new turn's row.
    const unsentKey = notice?.kind === 'not-sent' ? `u-${notice.clientMessageId}` : null;
    setDraft('');
    if (staleRef.current) {
      // The last reload failed: catch up first, so the baseline covers every finished turn.
      setWorkingSince(Date.now());
      await reconcile(state.sessionId).catch(() => {});
    }
    const current = rowsRef.current;
    baselineRef.current = { count: current.filter(isTextRow).length, maxId: maxRowId(current) };
    setLiveAfterId(baselineRef.current.maxId);
    setPending((p) => [
      ...p.filter((l) => l.role !== 'status' && l.key !== unsentKey),
      { key: `u-${clientMessageId}`, role: 'user', text },
    ]);
    runTurn(state.sessionId, text, clientMessageId, !staleRef.current);
  }

  function resend() {
    if (notice?.kind !== 'not-sent' || state.kind !== 'ready') return;
    runTurn(state.sessionId, notice.text, notice.clientMessageId, !staleRef.current);
  }

  async function refresh() {
    if (state.kind !== 'ready') return;
    try {
      await reconcile(state.sessionId);
      setNotice(null);
    } catch (e) {
      setNotice({ kind: staleRef.current ? 'stale' : 'lost', message: (e as Error).message });
    }
  }

  function stop(id: string) {
    setNotice({ kind: 'info', message: 'Stop requested' });
    stopBotRun(botId, id).catch((e) => setNotice({ kind: 'info', message: `Stop failed: ${(e as Error).message}` }));
  }

  const working = workingSince !== null;
  // Rebuilt only when rows or the live turn change, not on the once-a-second Working tick.
  const chatItems = useMemo(
    () => buildChatItems(rows, { liveAfterId: working ? liveAfterId : undefined }),
    [rows, working, liveAfterId],
  );

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

  const items: Item[] = [
    ...chatItems,
    ...pending.map((l): Item =>
      l.role === 'status' ? { kind: 'status', key: l.key, text: l.text } : { kind: 'message', key: l.key, role: l.role, text: l.text },
    ),
  ];
  if (working) items.push({ kind: 'status', key: 'working', text: `Working… ${elapsed}s` });

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      {header}
      {freshness !== 'fresh' ? (
        <View style={styles.hintRow}>
          <Text style={[styles.hint, { color: colors.text }]}>{freshness === 'offline' ? savedHint : 'Updating…'}</Text>
          {freshness === 'offline' ? <Button title="Retry" onPress={load} /> : null}
        </View>
      ) : null}
      <FlatList
        style={styles.flex}
        contentContainerStyle={styles.list}
        data={[...items].reverse()}
        inverted
        keyExtractor={(item) => item.key}
        renderItem={({ item }) =>
          item.kind === 'status' ? (
            <Text style={[styles.status, { color: colors.text }]}>{item.text}</Text>
          ) : item.kind === 'tool' ? (
            <ToolCard name={item.name} args={item.args} rawArgs={item.rawArgs} status={item.status} result={item.result} />
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
                : notice.kind === 'stale'
                  ? `Couldn't refresh the Bot Chat (${notice.message}). Some messages may be missing.`
                  : notice.message}
          </Text>
          {notice.kind === 'not-sent' ? <Button title="Resend" onPress={resend} disabled={working} /> : null}
          {notice.kind === 'lost' || notice.kind === 'stale' ? <Button title="Refresh" onPress={refresh} /> : null}
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
  hintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 2 },
  hint: { textAlign: 'center', opacity: 0.6, fontSize: 12, paddingVertical: 4 },
  notice: { flex: 1, padding: 24, justifyContent: 'center' },
  noticeText: { fontSize: 16, textAlign: 'center', lineHeight: 22 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth },
  bannerText: { flex: 1, fontSize: 13 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 8, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, maxHeight: 140, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, fontSize: 16 },
});
