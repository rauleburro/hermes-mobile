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
 * Runs `work` with an AbortSignal that aborts after `ms`, and rejects with `onTimeout()` then even
 * if `work` ignores the signal. The timer is cleared as soon as `work` settles.
 */
function withTimeout<T>(ms: number, work: (signal: AbortSignal) => Promise<T>, onTimeout: () => Error): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(onTimeout());
    }, ms);
  });
  return Promise.race([work(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

/**
 * A timeout throws a BffError with code `timeout` and no HTTP status: like a network failure,
 * it reads as "Offline" next to saved data and is retried as transient.
 */
async function request<T>(path: string, init: RequestInit = {}, config?: BffConfig): Promise<T> {
  const { url, token } = config ?? (await requireConfig());
  const method = init.method ?? 'GET';
  return withTimeout(
    REQUEST_TIMEOUT_MS,
    async (signal) => {
      const res = await fetch(`${url}${path}`, {
        ...init,
        signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
        const code = typeof body?.error === 'string' ? body.error : undefined;
        throw new BffError(`${method} ${path} failed (${res.status})`, res.status, code);
      }
      return (await res.json()) as T;
    },
    () => new BffError(`${method} ${path} timed out`, undefined, 'timeout'),
  );
}

export const checkHealth = (config: BffConfig) => request<HealthResponse>('/health', {}, config);

const bot = (botId: string) => `/bots/${encodeURIComponent(botId)}`;
const botRun = (botId: string, runId: string, suffix = '') => `${bot(botId)}/runs/${encodeURIComponent(runId)}${suffix}`;

export const listBots = () => request<BotsResponse>('/bots');

/** The Bot's canonical Bot Chat. Throws a BffError with code `bot_chat_missing` (409) when it doesn't exist yet. */
export const getBotChat = (botId: string) => request<BotChatResponse>(`${bot(botId)}/chat`);

export const getBotMessages = (botId: string, sessionId: string) =>
  request<{ data: SessionMessage[] }>(
    `/sessions/${encodeURIComponent(sessionId)}/messages?bot=${encodeURIComponent(botId)}`,
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
 * Follows a Bot run's events until a terminal event, reconnecting with Last-Event-ID
 * when the connection drops. Resolves when the run ends or `signal` aborts.
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
      const res = await streamingFetch(`${url}${botRun(botId, runId, '/events')}`, {
        headers: { Authorization: `Bearer ${token}`, ...(lastSeq ? { 'Last-Event-ID': lastSeq } : {}) },
        signal,
      });
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
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        parse(decoder.decode(value, { stream: true }));
      }
      if (!done) {
        // Stream closed without a terminal event: the run may already be over (buffer expired).
        const run = await request<{ status: string; output?: string }>(botRun(botId, runId));
        if (['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status)) {
          onEvent({ event: `run.${run.status}`, run_id: runId, timestamp: Date.now() / 1000, output: run.output } as RunEvent);
          done = true;
        }
      }
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof BffError && error.status === 404) throw error;
      failures++;
      if (failures > 5) throw error;
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** failures, 10_000)));
    }
  }
}
