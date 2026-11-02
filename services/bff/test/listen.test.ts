import { createConnection } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { listenAll } from '../src/listen.ts';

const fetch = async (req: Request) => new Response(`ok ${new URL(req.url).pathname}`);
const quiet = () => {};
const urlHost = (h: string) => (h.includes(':') ? `[${h}]` : h);

const canConnect = (host: string, port: number) =>
  new Promise<boolean>((resolve) => {
    const s = createConnection({ host, port });
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
  });

// Skip ::1 gracefully on machines without IPv6 loopback.
async function loopbackHosts(): Promise<string[]> {
  const probe = await listenAll({ fetch, hosts: ['::1'], port: 0, log: quiet }).then(
    async (l) => (await l.close(), true),
    () => false,
  );
  return probe ? ['127.0.0.1', '::1'] : ['127.0.0.1'];
}

describe('listenAll', () => {
  it('opens one listener per host on the same port, logs one line each, and closes them all', async () => {
    const hosts = await loopbackHosts();
    const log = vi.fn();
    const listeners = await listenAll({ fetch, hosts, port: 0, log });

    expect(listeners.addresses.map((a) => a.address)).toEqual(hosts);
    const port = listeners.addresses[0]!.port;
    expect(port).toBeGreaterThan(0);
    expect(listeners.addresses.every((a) => a.port === port)).toBe(true);
    expect(log).toHaveBeenCalledTimes(hosts.length);
    for (const h of hosts) {
      expect(log).toHaveBeenCalledWith(expect.stringContaining(`listening on http://${urlHost(h)}:${port}`));
      const res = await globalThis.fetch(`http://${urlHost(h)}:${port}/health`);
      expect(await res.text()).toBe('ok /health');
    }

    await listeners.close();
    for (const h of hosts) expect(await canConnect(h, port)).toBe(false);
  });

  it('binds only the requested address, not every interface', async () => {
    const listeners = await listenAll({ fetch, hosts: ['127.0.0.1'], port: 0, log: quiet });
    try {
      expect(listeners.addresses).toEqual([{ address: '127.0.0.1', port: listeners.addresses[0]!.port }]);
    } finally {
      await listeners.close();
    }
  });

  it('fails naming the address that cannot be bound, and releases the ones already open', async () => {
    // Reserve a free port, then ask for it on a good host plus TEST-NET-1 (192.0.2.1), which is never a local address.
    const probe = await listenAll({ fetch, hosts: ['127.0.0.1'], port: 0, log: quiet });
    const port = probe.addresses[0]!.port;
    await probe.close();

    await expect(listenAll({ fetch, hosts: ['127.0.0.1', '192.0.2.1'], port, log: quiet })).rejects.toThrow(/192\.0\.2\.1/);
    expect(await canConnect('127.0.0.1', port)).toBe(false);
  });

  it('close() also drops connections that are still streaming', async () => {
    const hang = async () => new Response(new ReadableStream({ start() {} }));
    const listeners = await listenAll({ fetch: hang, hosts: ['127.0.0.1'], port: 0, log: quiet });
    const port = listeners.addresses[0]!.port;
    const pending = globalThis
      .fetch(`http://127.0.0.1:${port}/stream`)
      .then((r) => r.text())
      .then(
        () => 'ended',
        () => 'dropped',
      );
    await new Promise((r) => setTimeout(r, 100));
    await listeners.close();
    expect(await pending).toMatch(/ended|dropped/);
  });
});
