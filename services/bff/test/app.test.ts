import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';

const TOKEN = 'device-token';
const auth = { Authorization: `Bearer ${TOKEN}` };

function setup(handler: (url: string, init: RequestInit) => Response, extra: Partial<Parameters<typeof createApp>[0]> = {}) {
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => handler(String(url), init ?? {}));
  const app = createApp({
    hermesUrl: 'http://hermes',
    hermesApiKey: 'hermes-key',
    deviceToken: TOKEN,
    fetch: fetchMock as unknown as typeof fetch,
    ...extra,
  });
  return { app, fetchMock };
}

describe('auth', () => {
  it('rejects requests without the device token', async () => {
    const { app, fetchMock } = setup(() => Response.json({}));
    const res = await app.request('/sessions');
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves /health without a token and reports Hermes reachability', async () => {
    const { app } = setup(() => new Response('ok'));
    expect(await (await app.request('/health')).json()).toEqual({ ok: true, hermes: true });
  });
});

describe('Hermes down', () => {
  it('answers 502 instead of crashing', async () => {
    const { app } = setup(() => {
      throw new TypeError('fetch failed');
    });
    const res = await app.request('/sessions', { headers: auth });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'hermes_unreachable' });
  });
});

describe('POST /chat/send', () => {
  it('creates a Hermes run with the client message id as Idempotency-Key', async () => {
    const { app, fetchMock } = setup(() =>
      Response.json({ run_id: 'run_1', status: 'started' }, { status: 202, headers: { 'Idempotency-Replayed': 'true' } }),
    );
    const res = await app.request('/chat/send', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1', clientMessageId: 'm1', text: 'hola' }),
    });
    expect(await res.json()).toEqual({ runId: 'run_1', replayed: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://hermes/v1/runs');
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('m1');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer hermes-key');
    expect(JSON.parse(String(init?.body))).toEqual({ input: 'hola', session_id: 's1' });
  });

  it('rejects an empty message', async () => {
    const { app } = setup(() => Response.json({}));
    const res = await app.request('/chat/send', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ sessionId: 's1', clientMessageId: 'm1', text: '  ' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /runs/:id/events', () => {
  it('forwards Last-Event-ID and streams the SSE body', async () => {
    const { app, fetchMock } = setup(() => new Response('id: 3\ndata: {"event":"message.delta"}\n\n'));
    const res = await app.request('/runs/run_1/events', { headers: { ...auth, 'Last-Event-ID': '2' } });
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(await res.text()).toContain('message.delta');
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Last-Event-ID')).toBe('2');
  });
});

describe('bots', () => {
  const roster = () => ({
    botModeEnabled: true,
    bots: [
      { id: 'default', name: 'Hermes', title: null, description: null },
      { id: 'researcher', name: 'Researcher', title: 'Research', description: null },
      { id: 'coder', name: 'Coder', title: null, description: null },
    ],
  });

  it('lists the roster and marks Bots without a key as unreachable', async () => {
    const { app } = setup(() => Response.json({}), { readRoster: roster, profileKeys: { researcher: 'r-key' } });
    const body = await (await app.request('/bots', { headers: auth })).json();
    expect(body.botModeEnabled).toBe(true);
    expect(body.bots.map((b: { id: string; reachable: boolean }) => [b.id, b.reachable])).toEqual([
      ['default', true],
      ['researcher', true],
      ['coder', false],
    ]);
  });

  it('resolves a named Bot Chat through /p/<profile>/ with that profile key', async () => {
    const { app, fetchMock } = setup(
      () => Response.json({ data: [{ id: 'sess_9', title: 'Bot Chat' }] }),
      { readRoster: roster, profileKeys: { researcher: 'r-key' } },
    );
    const res = await app.request('/bots/researcher/chat', { headers: auth });
    expect(await res.json()).toEqual({ botId: 'researcher', sessionId: 'sess_9' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://hermes/p/researcher/api/sessions?title=Bot%20Chat&include_hidden=true');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer r-key');
  });

  it('answers 409 when the Bot has no Bot Chat yet', async () => {
    const { app } = setup(() => Response.json({ data: [] }));
    const res = await app.request('/bots/default/chat', { headers: auth });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'bot_chat_missing' });
  });

  it('answers 404 for a Bot without an API key', async () => {
    const { app, fetchMock } = setup(() => Response.json({}));
    const res = await app.request('/bots/coder/chat', { headers: auth });
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes run events to the Bot that owns the run', async () => {
    const { app, fetchMock } = setup(() => new Response('data: {}\n\n'), { profileKeys: { researcher: 'r-key' } });
    await app.request('/runs/run_1/events?bot=researcher', { headers: auth });
    expect(fetchMock.mock.calls[0][0]).toBe('http://hermes/p/researcher/v1/runs/run_1/events');
  });
});

describe('POST /runs/:id/approval', () => {
  it('forwards exactly the fields Hermes 0.22.5 accepts', async () => {
    const { app, fetchMock } = setup(() => Response.json({ run_id: 'run_1' }));
    await app.request('/runs/run_1/approval', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice: 'once', request_id: 'p1', execution_generation: 3, extra: true }),
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://hermes/v1/runs/run_1/approval');
    expect(JSON.parse(String(init?.body))).toEqual({ choice: 'once', request_id: 'p1', execution_generation: 3 });
  });
});
