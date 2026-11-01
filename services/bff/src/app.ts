import { timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import type {
  ApprovalChoice,
  ApprovalRequest,
  BotChatResponse,
  BotSendRequest,
  BotsResponse,
  HealthResponse,
  SendMessageRequest,
  SendMessageResponse,
} from '@hermes-mobile/api';
import type { Roster } from './roster.ts';

const DEFAULT_BOT = 'default';

type AppOptions = {
  hermesUrl: string;
  hermesApiKey: string;
  deviceToken: string;
  /** API_SERVER_KEY per named profile, reached through /p/<profile>/ (gateway.multiplex_profiles). */
  profileKeys?: Record<string, string>;
  readRoster?: () => Roster;
  fetch?: typeof fetch;
};

function tokenMatches(header: string | undefined, expected: string): boolean {
  const presented = Buffer.from(header?.replace(/^Bearer\s+/i, '') ?? '');
  const wanted = Buffer.from(expected);
  return presented.length === wanted.length && timingSafeEqual(presented, wanted);
}

const isNonBlank = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

// Retry hints pass through so the app can tell a draining 503 (Retry-After) from a do-not-retry one.
const RELAYED_HEADERS = ['Retry-After', 'x-should-retry'];

const APPROVAL_CHOICES: readonly ApprovalChoice[] = ['once', 'session', 'always', 'deny'];

class UnknownBotError extends Error {}

type MessagesParams = { offset?: string; limit?: string; order?: 'oldest' | 'latest' };
const MAX_MESSAGES_PAGE = 500;
const isDigits = (v: string) => /^\d+$/.test(v);

/** Validates GET /bots/:bot/chat/messages paging; only the params given are forwarded to Hermes. */
function parseMessagesQuery(query: Record<string, string>): MessagesParams | { error: string } {
  const { offset, limit, order } = query;
  const out: MessagesParams = {};
  if (offset !== undefined) {
    if (!isDigits(offset) || !Number.isSafeInteger(Number(offset))) return { error: 'offset must be a non-negative integer' };
    out.offset = offset;
  }
  if (limit !== undefined) {
    if (!isDigits(limit) || Number(limit) < 1 || Number(limit) > MAX_MESSAGES_PAGE) {
      return { error: `limit must be an integer from 1 to ${MAX_MESSAGES_PAGE}` };
    }
    out.limit = limit;
  }
  if (order !== undefined) {
    if (order !== 'oldest' && order !== 'latest') return { error: 'order must be oldest or latest' };
    out.order = order;
  }
  return out;
}

export function createApp({
  hermesUrl,
  hermesApiKey,
  deviceToken,
  profileKeys = {},
  readRoster = () => ({ botModeEnabled: false, bots: [] }),
  fetch: doFetch = fetch,
}: AppOptions) {
  // Own keys only: Bot ids come from the URL, and `constructor` or `__proto__` must not resolve.
  const keyFor = (bot: string): string | undefined =>
    bot === DEFAULT_BOT ? hermesApiKey : Object.hasOwn(profileKeys, bot) ? profileKeys[bot] : undefined;

  const hermes = (path: string, init: RequestInit = {}, bot = DEFAULT_BOT) => {
    const key = keyFor(bot);
    if (!key) throw new UnknownBotError(bot);
    const prefix = bot === DEFAULT_BOT ? '' : `/p/${encodeURIComponent(bot)}`;
    return doFetch(`${hermesUrl}${prefix}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  };

  // Relays Hermes' status and JSON body unchanged; the app only knows the BFF.
  const relay = async (res: Response) => {
    const headers = new Headers({ 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' });
    for (const name of RELAYED_HEADERS) {
      const value = res.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    return new Response(res.body, { status: res.status, headers });
  };

  // The canonical forever-chat of a Bot (same lookup as `hermes peer dm`): its session id, or the
  // response to answer instead (Hermes' error relayed, or 409 bot_chat_missing).
  const findBotChat = async (bot: string): Promise<{ sessionId: string } | { error: Response }> => {
    const res = await hermes('/api/sessions?title=Bot%20Chat&include_hidden=true', {}, bot);
    if (!res.ok) return { error: await relay(res) };
    const { data } = (await res.json()) as { data: { id: string; title?: string }[] };
    const chat = data.find((s) => s.title === 'Bot Chat');
    if (!chat) {
      const message = 'Open this Bot once in Hermes Desktop to create its Bot Chat';
      return { error: Response.json({ error: 'bot_chat_missing', message }, { status: 409 }) };
    }
    return { sessionId: chat.id };
  };

  // Creates a run in a session. The payload must stay byte-identical for a given message: Hermes
  // fingerprints it under the Idempotency-Key, and a mismatch is 409 idempotency_key_conflict.
  const startRun = async (bot: string, sessionId: string, clientMessageId: string, text: string) => {
    const res = await hermes(
      '/v1/runs',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': clientMessageId },
        body: JSON.stringify({ input: text, session_id: sessionId }),
      },
      bot,
    );
    if (!res.ok) return relay(res);
    const run = (await res.json()) as { run_id: string };
    return Response.json({
      runId: run.run_id,
      replayed: res.headers.get('Idempotency-Replayed') === 'true',
    } satisfies SendMessageResponse);
  };

  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof UnknownBotError) {
      return c.json({ error: 'bot_unreachable', message: `No API key configured for bot "${err.message}"` }, 404);
    }
    console.error(err);
    return c.json({ error: 'hermes_unreachable', message: `Cannot reach Hermes at ${hermesUrl}` }, 502);
  });

  app.get('/health', async (c) => {
    const hermesOk = await hermes('/health')
      .then((r) => r.ok)
      .catch(() => false);
    return c.json<HealthResponse>({ ok: true, hermes: hermesOk });
  });

  app.use('*', async (c, next) => {
    if (!tokenMatches(c.req.header('Authorization'), deviceToken)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  });

  app.get('/bots', (c) => {
    const roster = readRoster();
    return c.json<BotsResponse>({
      botModeEnabled: roster.botModeEnabled,
      bots: roster.bots.map((b) => ({ ...b, reachable: Boolean(keyFor(b.id)) })),
    });
  });

  app.get('/bots/:bot/chat', async (c) => {
    const bot = c.req.param('bot');
    const chat = await findBotChat(bot);
    if ('error' in chat) return chat.error;
    return c.json<BotChatResponse>({ botId: bot, sessionId: chat.sessionId });
  });

  // A page of the Bot's Bot Chat, resolved here (Bot Mode: the app never names a session). The app
  // polls it while a turn runs, since Bot Chat runs stream only their final event.
  app.get('/bots/:bot/chat/messages', async (c) => {
    const bot = c.req.param('bot');
    const params = parseMessagesQuery(c.req.query());
    if ('error' in params) return c.json({ error: 'invalid_params', message: params.error }, 400);
    if (!keyFor(bot)) throw new UnknownBotError(bot);
    const chat = await findBotChat(bot);
    if ('error' in chat) return chat.error;
    const query = new URLSearchParams({ inline_images: 'false', ...params });
    return hermes(`/api/sessions/${encodeURIComponent(chat.sessionId)}/messages?${query}`, {}, bot).then(relay);
  });

  // Sends to the Bot's Bot Chat, resolved here: the app never picks a session (Bot Mode).
  app.post('/bots/:bot/send', async (c) => {
    const bot = c.req.param('bot');
    const body = (await c.req.json<Partial<BotSendRequest> | null>().catch(() => null)) ?? {};
    if (!isNonBlank(body.clientMessageId) || !isNonBlank(body.text)) {
      return c.json({ error: 'clientMessageId and text are required' }, 400);
    }
    if (!keyFor(bot)) throw new UnknownBotError(bot);
    const chat = await findBotChat(bot);
    if ('error' in chat) return chat.error;
    return startRun(bot, chat.sessionId, body.clientMessageId, body.text);
  });

  app.get('/sessions', (c) => {
    const limit = c.req.query('limit') ?? '50';
    return hermes(`/api/sessions?limit=${encodeURIComponent(limit)}`).then(relay);
  });

  app.post('/sessions', async (c) =>
    hermes('/api/sessions', { method: 'POST', body: JSON.stringify(await c.req.json().catch(() => ({}))) }).then(relay),
  );

  app.get('/sessions/:id/messages', (c) =>
    hermes(
      `/api/sessions/${encodeURIComponent(c.req.param('id'))}/messages?inline_images=false`,
      {},
      c.req.query('bot') ?? DEFAULT_BOT,
    ).then(relay),
  );

  /** @deprecated Use POST /bots/:bot/send, which resolves the Bot Chat server-side. Kept for older app builds. */
  app.post('/chat/send', async (c) => {
    const body = await c.req.json<SendMessageRequest>().catch(() => null);
    if (!body?.sessionId || !body.clientMessageId || !body.text?.trim()) {
      return c.json({ error: 'sessionId, clientMessageId and text are required' }, 400);
    }
    return startRun(body.botId ?? DEFAULT_BOT, body.sessionId, body.clientMessageId, body.text);
  });

  // Runs are scoped to the profile that created them. Each run handler is mounted twice: under
  // /bots/:bot/runs/:id, and as the deprecated alias /runs/:id?bot= (default Bot when omitted).
  type RunContext = Context<{}, '/bots/:bot/runs/:id' | '/runs/:id'>;
  const runPath = (c: RunContext, suffix = '') => `/v1/runs/${encodeURIComponent(c.req.param('id'))}${suffix}`;
  const botOf = (c: RunContext) => c.req.param('bot') ?? c.req.query('bot') ?? DEFAULT_BOT;

  const getRun = (c: RunContext) => hermes(runPath(c), {}, botOf(c)).then(relay);

  // SSE passthrough. Last-Event-ID lets the app resume after a dropped connection.
  const runEvents = async (c: RunContext) => {
    const lastEventId = c.req.header('Last-Event-ID');
    const res = await hermes(
      runPath(c, '/events'),
      {
        headers: { Accept: 'text/event-stream', ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}) },
        signal: c.req.raw.signal,
      },
      botOf(c),
    );
    if (!res.ok || !res.body) return relay(res);
    return new Response(res.body, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
    });
  };

  // Hermes answers 400 invalid_params unless the body is exactly these three fields.
  const approveRun = async (c: RunContext) => {
    const body = (await c.req.json<Partial<ApprovalRequest> | null>().catch(() => null)) ?? {};
    const { choice, request_id, execution_generation } = body;
    if (!APPROVAL_CHOICES.includes(choice as ApprovalChoice)) {
      return c.json({ error: `choice is required (one of ${APPROVAL_CHOICES.join(', ')})` }, 400);
    }
    if (!isNonBlank(request_id)) return c.json({ error: 'request_id is required' }, 400);
    if (!Number.isInteger(execution_generation)) {
      return c.json({ error: 'execution_generation is required (an integer)' }, 400);
    }
    return hermes(
      runPath(c, '/approval'),
      { method: 'POST', body: JSON.stringify({ choice, request_id, execution_generation }) },
      botOf(c),
    ).then(relay);
  };

  const stopRun = (c: RunContext) => hermes(runPath(c, '/stop'), { method: 'POST', body: '{}' }, botOf(c)).then(relay);

  app.get('/bots/:bot/runs/:id', getRun);
  app.get('/bots/:bot/runs/:id/events', runEvents);
  app.post('/bots/:bot/runs/:id/approval', approveRun);
  app.post('/bots/:bot/runs/:id/stop', stopRun);

  /** @deprecated Use GET /bots/:bot/runs/:id. */
  app.get('/runs/:id', getRun);
  /** @deprecated Use GET /bots/:bot/runs/:id/events. */
  app.get('/runs/:id/events', runEvents);
  /** @deprecated Use POST /bots/:bot/runs/:id/approval. */
  app.post('/runs/:id/approval', approveRun);
  /** @deprecated Use POST /bots/:bot/runs/:id/stop. */
  app.post('/runs/:id/stop', stopRun);

  return app;
}
