// Contract between the mobile app and the BFF. Hermes shapes mirror
// gateway/platforms/api_server*.py (Hermes Agent v0.22.0).

export type SessionSummary = {
  id: string;
  title?: string | null;
  source?: string | null;
  started_at?: number | string | null;
  last_active?: number | string | null;
  message_count?: number | null;
  preview?: string | null;
};

export type SessionMessage = {
  id?: string | number;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  timestamp?: number | string | null;
  tool_name?: string | null;
};

export type BotSummary = {
  /** Hermes profile id; `default` is the primary Bot (@hermes). */
  id: string;
  name: string;
  title: string | null;
  description: string | null;
  /** False when the BFF has no API key for this profile yet. */
  reachable: boolean;
};

export type BotsResponse = { botModeEnabled: boolean; bots: BotSummary[] };

export type BotChatResponse = { botId: string; sessionId: string };

export type SendMessageRequest = {
  /** Hermes profile id; defaults to `default`. */
  botId?: string;
  sessionId: string;
  /** Client-generated, reused on retry; becomes the Hermes Idempotency-Key. */
  clientMessageId: string;
  text: string;
};

export type SendMessageResponse = { runId: string; replayed: boolean };

export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_approval'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny';

type EventBase = { run_id: string; timestamp: number; seq?: number };

/** Events on GET /v1/runs/{id}/events that the app renders. Others pass through as `unknown`. */
export type RunEvent =
  | (EventBase & { event: 'run.started' | 'run.queued' | 'run.stopping' })
  | (EventBase & { event: 'message.delta'; delta: string })
  | (EventBase & { event: 'message.interim'; text: string; already_streamed?: boolean })
  | (EventBase & { event: 'tool.started'; tool: string; preview?: string })
  | (EventBase & { event: 'tool.completed' | 'tool.failed'; tool: string; duration?: number; error?: boolean; preview?: string })
  | (EventBase & { event: 'approval.request'; command?: string; description?: string; choices: ApprovalChoice[]; request_id?: string; execution_generation?: number })
  | (EventBase & { event: 'run.completed'; output?: string })
  | (EventBase & { event: 'run.failed' | 'run.cancelled' | 'run.interrupted'; error?: string })
  | (EventBase & { event: 'replay.truncated'; oldest_retained_seq: number });

export const TERMINAL_EVENTS = new Set(['run.completed', 'run.failed', 'run.cancelled', 'run.interrupted']);

/** Hermes 0.22.5 (session authority) requires exactly `request_id` + `execution_generation` + `choice`. */
export type ApprovalRequest = { choice: ApprovalChoice; request_id: string; execution_generation: number };

export type HealthResponse = { ok: boolean; hermes: boolean };

/**
 * POST /bots/:bot/send. The BFF resolves the Bot's canonical Bot Chat, so there is no session id.
 * Answers {@link SendMessageResponse}; resending the same clientMessageId returns the same runId
 * with `replayed: true`. Errors: 400 bad body, 404 `bot_unreachable`, 409 `bot_chat_missing`,
 * and Hermes errors relayed as-is (e.g. 503 with Retry-After while the gateway drains).
 */
export type BotSendRequest = {
  /** Client-generated, reused on retry; becomes the Hermes Idempotency-Key. */
  clientMessageId: string;
  text: string;
};
