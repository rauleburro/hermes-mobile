import type {
  ApprovalChoice,
  HealthResponse,
  RunEvent,
  SendMessageResponse,
  SessionMessage,
  SessionSummary,
} from '@hermes-mobile/api';
import { TERMINAL_EVENTS } from '@hermes-mobile/api';
import { fetch as streamingFetch } from 'expo/fetch';
import { loadConfig, type BffConfig } from './config';
import { createSseParser } from './sse';

export class BffError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function requireConfig(): Promise<BffConfig> {
  const config = await loadConfig();
  if (!config) throw new BffError('Not paired with a BFF');
  return config;
}

async function request<T>(path: string, init: RequestInit = {}, config?: BffConfig): Promise<T> {
  const { url, token } = config ?? (await requireConfig());
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok) throw new BffError(`${init.method ?? 'GET'} ${path} failed (${res.status})`, res.status);
  return (await res.json()) as T;
}

export const checkHealth = (config: BffConfig) => request<HealthResponse>('/health', {}, config);

export const listSessions = () =>
  request<{ data: SessionSummary[] }>('/sessions?limit=50').then((r) => r.data);

export async function createSession(): Promise<string> {
  const res = await request<{ id?: string; session_id?: string; session?: { id: string } }>('/sessions', {
    method: 'POST',
    body: JSON.stringify({ source: 'hermes-mobile' }),
  });
  const id = res.session?.id ?? res.id ?? res.session_id;
  if (!id) throw new BffError('Hermes did not return a session id');
  return id;
}

export const getMessages = (sessionId: string) =>
  request<{ data: SessionMessage[] }>(`/sessions/${encodeURIComponent(sessionId)}/messages`).then((r) => r.data);

/** Retries with the same clientMessageId, so a lost response never creates a duplicate run. */
export async function sendMessage(sessionId: string, clientMessageId: string, text: string, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await request<SendMessageResponse>('/chat/send', {
        method: 'POST',
        body: JSON.stringify({ sessionId, clientMessageId, text }),
      });
    } catch (error) {
      lastError = error;
      if (error instanceof BffError && error.status && error.status < 500) throw error;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastError;
}

export const resolveApproval = (runId: string, choice: ApprovalChoice, requestId?: string, generation?: number) =>
  request(`/runs/${encodeURIComponent(runId)}/approval`, {
    method: 'POST',
    body: JSON.stringify({ choice, request_id: requestId, execution_generation: generation }),
  });

export const stopRun = (runId: string) => request(`/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' });

/**
 * Follows a run's events until a terminal event, reconnecting with Last-Event-ID
 * when the connection drops. Resolves when the run ends or `signal` aborts.
 */
export async function followRun(runId: string, onEvent: (event: RunEvent) => void, signal: AbortSignal) {
  const { url, token } = await requireConfig();
  let lastSeq: string | undefined;
  let done = false;
  let failures = 0;

  while (!done && !signal.aborted) {
    try {
      const res = await streamingFetch(`${url}/runs/${encodeURIComponent(runId)}/events`, {
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
        const run = await request<{ status: string; output?: string }>(`/runs/${encodeURIComponent(runId)}`);
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
