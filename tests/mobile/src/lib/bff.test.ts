import { TERMINAL_EVENTS, type BotsResponse, type HealthResponse, type RunEvent } from '@hermes-mobile/api';
import { fetch as streamingFetch } from 'expo/fetch';
import {
  BffError,
  checkHealth,
  followBotRun,
  getBotChat,
  getBotChatMessages,
  getBotMessages,
  listBots,
  sendBotMessage,
  stopBotRun,
} from '@mobile/lib/bff';
import { loadConfig } from '@mobile/lib/config';

// bff.ts takes its streaming fetch from expo/fetch; these tests only use the global fetch path.
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
// The paired BFF comes from secure storage; tests hand it over directly.
jest.mock('@mobile/lib/config', () => ({ loadConfig: jest.fn() }));

const config = { url: 'http://bff.local:8787', token: 'secret' };
const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

function respond(status: number, body: unknown = {}) {
  fetchMock.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

describe('checkHealth', () => {
  it('asks the BFF /health with the bearer token and returns the parsed body', async () => {
    const health: HealthResponse = { ok: true, hermes: true };
    respond(200, health);

    await expect(checkHealth(config)).resolves.toEqual(health);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://bff.local:8787/health');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret' });
  });

  it('throws a BffError carrying the HTTP status when the BFF answers with an error', async () => {
    respond(401);

    const error = await checkHealth(config).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BffError);
    expect(error).toMatchObject({ status: 401, message: 'GET /health failed (401)' });
  });
});

