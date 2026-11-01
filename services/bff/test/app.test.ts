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

describe('relay', () => {
  it('passes Retry-After and x-should-retry through on a Hermes 503', async () => {
    const { app } = setup(() =>
      Response.json(
        { error: { code: 'gateway_draining' } },
        { status: 503, headers: { 'Retry-After': '1', 'x-should-retry': 'false' } },
      ),
    );
    const res = await app.request('/sessions', { headers: auth });
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('1');
    expect(res.headers.get('x-should-retry')).toBe('false');
  });
});

describe('POST /bots/:bot/send', () => {
  const json = { ...auth, 'Content-Type': 'application/json' };
  const send = (app: ReturnType<typeof setup>['app'], bot: string, body: unknown) =>
    app.request(`/bots/${bot}/send`, { method: 'POST', headers: json, body: JSON.stringify(body) });

  // Fake Hermes: Bot Chat lookup + a run store keyed by Idempotency-Key.
  function fakeHermes(chats: Record<string, string> = { default: 'sess_d', researcher: 'sess_r' }) {
    const runs = new Map<string, string>();
    return (url: string, init: RequestInit) => {
      const profile = url.match(/^http:\/\/hermes\/p\/([^/]+)/)?.[1] ?? 'default';
      if (url.includes('/api/sessions?title=Bot%20Chat')) {
        const id = chats[profile];
        return Response.json({ data: id ? [{ id: 'other', title: 'Notes' }, { id, title: 'Bot Chat' }] : [] });
      }
      if (url.endsWith('/v1/runs') && init.method === 'POST') {
        const key = new Headers(init.headers).get('Idempotency-Key')!;
        const replayed = runs.has(key);
        if (!replayed) runs.set(key, `run_${runs.size + 1}`);
        return Response.json(
          { run_id: runs.get(key), status: 'started' },
          { status: 202, headers: replayed ? { 'Idempotency-Replayed': 'true' } : {} },
        );
      }
      return Response.json({ error: 'unexpected' }, { status: 500 });
    };
  }

  it("resolves the Bot's Bot Chat server-side and posts the run with Idempotency-Key", async () => {
    const { app, fetchMock } = setup(fakeHermes(), { profileKeys: { researcher: 'r-key' } });
    const res = await send(app, 'researcher', { clientMessageId: 'm1', text: 'hola' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runId: 'run_1', replayed: false });
    const [lookupUrl] = fetchMock.mock.calls[0];
    expect(lookupUrl).toBe('http://hermes/p/researcher/api/sessions?title=Bot%20Chat&include_hidden=true');
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('http://hermes/p/researcher/v1/runs');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('m1');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer r-key');
    expect(JSON.parse(String(init?.body))).toEqual({ input: 'hola', session_id: 'sess_r' });
  });

  it('replays: the same clientMessageId returns the same runId with replayed: true', async () => {
    const { app, fetchMock } = setup(fakeHermes());
    const first = await (await send(app, 'default', { clientMessageId: 'm1', text: 'hola' })).json();
    const second = await (await send(app, 'default', { clientMessageId: 'm1', text: 'hola' })).json();
    expect(first).toEqual({ runId: 'run_1', replayed: false });
    expect(second).toEqual({ runId: 'run_1', replayed: true });
    const runCalls = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/v1/runs'));
    expect(runCalls).toHaveLength(2);
    // Byte-identical payload under the same key, or Hermes answers 409 idempotency_key_conflict.
    expect(runCalls[0][1]?.body).toBe(runCalls[1][1]?.body);
    expect(new Headers(runCalls[1][1]?.headers).get('Idempotency-Key')).toBe('m1');
  });

  it('builds the same run payload as the deprecated /chat/send, so a retry across routes replays', async () => {
    const { app, fetchMock } = setup(fakeHermes());
    await send(app, 'default', { clientMessageId: 'm1', text: 'hola' });
    const res = await app.request('/chat/send', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ sessionId: 'sess_d', clientMessageId: 'm1', text: 'hola' }),
    });
    expect(await res.json()).toEqual({ runId: 'run_1', replayed: true });
    const runCalls = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/v1/runs'));
    expect(runCalls[0][1]?.body).toBe(runCalls[1][1]?.body);
  });

  it('ignores a client-sent sessionId', async () => {
    const { app, fetchMock } = setup(fakeHermes());
    await send(app, 'default', { clientMessageId: 'm1', text: 'hola', sessionId: 'loose_session' });
    const runCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/v1/runs'));
    expect(JSON.parse(String(runCall?.[1]?.body))).toEqual({ input: 'hola', session_id: 'sess_d' });
  });

  it.each([
    ['not JSON', 'not json'],
    ['missing clientMessageId', JSON.stringify({ text: 'hola' })],
    ['non-string clientMessageId', JSON.stringify({ clientMessageId: 7, text: 'hola' })],
    ['blank clientMessageId', JSON.stringify({ clientMessageId: '  ', text: 'hola' })],
    ['blank text', JSON.stringify({ clientMessageId: 'm1', text: '  ' })],
    ['non-string text', JSON.stringify({ clientMessageId: 'm1', text: ['hola'] })],
    ['JSON null', 'null'],
  ])('answers 400 for a bad body (%s) without calling Hermes', async (_name, body) => {
    const { app, fetchMock } = setup(fakeHermes());
    const res = await app.request('/bots/default/send', { method: 'POST', headers: json, body });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown Bot without calling Hermes', async () => {
    const { app, fetchMock } = setup(fakeHermes());
    const res = await send(app, 'coder', { clientMessageId: 'm1', text: 'hola' });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'bot_unreachable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 409 bot_chat_missing when the Bot has no Bot Chat, and creates no run', async () => {
    const { app, fetchMock } = setup(fakeHermes({}));
    const res = await send(app, 'default', { clientMessageId: 'm1', text: 'hola' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'bot_chat_missing' });
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/v1/runs'))).toBe(false);
  });

  it('relays 503 + Retry-After when Hermes is draining on run admission', async () => {
    const lookup = fakeHermes();
    const { app } = setup((url, init) =>
      url.endsWith('/v1/runs')
        ? Response.json({ error: { code: 'gateway_draining' } }, { status: 503, headers: { 'Retry-After': '1' } })
        : lookup(url, init),
    );
    const res = await send(app, 'default', { clientMessageId: 'm1', text: 'hola' });
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('1');
    expect(await res.json()).toMatchObject({ error: { code: 'gateway_draining' } });
  });

  it('relays 503 + Retry-After when Hermes is draining on the Bot Chat lookup', async () => {
    const { app, fetchMock } = setup(() =>
      Response.json({ error: { code: 'gateway_draining' } }, { status: 503, headers: { 'Retry-After': '1' } }),
    );
    const res = await send(app, 'default', { clientMessageId: 'm1', text: 'hola' });
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("relays Hermes' own 409 idempotency_key_conflict untouched", async () => {
    const lookup = fakeHermes();
    const { app } = setup((url, init) =>
      url.endsWith('/v1/runs')
        ? Response.json({ error: { code: 'idempotency_key_conflict' } }, { status: 409 })
        : lookup(url, init),
    );
    const res = await send(app, 'default', { clientMessageId: 'm1', text: 'other text' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'idempotency_key_conflict' } });
  });
});

