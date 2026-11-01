import { TERMINAL_EVENTS, type HealthResponse } from '@hermes-mobile/api';
import { BffError, checkHealth } from '@mobile/lib/bff';

// bff.ts takes its streaming fetch from expo/fetch; these tests only use the global fetch path.
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

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

describe('@hermes-mobile/api', () => {
  it('exposes the run events that end a run', () => {
    expect([...TERMINAL_EVENTS]).toEqual(expect.arrayContaining(['run.completed', 'run.failed']));
  });
});
