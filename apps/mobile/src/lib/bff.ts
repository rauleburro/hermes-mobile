import type {
  BotChatMessagesQuery,
  BotChatMessagesResponse,
  BotChatResponse,
  BotSendRequest,
  BotsResponse,
  HealthResponse,
  RunEvent,
  SendMessageResponse,
  SessionMessage,
} from '@hermes-mobile/api';
import { TERMINAL_EVENTS } from '@hermes-mobile/api';
import { fetch as streamingFetch } from 'expo/fetch';
import { loadConfig, type BffConfig } from './config';
import { createSseParser } from './sse';

export class BffError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** The BFF's machine-readable `error` field, e.g. `bot_chat_missing`. */
    readonly code?: string,
  ) {
    super(message);
  }
}

async function requireConfig(): Promise<BffConfig> {
  const config = await loadConfig();
  if (!config) throw new BffError('Not paired with a BFF');
  return config;
}

/**
 * How long a BFF request may take, body included. React Native's fetch has no timeout of its own
 * (Android's OkHttp client is built without one), so a request on a half-open socket would hang.
 */
export const REQUEST_TIMEOUT_MS = 15_000;
/**
 * The first full load of a Bot Chat's history: up to 500 rows, with tool output ~3 KB a row
 * (~1.5 MB). Measured ~7.6 s at 200 KB/s and ~30 s at 50 KB/s, so a slow mobile link needs more
 * than the default. That load runs right after the Bot Chat lookup, which catches a dead BFF at
 * REQUEST_TIMEOUT_MS. Reloads with rows already on screen (end of turn, catch-up before a send,
 * Refresh) have no lookup first, so they pass REQUEST_TIMEOUT_MS: a dead BFF must not hold a send.
 */
export const HISTORY_TIMEOUT_MS = 45_000;

type Deadline = {
  ms: number;
  /** The caller's signal: aborting it aborts the work at once. */
  signal?: AbortSignal | null;
  onTimeout: () => Error;
  onAbort: () => Error;
};

/**
 * Runs `work` with an AbortSignal that aborts after `ms` or when the caller's signal aborts, and
 * rejects then even if `work` ignores the signal. The caller's signal is linked by hand (works on
 * any engine, no `AbortSignal.any` needed); its listener and the timer go once `work` settles.
 */
function withDeadline<T>({ ms, signal: outer, onTimeout, onAbort }: Deadline, work: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  let fail: (error: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => (fail = reject));
  const stop = (error: Error) => {
    controller.abort();
    fail(error);
  };
  const callerAborted = () => stop(onAbort());
  if (outer?.aborted) callerAborted();
  else outer?.addEventListener('abort', callerAborted);
  const timer = setTimeout(() => stop(onTimeout()), ms);
  return Promise.race([work(controller.signal), stopped]).finally(() => {
    clearTimeout(timer);
    outer?.removeEventListener('abort', callerAborted);
  });
}

/**
 * A timeout throws a BffError with code `timeout` and no HTTP status: like a network failure,
 * it reads as "Offline" next to saved data and is retried as transient. `init.signal` still
 * aborts the request (BffError code `aborted`).
 */
