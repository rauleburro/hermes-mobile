import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type {
  ApprovalRequest,
  BotChatResponse,
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

class UnknownBotError extends Error {}

export function createApp({
  hermesUrl,
  hermesApiKey,
  deviceToken,
  profileKeys = {},
  readRoster = () => ({ botModeEnabled: false, bots: [] }),
  fetch: doFetch = fetch,
}: AppOptions) {
  const keyFor = (bot: string) => (bot === DEFAULT_BOT ? hermesApiKey : profileKeys[bot]);

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
  const relay = async (res: Response) =>
    new Response(res.body, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
    });

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

  // The canonical forever-chat of a Bot (same lookup as `hermes peer dm`).
  app.get('/bots/:bot/chat', async (c) => {
    const bot = c.req.param('bot');
    const res = await hermes('/api/sessions?title=Bot%20Chat&include_hidden=true', {}, bot);
    if (!res.ok) return relay(res);
    const { data } = (await res.json()) as { data: { id: string; title?: string }[] };
    const chat = data.find((s) => s.title === 'Bot Chat') ?? null;
    if (!chat) {
      return c.json({ error: 'bot_chat_missing', message: 'Open this Bot once in Hermes Desktop to create its Bot Chat' }, 409);
    }
    return c.json<BotChatResponse>({ botId: bot, sessionId: chat.id });
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

  app.post('/chat/send', async (c) => {
    const body = await c.req.json<SendMessageRequest>().catch(() => null);
    if (!body?.sessionId || !body.clientMessageId || !body.text?.trim()) {
      return c.json({ error: 'sessionId, clientMessageId and text are required' }, 400);
    }
    const res = await hermes(
      '/v1/runs',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': body.clientMessageId },
        body: JSON.stringify({ input: body.text, session_id: body.sessionId }),
      },
      body.botId ?? DEFAULT_BOT,
    );
    if (!res.ok) return relay(res);
    const run = (await res.json()) as { run_id: string };
    return c.json<SendMessageResponse>({
      runId: run.run_id,
      replayed: res.headers.get('Idempotency-Replayed') === 'true',
    });
  });

  // Runs are scoped to the profile that created them, so every run route takes ?bot=.
  const runPath = (id: string, suffix = '') => `/v1/runs/${encodeURIComponent(id)}${suffix}`;

  app.get('/runs/:id', (c) =>
    hermes(runPath(c.req.param('id')), {}, c.req.query('bot') ?? DEFAULT_BOT).then(relay),
  );

  // SSE passthrough. Last-Event-ID lets the app resume after a dropped connection.
  app.get('/runs/:id/events', async (c) => {
    const lastEventId = c.req.header('Last-Event-ID');
    const res = await hermes(
      runPath(c.req.param('id'), '/events'),
      {
        headers: { Accept: 'text/event-stream', ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}) },
        signal: c.req.raw.signal,
      },
      c.req.query('bot') ?? DEFAULT_BOT,
    );
    if (!res.ok || !res.body) return relay(res);
    return new Response(res.body, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
    });
  });

  app.post('/runs/:id/approval', async (c) => {
    const body = await c.req.json<ApprovalRequest>().catch(() => null);
    if (!body?.choice) return c.json({ error: 'choice is required' }, 400);
    const { choice, request_id, execution_generation } = body;
    return hermes(
      runPath(c.req.param('id'), '/approval'),
      { method: 'POST', body: JSON.stringify({ choice, request_id, execution_generation }) },
      c.req.query('bot') ?? DEFAULT_BOT,
    ).then(relay);
  });

  app.post('/runs/:id/stop', (c) =>
    hermes(runPath(c.req.param('id'), '/stop'), { method: 'POST', body: '{}' }, c.req.query('bot') ?? DEFAULT_BOT).then(
      relay,
    ),
  );

  return app;
}
