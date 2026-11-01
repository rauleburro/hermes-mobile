import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';

const TOKEN = 'device-token';
const auth = { Authorization: `Bearer ${TOKEN}` };

function setup(handler: (url: string) => Response, profileKeys: Record<string, string> = { researcher: 'r-key' }) {
  const fetchMock = vi.fn(async (url: string | URL | Request) => handler(String(url)));
  const app = createApp({
    hermesUrl: 'http://hermes',
    hermesApiKey: 'hermes-key',
    deviceToken: TOKEN,
    profileKeys,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { app, fetchMock };
}

const toolRow = { id: 7, role: 'tool', content: 'ok', tool_call_id: 'call_1', tool_name: 'clock' };

// Fake Hermes: the Bot Chat lookup per profile, then the messages page.
function fakeHermes(chats: Record<string, string> = { default: 'sess_d', researcher: 'sess_r' }, page?: () => Response) {
  return (url: string) => {
    const profile = url.match(/^http:\/\/hermes\/p\/([^/]+)/)?.[1] ?? 'default';
    if (url.includes('/api/sessions?title=Bot%20Chat')) {
      const id = chats[profile];
      return Response.json({ data: id ? [{ id: 'other', title: 'Notes' }, { id, title: 'Bot Chat' }] : [] });
    }
    if (url.includes('/messages')) {
      return page
        ? page()
        : Response.json({
            object: 'list',
            session_id: chats[profile],
            data: [toolRow],
            pagination: { limit: 50, offset: 0, order: 'latest', returned: 1 },
          });
    }
    return Response.json({ error: 'unexpected' }, { status: 500 });
  };
}

describe('GET /bots/:bot/chat/messages', () => {
  it("reads the Bot's own Bot Chat through its profile and passes the paging params through", async () => {
    const { app, fetchMock } = setup(fakeHermes());
    const res = await app.request('/bots/researcher/chat/messages?order=oldest&offset=12&limit=50', { headers: auth });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([toolRow]);
    expect(fetchMock.mock.calls[0][0]).toBe('http://hermes/p/researcher/api/sessions?title=Bot%20Chat&include_hidden=true');
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const upstream = new URL(url);
    expect(upstream.origin + upstream.pathname).toBe('http://hermes/p/researcher/api/sessions/sess_r/messages');
    expect(Object.fromEntries(upstream.searchParams)).toEqual({
      inline_images: 'false',
      order: 'oldest',
      offset: '12',
      limit: '50',
    });
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer r-key');
  });

  it('forwards only the params given (Hermes then answers its latest page)', async () => {
    const { app, fetchMock } = setup(fakeHermes());
    await app.request('/bots/default/chat/messages', { headers: auth });
    expect(fetchMock.mock.calls[1][0]).toBe('http://hermes/api/sessions/sess_d/messages?inline_images=false');
  });

  it.each(['offset=-1', 'offset=1e3', 'offset=10abc', 'offset=', 'offset=9007199254740992', 'offset=99999999999999999999', 'limit=0', 'limit=501', 'limit=abc', 'order=newest', 'order='])(
    'rejects %s with 400 before calling Hermes',
    async (query) => {
      const { app, fetchMock } = setup(fakeHermes());
      const res = await app.request(`/bots/default/chat/messages?${query}`, { headers: auth });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid_params' });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('accepts the edges: offset 0, limit 1 and 500, order latest', async () => {
    const { app } = setup(fakeHermes());
    for (const query of ['offset=0', 'limit=1', 'limit=500', 'order=latest']) {
      expect((await app.request(`/bots/default/chat/messages?${query}`, { headers: auth })).status).toBe(200);
    }
  });

  it('answers 409 bot_chat_missing when the Bot has no Bot Chat', async () => {
    const { app, fetchMock } = setup(fakeHermes({}));
    const res = await app.request('/bots/default/chat/messages', { headers: auth });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'bot_chat_missing' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('answers 404 bot_unreachable for a Bot without an API key', async () => {
    const { app, fetchMock } = setup(fakeHermes());
    const res = await app.request('/bots/coder/chat/messages', { headers: auth });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'bot_unreachable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("relays Hermes' error unchanged", async () => {
    const { app } = setup(
      fakeHermes(undefined, () => Response.json({ error: { code: 'session_not_found' } }, { status: 404 })),
    );
    const res = await app.request('/bots/default/chat/messages?limit=5', { headers: auth });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'session_not_found' } });
  });

  it('requires the device token', async () => {
    const { app, fetchMock } = setup(fakeHermes());
    expect((await app.request('/bots/default/chat/messages')).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