export async function request<T>(
  path: string,
  init: RequestInit = {},
  config?: BffConfig,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const { url, token } = config ?? (await requireConfig());
  const { signal: callerSignal, ...rest } = init;
  const method = init.method ?? 'GET';
  const deadline: Deadline = {
    ms: timeoutMs,
    signal: callerSignal,
    onTimeout: () => new BffError(`${method} ${path} timed out`, undefined, 'timeout'),
    onAbort: () => new BffError(`${method} ${path} aborted`, undefined, 'aborted'),
  };
  return withDeadline(deadline, async (signal) => {
    const res = await fetch(`${url}${path}`, {
      ...rest,
      signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      const code = typeof body?.error === 'string' ? body.error : undefined;
      throw new BffError(`${method} ${path} failed (${res.status})`, res.status, code);
    }
    return (await res.json()) as T;
  });
}

export const checkHealth = (config: BffConfig) => request<HealthResponse>('/health', {}, config);

const bot = (botId: string) => `/bots/${encodeURIComponent(botId)}`;
const botRun = (botId: string, runId: string, suffix = '') => `${bot(botId)}/runs/${encodeURIComponent(runId)}${suffix}`;

export const listBots = () => request<BotsResponse>('/bots');

/** The Bot's canonical Bot Chat. Throws a BffError with code `bot_chat_missing` (409) when it doesn't exist yet. */
export const getBotChat = (botId: string) => request<BotChatResponse>(`${bot(botId)}/chat`);

/** The whole Bot Chat history; `timeoutMs` defaults to HISTORY_TIMEOUT_MS (see there). */
export const getBotMessages = (botId: string, sessionId: string, { timeoutMs = HISTORY_TIMEOUT_MS } = {}) =>
  request<{ data: SessionMessage[] }>(
    `/sessions/${encodeURIComponent(sessionId)}/messages?bot=${encodeURIComponent(botId)}`,
    {},
    undefined,
    timeoutMs,
  ).then((r) => r.data);

/** A page of the Bot's Bot Chat (the BFF resolves it). Rows are chronological in both orders. */
export function getBotChatMessages(botId: string, query: BotChatMessagesQuery = {}) {
  const params = new URLSearchParams();
  for (const key of ['order', 'offset', 'limit'] as const) {
    if (query[key] !== undefined) params.set(key, String(query[key]));
  }
  const qs = params.toString();
  return request<BotChatMessagesResponse>(`${bot(botId)}/chat/messages${qs ? `?${qs}` : ''}`).then((r) => r.data);
}

/**
 * Sends a turn to the Bot's Bot Chat (the BFF resolves it). Retries with the same clientMessageId,
 * so a lost response never creates a duplicate turn; 4xx answers are final.
 */
export async function sendBotMessage(botId: string, clientMessageId: string, text: string, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await request<SendMessageResponse>(`${bot(botId)}/send`, {
        method: 'POST',
        body: JSON.stringify({ clientMessageId, text } satisfies BotSendRequest),
      });
    } catch (error) {
      lastError = error;
      if (error instanceof BffError && error.status && error.status < 500) throw error;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastError;
}

/** Hermes 0.22.5 doesn't stop a queued Bot Chat turn; the request is still sent so newer versions can. */
export const stopBotRun = (botId: string, runId: string) => request(botRun(botId, runId, '/stop'), { method: 'POST' });

/**
 * How long a run's event stream may stay silent before it is treated as dead and reopened.
 * Hermes writes an SSE keepalive comment every 10 s while a run is quiet, and the BFF relays
 * the bytes unchanged, so three missed keepalives mean a half-open or stalled connection.
 */
export const SSE_IDLE_TIMEOUT_MS = 30_000;

/**
 * Watches one stream connection: aborts it after `ms` with no bytes (including while connecting),
 * or when `outer` aborts. `guard` races a step of the connection against that, so a fetch or read
 * that ignores the abort can't hang the caller; each step that settles resets the timer.
 */
function watchConnection(outer: AbortSignal, ms: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fail: (error: Error) => void = () => {};
  const tripped = new Promise<never>((_, reject) => (fail = reject));
  tripped.catch(() => {}); // Only observed through guard().
  const trip = (error: Error) => {
    clearTimeout(timer);
    controller.abort();
    fail(error);
  };
  const onAbort = () => trip(new BffError('events aborted'));
  outer.addEventListener('abort', onAbort);
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(() => trip(new BffError(`events idle for ${ms / 1000} s`, undefined, 'timeout')), ms);
  };
  reset();
  return {
    signal: controller.signal,
    guard: <T>(step: Promise<T>): Promise<T> =>
      Promise.race([step, tripped]).then((value) => {
        reset();
        return value;
      }),
    stop: () => {
      clearTimeout(timer);
      outer.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * Follows a Bot run's events until a terminal event, reconnecting with Last-Event-ID when the
 * connection drops or goes silent for {@link SSE_IDLE_TIMEOUT_MS}. Resolves when the run ends or
 * `signal` aborts.
 */
export async function followBotRun(
  botId: string,
  runId: string,
  onEvent: (event: RunEvent) => void,
  signal: AbortSignal,
) {
  const { url, token } = await requireConfig();
  let lastSeq: string | undefined;
  let done = false;
  let failures = 0;

  while (!done && !signal.aborted) {
    try {
      const connection = watchConnection(signal, SSE_IDLE_TIMEOUT_MS);
      try {
        const res = await connection.guard(
          streamingFetch(`${url}${botRun(botId, runId, '/events')}`, {
            headers: { Authorization: `Bearer ${token}`, ...(lastSeq ? { 'Last-Event-ID': lastSeq } : {}) },
            signal: connection.signal,
          }),
        );
        if (!res.ok || !res.body) throw new BffError(`events failed (${res.status})`, res.status);
        failures = 0;
        const decoder = new TextDecoder();
        const parse = createSseParser((frame) => {
          if (frame.id) lastSeq = frame.id;
          const event = JSON.parse(frame.data) as RunEvent;
          onEvent(event);
          if (TERMINAL_EVENTS.has(event.event)) done = true;
        });
        const reader = res.body.getReader();
        while (!done) {
          // Any bytes count as life, keepalive comments included (they never become frames).
          const { value, done: streamDone } = await connection.guard(reader.read());
          if (streamDone) break;
          parse(decoder.decode(value, { stream: true }));
        }
      } finally {
        connection.stop();
      }
      if (!done) {
        // Stream closed without a terminal event: the run may already be over (buffer expired).
        const run = await request<{ status: string; output?: string }>(botRun(botId, runId), { signal });
        if (['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status)) {
          onEvent({ event: `run.${run.status}`, run_id: runId, timestamp: Date.now() / 1000, output: run.output } as RunEvent);
          done = true;
        }
      }
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof BffError && error.status === 404) throw error;
      // Counts connections in a row that never opened (refused, an error status, or silent while
      // connecting); six of them report the turn lost. A connection that opens resets the count, so
      // a stream that keeps opening and then stalling is reopened until the turn's polling cap
      // (useTurnPolling) ends the turn: reopening with Last-Event-ID is cheap.
      failures++;
      if (failures > 5) throw error;
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** failures, 10_000)));
    }
  }
}