describe('per-Bot run routes', () => {
  const keys = { profileKeys: { researcher: 'r-key' } };

  it('GET /bots/:bot/runs/:id reads the run from that Bot', async () => {
    const { app, fetchMock } = setup(() => Response.json({ run_id: 'run_1', status: 'completed' }), keys);
    const res = await app.request('/bots/researcher/runs/run_1', { headers: auth });
    expect(await res.json()).toEqual({ run_id: 'run_1', status: 'completed' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://hermes/p/researcher/v1/runs/run_1');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer r-key');
  });

  it('GET /bots/:bot/runs/:id/events proxies the SSE stream and forwards Last-Event-ID', async () => {
    const { app, fetchMock } = setup(() => new Response('id: 3\ndata: {"event":"run.completed"}\n\n'), keys);
    const res = await app.request('/bots/researcher/runs/run_1/events', {
      headers: { ...auth, 'Last-Event-ID': '2' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(await res.text()).toContain('run.completed');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://hermes/p/researcher/v1/runs/run_1/events');
    expect(new Headers(init?.headers).get('Last-Event-ID')).toBe('2');
    expect(new Headers(init?.headers).get('Accept')).toBe('text/event-stream');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer r-key');
  });

  it('GET /bots/:bot/runs/:id/events sends no Last-Event-ID on a fresh connection', async () => {
    const { app, fetchMock } = setup(() => new Response('data: {}\n\n'));
    await app.request('/bots/default/runs/run_1/events', { headers: auth });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://hermes/v1/runs/run_1/events');
    expect(new Headers(init?.headers).has('Last-Event-ID')).toBe(false);
  });

  it('GET /bots/:bot/runs/:id/events relays a Hermes 404 for a run it does not own', async () => {
    const { app } = setup(() => Response.json({ error: { code: 'run_not_found' } }, { status: 404 }));
    const res = await app.request('/bots/default/runs/run_x/events', { headers: auth });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'run_not_found' } });
  });

  it('POST /bots/:bot/runs/:id/approval forwards exactly the accepted fields to that Bot', async () => {
    const { app, fetchMock } = setup(() => Response.json({ run_id: 'run_1' }), keys);
    await app.request('/bots/researcher/runs/run_1/approval', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice: 'deny', request_id: 'p1', execution_generation: 2, extra: true }),
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://hermes/p/researcher/v1/runs/run_1/approval');
    expect(JSON.parse(String(init?.body))).toEqual({ choice: 'deny', request_id: 'p1', execution_generation: 2 });
  });

  it('POST /bots/:bot/runs/:id/approval answers 400 without a choice', async () => {
    const { app, fetchMock } = setup(() => Response.json({}));
    const res = await app.request('/bots/default/runs/run_1/approval', { method: 'POST', headers: auth, body: '{}' });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST /bots/:bot/runs/:id/stop stops the run on that Bot', async () => {
    const { app, fetchMock } = setup(() => Response.json({ run_id: 'run_1', status: 'stopping' }), keys);
    const res = await app.request('/bots/researcher/runs/run_1/stop', { method: 'POST', headers: auth });
    expect(await res.json()).toMatchObject({ status: 'stopping' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://hermes/p/researcher/v1/runs/run_1/stop');
    expect(init?.method).toBe('POST');
  });

  it.each([
    ['GET', '/bots/coder/runs/run_1'],
    ['GET', '/bots/coder/runs/run_1/events'],
    ['POST', '/bots/coder/runs/run_1/stop'],
  ])('%s %s answers 404 for an unknown Bot', async (method, path) => {
    const { app, fetchMock } = setup(() => Response.json({}));
    const res = await app.request(path, { method, headers: auth });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'bot_unreachable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('deprecated ?bot= run aliases keep working', () => {
  const keys = { profileKeys: { researcher: 'r-key' } };

  it('GET /runs/:id?bot=', async () => {
    const { app, fetchMock } = setup(() => Response.json({ run_id: 'run_1' }), keys);
    expect((await app.request('/runs/run_1?bot=researcher', { headers: auth })).status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe('http://hermes/p/researcher/v1/runs/run_1');
  });

  it('GET /runs/:id defaults to the default Bot', async () => {
    const { app, fetchMock } = setup(() => Response.json({ run_id: 'run_1' }));
    await app.request('/runs/run_1', { headers: auth });
    expect(fetchMock.mock.calls[0][0]).toBe('http://hermes/v1/runs/run_1');
  });

  it('GET /runs/:id/events?bot= forwards Last-Event-ID', async () => {
    const { app, fetchMock } = setup(() => new Response('data: {}\n\n'), keys);
    await app.request('/runs/run_1/events?bot=researcher', { headers: { ...auth, 'Last-Event-ID': '5' } });
    expect(fetchMock.mock.calls[0][0]).toBe('http://hermes/p/researcher/v1/runs/run_1/events');
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Last-Event-ID')).toBe('5');
  });

  it('POST /runs/:id/approval?bot=', async () => {
    const { app, fetchMock } = setup(() => Response.json({ run_id: 'run_1' }), keys);
    await app.request('/runs/run_1/approval?bot=researcher', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice: 'once' }),
    });
    expect(fetchMock.mock.calls[0][0]).toBe('http://hermes/p/researcher/v1/runs/run_1/approval');
  });

  it('POST /runs/:id/stop?bot=', async () => {
    const { app, fetchMock } = setup(() => Response.json({ run_id: 'run_1' }), keys);
    await app.request('/runs/run_1/stop?bot=researcher', { method: 'POST', headers: auth });
    expect(fetchMock.mock.calls[0][0]).toBe('http://hermes/p/researcher/v1/runs/run_1/stop');
  });

  it('POST /chat/send {botId} still routes the run to that Bot', async () => {
    const { app, fetchMock } = setup(() => Response.json({ run_id: 'run_9' }, { status: 202 }), keys);
    const res = await app.request('/chat/send', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ botId: 'researcher', sessionId: 's1', clientMessageId: 'm1', text: 'hola' }),
    });
    expect(await res.json()).toEqual({ runId: 'run_9', replayed: false });
    expect(fetchMock.mock.calls[0][0]).toBe('http://hermes/p/researcher/v1/runs');
  });
});
