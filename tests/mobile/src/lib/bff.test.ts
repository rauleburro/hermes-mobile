import { TERMINAL_EVENTS, type BotsResponse, type HealthResponse, type RunEvent } from '@hermes-mobile/api';
import { fetch as streamingFetch } from 'expo/fetch';
import {
  BffError,
  checkHealth,
  followBotRun,
  getBotChat,
  getBotChatMessages,
  getBotMessages,
  HISTORY_TIMEOUT_MS,
  listBots,
  REQUEST_TIMEOUT_MS,
  request,
  SSE_IDLE_TIMEOUT_MS,
  sendBotMessage,
  stopBotRun,
} from '@mobile/lib/bff';
import { savedDataHint } from '@mobile/lib/cache';
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

describe('request timeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(loadConfig).mockResolvedValue(config);
  });
  afterEach(() => jest.useRealTimers());

  /** A fetch that never answers (a hung socket); like RN's fetch, it rejects once its signal aborts. */
  const hang = (honorAbort = true) =>
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          if (honorAbort) init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );

  it('gives up on a BFF request after ~15 s with a network-type error (no HTTP status)', async () => {
    hang();
    const result = listBots().catch((e: unknown) => e);
    let settled = false;
    result.then(() => (settled = true));

    expect(REQUEST_TIMEOUT_MS).toBe(15_000);
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    const error = await result;
    expect(error).toBeInstanceOf(BffError);
    expect(error).toMatchObject({ status: undefined, code: 'timeout', message: 'GET /bots timed out' });
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    // So the saved-data hint and Retry treat it like any unreachable BFF.
    expect(savedDataHint(error, 'messages')).toBe('Offline · showing saved messages');
  });

  it('times out even if the fetch ignores the abort', async () => {
    hang(false);
    const result = getBotChat('default').catch((e: unknown) => e);

    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);

    await expect(result).resolves.toMatchObject({ code: 'timeout' });
  });

  it('gives the full Bot Chat history (up to 500 rows, ~1.5 MB with tool output) a longer budget', async () => {
    hang();
    const result = getBotMessages('default', 'chat-1').catch((e: unknown) => e);
    let settled = false;
    result.then(() => (settled = true));

    expect(HISTORY_TIMEOUT_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS);
    await jest.advanceTimersByTimeAsync(HISTORY_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toMatchObject({ code: 'timeout', status: undefined });
  });

  it('lets a reload of the Bot Chat history keep the default budget, so a dead BFF fails fast', async () => {
    hang();
    const result = getBotMessages('default', 'chat-1', { timeoutMs: REQUEST_TIMEOUT_MS }).catch((e: unknown) => e);
    let settled = false;
    result.then(() => (settled = true));

    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);

    await expect(result).resolves.toMatchObject({ code: 'timeout', status: undefined });
  });

  it('rejects at once with code `aborted` when the caller signal is already aborted', async () => {
    hang();
    const caller = new AbortController();
    caller.abort();
    const result = request('/bots', { signal: caller.signal }, config).catch((e: unknown) => e);
    let settled = false;
    result.then(() => (settled = true));

    await jest.advanceTimersByTimeAsync(0);

    expect(settled).toBe(true);
    const error = await result;
    expect(error).toBeInstanceOf(BffError);
    expect(error).toMatchObject({ code: 'aborted', status: undefined, message: 'GET /bots aborted' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('leaves no timer behind once the BFF answers', async () => {
    respond(200, { botModeEnabled: true, bots: [] });

    await listBots();

    expect(jest.getTimerCount()).toBe(0);
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
    jest.useFakeTimers();
    jest
      .mocked(streamingFetch)
      .mockResolvedValueOnce(sseResponse('id: 1\ndata: {"event":"run.started","run_id":"run-1","timestamp":1}\n\n') as never)
      .mockResolvedValueOnce(sseResponse('id: 2\ndata: {"event":"run.completed","run_id":"run-1","timestamp":2}\n\n') as never);
    respond(200, { run_id: 'run-1', status: 'running' });
    const events: RunEvent[] = [];

    const done = followBotRun('default', 'run-1', (e) => events.push(e), new AbortController().signal);
    await jest.advanceTimersByTimeAsync(2_000);
    await done;
    jest.useRealTimers();

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

  // A live run's stream can close without a terminal event (slow-subscriber overflow, proxies):
  // reconnect, but not in a tight loop.
  describe('stream closes cleanly while the run is still live', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const status = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    const completed = 'id: 9\ndata: {"event":"run.completed","run_id":"run-1","timestamp":9}\n\n';

    it('waits 2 s before reconnecting while the run is queued', async () => {
      jest
        .mocked(streamingFetch)
        .mockResolvedValueOnce(sseResponse() as never)
        .mockResolvedValueOnce(sseResponse(completed) as never);
      fetchMock.mockResolvedValueOnce(status({ run_id: 'run-1', status: 'queued' }));
      const events: RunEvent[] = [];

      const done = followBotRun('default', 'run-1', (e) => events.push(e), new AbortController().signal);
      await jest.advanceTimersByTimeAsync(1_999);
      expect(streamingFetch).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await done;

      expect(streamingFetch).toHaveBeenCalledTimes(2);
      expect(events.map((e) => e.event)).toEqual(['run.completed']);
    });

    it('waits longer after each clean close in a row, capped at 10 s (2, 4, 8, 10, 10 s)', async () => {
      const waits = [2_000, 4_000, 8_000, 10_000, 10_000];
      for (const _ of waits) {
        jest.mocked(streamingFetch).mockResolvedValueOnce(sseResponse() as never);
        fetchMock.mockResolvedValueOnce(status({ run_id: 'run-1', status: 'queued' }));
      }
      jest.mocked(streamingFetch).mockResolvedValueOnce(sseResponse(completed) as never);

      const done = followBotRun('default', 'run-1', () => {}, new AbortController().signal);
      for (const [i, wait] of waits.entries()) {
        await jest.advanceTimersByTimeAsync(wait - 1);
        expect(streamingFetch).toHaveBeenCalledTimes(i + 1);
        await jest.advanceTimersByTimeAsync(1);
        expect(streamingFetch).toHaveBeenCalledTimes(i + 2);
      }
      await done;
    });

    it('removes its abort listener from the caller signal after a wait that ran out', async () => {
      jest
        .mocked(streamingFetch)
        .mockResolvedValueOnce(sseResponse() as never)
        .mockResolvedValueOnce(sseResponse(completed) as never);
      fetchMock.mockResolvedValueOnce(status({ run_id: 'run-1', status: 'queued' }));
      const controller = new AbortController();
      const live = new Set<unknown>();
      const add = controller.signal.addEventListener.bind(controller.signal);
      const remove = controller.signal.removeEventListener.bind(controller.signal);
      jest.spyOn(controller.signal, 'addEventListener').mockImplementation((type, listener, options) => {
        if (type === 'abort') live.add(listener);
        add(type, listener, options);
      });
      jest.spyOn(controller.signal, 'removeEventListener').mockImplementation((type, listener, options) => {
        if (type === 'abort') live.delete(listener);
        remove(type, listener, options);
      });

      const done = followBotRun('default', 'run-1', () => {}, controller.signal);
      await jest.advanceTimersByTimeAsync(2_000);
      await done;

      expect(streamingFetch).toHaveBeenCalledTimes(2);
      expect(live.size).toBe(0);
    });

    it('starts the wait over once a stream delivers events', async () => {
      const queued = 'id: 5\ndata: {"event":"run.queued","run_id":"run-1","timestamp":5}\n\n';
      jest
        .mocked(streamingFetch)
        .mockResolvedValueOnce(sseResponse() as never)
        .mockResolvedValueOnce(sseResponse(queued) as never)
        .mockResolvedValueOnce(sseResponse(completed) as never);
      fetchMock
        .mockResolvedValueOnce(status({ run_id: 'run-1', status: 'queued' }))
        .mockResolvedValueOnce(status({ run_id: 'run-1', status: 'queued' }));

      const done = followBotRun('default', 'run-1', () => {}, new AbortController().signal);
      await jest.advanceTimersByTimeAsync(2_000);
      expect(streamingFetch).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(2_000); // events arrived, so 2 s again rather than 4 s
      await done;

      expect(streamingFetch).toHaveBeenCalledTimes(3);
      expect((jest.mocked(streamingFetch).mock.calls[2][1] as RequestInit).headers).toMatchObject({ 'Last-Event-ID': '5' });
    });

    it('keeps reconnecting while the run status is unknown (not terminal)', async () => {
      jest
        .mocked(streamingFetch)
        .mockResolvedValueOnce(sseResponse() as never)
        .mockResolvedValueOnce(sseResponse(completed) as never);
      fetchMock.mockResolvedValueOnce(status({ run_id: 'run-1', status: 'unknown' }));
      const events: RunEvent[] = [];

      const done = followBotRun('default', 'run-1', (e) => events.push(e), new AbortController().signal);
      await jest.advanceTimersByTimeAsync(2_000);
      await done;

      expect(streamingFetch).toHaveBeenCalledTimes(2);
      expect(events.map((e) => e.event)).toEqual(['run.completed']);
    });

    it('returns at once when the caller aborts during the wait', async () => {
      jest.mocked(streamingFetch).mockResolvedValueOnce(sseResponse() as never);
      fetchMock.mockResolvedValueOnce(status({ run_id: 'run-1', status: 'queued' }));
      const controller = new AbortController();
      let settled = false;
      const done = followBotRun('default', 'run-1', () => {}, controller.signal).finally(() => (settled = true));
      await jest.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      controller.abort();
      await jest.advanceTimersByTimeAsync(1);

      expect(settled).toBe(true);
      await expect(done).resolves.toBeUndefined();
      expect(streamingFetch).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('idle timeout', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const completed = 'id: 2\ndata: {"event":"run.completed","run_id":"run-1","timestamp":2,"output":"E2E-OK"}\n\n';

    /** A stream that sends `chunks`, then goes silent without closing (a half-open socket). */
    function silentAfter(...chunks: string[]) {
      const encoded = chunks.map((c) => new TextEncoder().encode(c));
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: () => (encoded.length ? Promise.resolve({ value: encoded.shift(), done: false }) : new Promise(() => {})),
          }),
        },
      };
    }

    /** A stream that sends one chunk every `everyMs`. */
    function paced(everyMs: number, ...chunks: string[]) {
      const encoded = chunks.map((c) => new TextEncoder().encode(c));
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: () =>
              new Promise((resolve) =>
                setTimeout(
                  () => resolve(encoded.length ? { value: encoded.shift(), done: false } : { value: undefined, done: true }),
                  everyMs,
                ),
              ),
          }),
        },
      };
    }

    it('reconnects with Last-Event-ID when a stream goes silent past the idle timeout', async () => {
      jest
        .mocked(streamingFetch)
        .mockResolvedValueOnce(silentAfter('id: 1\ndata: {"event":"run.started","run_id":"run-1","timestamp":1}\n\n') as never)
        .mockResolvedValueOnce(sseResponse(completed) as never);
      const events: RunEvent[] = [];
      const done = followBotRun('default', 'run-1', (e) => events.push(e), new AbortController().signal);

      await jest.advanceTimersByTimeAsync(SSE_IDLE_TIMEOUT_MS - 1);
      expect(streamingFetch).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect((jest.mocked(streamingFetch).mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
      await jest.advanceTimersByTimeAsync(10_000);
      await done;

      expect(streamingFetch).toHaveBeenCalledTimes(2);
      expect((jest.mocked(streamingFetch).mock.calls[1][1] as RequestInit).headers).toMatchObject({ 'Last-Event-ID': '1' });
      expect(events.map((e) => e.event)).toEqual(['run.started', 'run.completed']);
    });

    it('also gives up on a connection that never answers (e.g. a stopped BFF)', async () => {
      jest
        .mocked(streamingFetch)
        .mockReturnValueOnce(new Promise(() => {}) as never)
        .mockResolvedValueOnce(sseResponse(completed) as never);
      const events: RunEvent[] = [];
      const done = followBotRun('default', 'run-1', (e) => events.push(e), new AbortController().signal);

      await jest.advanceTimersByTimeAsync(SSE_IDLE_TIMEOUT_MS + 10_000);
      await done;

      expect(streamingFetch).toHaveBeenCalledTimes(2);
      expect(events.map((e) => e.event)).toEqual(['run.completed']);
    });

    it("keeps a quiet stream that sends keepalives: any bytes reset the timer", async () => {
      // Hermes writes `: keepalive` every 10 s while a run is quiet (Bot Chat runs only stream their end).
      const keepalives = Array.from({ length: 12 }, () => ': keepalive\n\n');
      jest.mocked(streamingFetch).mockResolvedValueOnce(paced(10_000, ...keepalives, completed) as never);
      const events: RunEvent[] = [];
      const done = followBotRun('default', 'run-1', (e) => events.push(e), new AbortController().signal);

      expect(SSE_IDLE_TIMEOUT_MS).toBeGreaterThan(10_000);
      await jest.advanceTimersByTimeAsync(13 * 10_000);
      await done;

      expect(streamingFetch).toHaveBeenCalledTimes(1);
      expect(events.map((e) => e.event)).toEqual(['run.completed']);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('still returns at once when the caller aborts', async () => {
      jest.mocked(streamingFetch).mockResolvedValueOnce(silentAfter() as never);
      const controller = new AbortController();
      const done = followBotRun('default', 'run-1', () => {}, controller.signal);
      await jest.advanceTimersByTimeAsync(1);

      controller.abort();
      await jest.advanceTimersByTimeAsync(SSE_IDLE_TIMEOUT_MS);

      await expect(done).resolves.toBeUndefined();
      expect(streamingFetch).toHaveBeenCalledTimes(1);
    });

    it('gives up after six connections in a row that never open (e.g. a stopped BFF)', async () => {
      jest.mocked(streamingFetch).mockImplementation(() => new Promise(() => {}) as never);
      const result = followBotRun('default', 'run-1', () => {}, new AbortController().signal).catch((e: unknown) => e);

      // Six idle trips, with the 2/4/8/10/10 s backoff between them.
      await jest.advanceTimersByTimeAsync(6 * SSE_IDLE_TIMEOUT_MS + 34_000);

      await expect(result).resolves.toMatchObject({ code: 'timeout' });
      expect(streamingFetch).toHaveBeenCalledTimes(6);
    });

    it('keeps reopening a stream that opens and then stalls: each open resets the count, the polling cap ends the turn', async () => {
      const stalls = 8;
      for (let i = 0; i < stalls; i++) jest.mocked(streamingFetch).mockResolvedValueOnce(silentAfter() as never);
      jest.mocked(streamingFetch).mockResolvedValueOnce(sseResponse(completed) as never);
      const events: RunEvent[] = [];
      const done = followBotRun('default', 'run-1', (e) => events.push(e), new AbortController().signal);

      await jest.advanceTimersByTimeAsync(stalls * (SSE_IDLE_TIMEOUT_MS + 2_000));
      await done;

      expect(streamingFetch).toHaveBeenCalledTimes(stalls + 1);
      expect(events.map((e) => e.event)).toEqual(['run.completed']);
    });

    /** Counts the abort listeners currently registered on `signal`. */
    function trackAbortListeners(signal: AbortSignal) {
      const live = new Set<unknown>();
      const add = signal.addEventListener.bind(signal);
      const remove = signal.removeEventListener.bind(signal);
      jest.spyOn(signal, 'addEventListener').mockImplementation((type, listener, options) => {
        if (type === 'abort') live.add(listener);
        add(type, listener, options);
      });
      jest.spyOn(signal, 'removeEventListener').mockImplementation((type, listener, options) => {
        if (type === 'abort') live.delete(listener);
        remove(type, listener, options);
      });
      return live;
    }

    it("aborts the run-status check at once when the caller aborts, without waiting for the request timeout", async () => {
      jest.mocked(streamingFetch).mockResolvedValueOnce(sseResponse() as never);
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      );
      const controller = new AbortController();
      let settled = false;
      const done = followBotRun('default', 'run-1', () => {}, controller.signal).finally(() => (settled = true));
      await jest.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(1); // GET /bots/default/runs/run-1, in flight

      controller.abort();
      await jest.advanceTimersByTimeAsync(1);

      expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
      expect(settled).toBe(true);
      await expect(done).resolves.toBeUndefined();
    });

    it('removes its abort listeners from the caller signal once the run ends (no leak, no late abort)', async () => {
      // The stream closes without a terminal event, so both the stream and the run-status check listen.
      jest.mocked(streamingFetch).mockResolvedValueOnce(sseResponse() as never);
      respond(200, { run_id: 'run-1', status: 'completed', output: 'done' });
      const controller = new AbortController();
      const live = trackAbortListeners(controller.signal);

      await followBotRun('default', 'run-1', () => {}, controller.signal);

      expect(controller.signal.addEventListener).toHaveBeenCalled();
      expect(live.size).toBe(0);
      controller.abort();
      expect((jest.mocked(streamingFetch).mock.calls[0][1] as RequestInit).signal?.aborted).toBe(false);
      expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(false);
    });
  });
});

describe('@hermes-mobile/api', () => {
  it('exposes the run events that end a run', () => {
    expect([...TERMINAL_EVENTS]).toEqual(expect.arrayContaining(['run.completed', 'run.failed']));
  });
});