describe('Bot client', () => {
  beforeEach(() => {
    jest.mocked(loadConfig).mockResolvedValue(config);
  });

  it('lists the roster from GET /bots', async () => {
    const body: BotsResponse = {
      botModeEnabled: true,
      bots: [{ id: 'default', name: 'Hermes', title: null, description: null, reachable: true }],
    };
    respond(200, body);

    await expect(listBots()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0][0]).toBe('http://bff.local:8787/bots');
  });

  it('resolves a Bot Chat from GET /bots/:bot/chat', async () => {
    respond(200, { botId: 'researcher', sessionId: 'chat-1' });

    await expect(getBotChat('researcher')).resolves.toEqual({ botId: 'researcher', sessionId: 'chat-1' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://bff.local:8787/bots/researcher/chat');
  });

  it('exposes the BFF error code, so a missing Bot Chat (409) is distinguishable', async () => {
    respond(409, { error: 'bot_chat_missing', message: 'Open this Bot once in Hermes Desktop' });

    const error = await getBotChat('default').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BffError);
    expect(error).toMatchObject({ status: 409, code: 'bot_chat_missing' });
  });

  it('reads Bot Chat messages from the Bot profile (?bot=)', async () => {
    respond(200, { data: [{ role: 'user', content: 'hi' }] });

    await expect(getBotMessages('researcher', 'chat 1')).resolves.toEqual([{ role: 'user', content: 'hi' }]);
    expect(fetchMock.mock.calls[0][0]).toBe('http://bff.local:8787/sessions/chat%201/messages?bot=researcher');
  });

  it('pages the Bot Chat through GET /bots/:bot/chat/messages; the BFF resolves the chat', async () => {
    respond(200, { session_id: 'chat-1', data: [{ id: 9, role: 'tool', content: 'ok', tool_call_id: 'call_1' }] });

    await expect(getBotChatMessages('research bot', { order: 'latest', limit: 100 })).resolves.toEqual([
      { id: 9, role: 'tool', content: 'ok', tool_call_id: 'call_1' },
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe('http://bff.local:8787/bots/research%20bot/chat/messages?order=latest&limit=100');
  });

  it('sends no query string when no paging is given', async () => {
    respond(200, { session_id: 'chat-1', data: [] });

    await getBotChatMessages('default');
    expect(fetchMock.mock.calls[0][0]).toBe('http://bff.local:8787/bots/default/chat/messages');
  });
});

describe('Bot Chat turns', () => {
  beforeEach(() => {
    jest.mocked(loadConfig).mockResolvedValue(config);
    jest.mocked(streamingFetch).mockReset();
  });

  it('sends to POST /bots/:bot/send; the BFF resolves the Bot Chat', async () => {
    respond(200, { runId: 'run-1', replayed: false });

    await expect(sendBotMessage('researcher', 'cm-1', 'hi')).resolves.toEqual({ runId: 'run-1', replayed: false });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://bff.local:8787/bots/researcher/send');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ clientMessageId: 'cm-1', text: 'hi' });
  });

  it('retries a 5xx with the same clientMessageId, so a lost response never duplicates the turn', async () => {
    jest.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: 'gateway_draining' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ runId: 'run-1', replayed: true }) });

    const result = sendBotMessage('default', 'cm-1', 'hi');
    await jest.runAllTimersAsync();

    await expect(result).resolves.toEqual({ runId: 'run-1', replayed: true });
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).clientMessageId);
    expect(bodies).toEqual(['cm-1', 'cm-1']);
    jest.useRealTimers();
  });

  it('does not retry a 4xx (e.g. 409 bot_chat_missing)', async () => {
    respond(409, { error: 'bot_chat_missing' });

    await expect(sendBotMessage('default', 'cm-1', 'hi')).rejects.toMatchObject({ status: 409, code: 'bot_chat_missing' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops a run through the Bot-scoped route', async () => {
    respond(200, {});

    await stopBotRun('researcher', 'run-1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://bff.local:8787/bots/researcher/runs/run-1/stop');
    expect(init.method).toBe('POST');
  });

  function sseResponse(...chunks: string[]) {
    const encoded = chunks.map((c) => new TextEncoder().encode(c));
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => (encoded.length ? { value: encoded.shift(), done: false } : { value: undefined, done: true }),
        }),
      },
    };
  }

  it('follows the Bot-scoped event stream until run.completed', async () => {
    jest
      .mocked(streamingFetch)
      .mockResolvedValueOnce(
        sseResponse('id: 4\ndata: {"event":"run.completed","run_id":"run-1","timestamp":1,"output":"E2E-OK"}\n\n') as never,
      );
    const events: RunEvent[] = [];

    await followBotRun('researcher', 'run-1', (e) => events.push(e), new AbortController().signal);

    expect(jest.mocked(streamingFetch).mock.calls[0][0]).toBe('http://bff.local:8787/bots/researcher/runs/run-1/events');
    expect(events).toEqual([expect.objectContaining({ event: 'run.completed', output: 'E2E-OK' })]);
  });

  it('reconnects with Last-Event-ID when the stream closes before the run ends', async () => {
    jest
      .mocked(streamingFetch)
      .mockResolvedValueOnce(sseResponse('id: 1\ndata: {"event":"run.started","run_id":"run-1","timestamp":1}\n\n') as never)
      .mockResolvedValueOnce(sseResponse('id: 2\ndata: {"event":"run.completed","run_id":"run-1","timestamp":2}\n\n') as never);
    respond(200, { run_id: 'run-1', status: 'running' });
    const events: RunEvent[] = [];

    await followBotRun('default', 'run-1', (e) => events.push(e), new AbortController().signal);

    expect(fetchMock.mock.calls[0][0]).toBe('http://bff.local:8787/bots/default/runs/run-1');
    const second = jest.mocked(streamingFetch).mock.calls[1];
    expect((second[1] as RequestInit).headers).toMatchObject({ 'Last-Event-ID': '1' });
    expect(events.map((e) => e.event)).toEqual(['run.started', 'run.completed']);
  });

  it('reports the final state when the stream closes and the run is already over', async () => {
    jest.mocked(streamingFetch).mockResolvedValueOnce(sseResponse() as never);
    respond(200, { run_id: 'run-1', status: 'completed', output: 'done' });
    const events: RunEvent[] = [];

    await followBotRun('default', 'run-1', (e) => events.push(e), new AbortController().signal);

    expect(events).toEqual([expect.objectContaining({ event: 'run.completed', output: 'done' })]);
  });
});

describe('@hermes-mobile/api', () => {
  it('exposes the run events that end a run', () => {
    expect([...TERMINAL_EVENTS]).toEqual(expect.arrayContaining(['run.completed', 'run.failed']));
  });
});
