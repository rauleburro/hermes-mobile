// Contract between the mobile app and the BFF. Hermes shapes mirror
// gateway/platforms/api_server*.py (Hermes Agent v0.22.5).

/** One entry of an assistant row's `tool_calls` (OpenAI shape; `arguments` is a JSON string). */
export type ToolCall = {
  id: string;
  call_id?: string | null;
  type?: string;
  function: { name: string; arguments?: string | null };
};

export type SessionMessage = {
  /** Durable row id (integer autoincrement in Hermes): newer rows have larger ids. */
  id?: string | number;
  session_id?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  timestamp?: number | string | null;
  tool_name?: string | null;
  /** On a `role=tool` row: the `ToolCall.id` it answers. */
  tool_call_id?: string | null;
  /** On an assistant row: the tools it asked for, persisted before they run. */
  tool_calls?: ToolCall[] | null;
  finish_reason?: string | null;
  /** Display hint; `hidden` rows are model-facing scaffolding no surface paints. */
  display_kind?: string | null;
};

/** GET /bots/:bot/chat/messages paging, passed through to Hermes (which answers its latest page when omitted). */
export type BotChatMessagesQuery = { offset?: number; limit?: number; order?: 'oldest' | 'latest' };

export type BotChatMessagesResponse = {
  object?: 'list';
  session_id: string;
  /** Chronological (oldest first) in both orders. */
  data: SessionMessage[];
  pagination?: { limit: number; offset: number; order: 'oldest' | 'latest'; returned: number };
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
  | 'interrupted'
  /** Hermes lost track of the run (e.g. after a restart). Not terminal: the run may still finish. */
  | 'unknown';

export const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

export const isTerminalStatus = (status: string): boolean => TERMINAL_STATUSES.has(status as RunStatus);

export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny';

/** Every frame carries `seq` (also sent as the SSE `id:`); events the app synthesizes may not. */
type EventBase = { run_id: string; timestamp: number; seq?: number };

/** Terminal `usage` counters, named as on the wire (gateway/platforms/api_server_runs.py `_USAGE_FIELDS`). */
export type RunUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
};

/** Fields shared by run.completed / run.failed / run.cancelled / run.interrupted. */
type TerminalFields = {
  output?: string;
  error?: string;
  usage?: RunUsage;
  /** The provider/model that actually served the turn. */
  runtime?: {
    provider?: string;
    model?: string;
    /** How the runtime was chosen (`global`, `raw_request`, `model_routes`, `session_model_lock`, ...). */
    route_source?: string;
    /** Present when the request named a model/provider: the asked-for pair. */
    requested?: { provider?: string; model?: string };
  };
  completed?: boolean;
  partial?: boolean;
  interrupted?: boolean;
  turn_exit_reason?: string;
  /** Steer text the turn never delivered, for the client to replay. */
  pending_steer?: string;
  /** Extra failure detail on some run.failed events. */
  reason?: string;
};

/**
 * Events on GET /v1/runs/{id}/events (Hermes 0.22.5). `run.started` and `tool.failed`
 * are not emitted on this endpoint: a failed tool arrives as `tool.completed` with `error: true`.
 */
export type RunEvent =
  | (EventBase & { event: 'run.queued'; message?: string })
  | (EventBase & { event: 'run.stopping' })
  | (EventBase & { event: 'message.delta'; delta: string })
  | (EventBase & { event: 'message.interim'; text: string; already_streamed: boolean })
  | (EventBase & { event: 'tool.started'; tool: string; preview: string; tool_call_id?: string })
  | (EventBase & {
      event: 'tool.completed';
      tool: string;
      duration: number;
      error: boolean;
      tool_call_id?: string;
      preview?: string;
    })
  | (EventBase & { event: 'reasoning.available'; text: string })
  | (EventBase & {
      event: 'subagent.start' | 'subagent.complete';
      /** Forwarded only when the agent set it. */
      subagent_id?: string;
      goal?: string;
      status?: string;
      summary?: string;
    })
  | (EventBase & {
      event: 'approval.request';
      kind: string;
      /** Send it back as `request_id` in the approval body. */
      prompt_id: string;
      execution_generation: number;
      command?: string;
      description?: string;
      choices: ApprovalChoice[];
      timeout_s?: number;
      edit?: unknown;
    })
  /** `resolved` is how many pending approvals the answer resolved. */
  | (EventBase & { event: 'approval.responded'; choice: ApprovalChoice; request_id?: string; resolved: number })
  | (EventBase & { event: 'approval.settled'; prompt_id: string; execution_generation: number })
  | (EventBase & {
      event: 'clarify.request';
      prompt_id: string;
      execution_generation: number;
      question: string;
      choices: string[];
      multi_select: boolean;
      timeout_s?: number;
    })
  | (EventBase & { event: 'clarify.settled'; prompt_id: string; execution_generation: number })
  | (EventBase & { event: 'run.steered'; accepted: boolean })
  | (EventBase & { event: 'replay.truncated'; oldest_retained_seq: number; requested_seq?: number })
  | (EventBase & TerminalFields & { event: 'run.completed' | 'run.failed' | 'run.cancelled' | 'run.interrupted' });

export const TERMINAL_EVENTS = new Set(['run.completed', 'run.failed', 'run.cancelled', 'run.interrupted']);

/**
 * POST /v1/runs/{id}/approval. Hermes 0.22.5 (session authority) requires exactly these keys;
 * `request_id` is the approval.request event's `prompt_id`.
 */
export type ApprovalRequest = { request_id: string; execution_generation: number; choice: ApprovalChoice };

export type ApprovalResponse = { run_id: string; status: 'resolved' | 'already_resolved'; prompt_id: string };

/** Hermes error body. Some 400s carry only `message` and `type`. */
export type HermesError = { error: { message: string; type: string; param?: string | null; code?: string | null } };

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
