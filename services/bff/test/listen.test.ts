import { createConnection } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { listenAll, onShutdown, urlHost } from '../src/listen.ts';

const fetch = async (req: Request) => new Response(`ok ${new URL(req.url).pathname}`);
const quiet = () => {};

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

describe('listenAll messages', () => {
  it('writes no "listening on" lines when a later address fails (the earlier ones are rolled back)', async () => {
    const log = vi.fn();
    await expect(listenAll({ fetch, hosts: ['127.0.0.1', '192.0.2.1'], port: 0, log })).rejects.toThrow();
    expect(log).not.toHaveBeenCalled();
  });

  it('brackets an IPv6 address in the bind error', async () => {
    // 2001:db8::/32 is the documentation range: never a local address (or IPv6 is unavailable); either way the bind fails.
    await expect(listenAll({ fetch, hosts: ['2001:db8::1'], port: 0, log: quiet })).rejects.toThrow(/\[2001:db8::1\]:\d+/);
  });
});

describe('urlHost', () => {
  it('brackets IPv6 and escapes a zone id so the logged URL is valid', () => {
    expect(urlHost('127.0.0.1')).toBe('127.0.0.1');
    expect(urlHost('::1')).toBe('[::1]');
    expect(urlHost('fe80::1%en0')).toBe('[fe80::1%25en0]');
  });
});

describe('onShutdown', () => {
  const setup = (close: () => Promise<void>) => {
    const order: string[] = [];
    const handlers = new Map<string, () => void>();
    const closeSpy = vi.fn(async () => {
      order.push('close:start');
      await close();
      order.push('close:done');
    });
    const exit = vi.fn((code: number) => void order.push(`exit:${code}`));
    onShutdown({ close: closeSpy }, { on: (signal, handler) => void handlers.set(signal, handler), exit });
    return { order, handlers, closeSpy, exit };
  };
  const settle = () => new Promise((r) => setTimeout(r, 10));

  it('handles SIGINT and SIGTERM by closing the listeners and only then exiting 0', async () => {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const t = setup(() => new Promise((r) => setTimeout(r, 5)));
      expect([...t.handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM']);
      t.handlers.get(signal)!();
      expect(t.exit).not.toHaveBeenCalled();
      await settle();
      expect(t.order).toEqual(['close:start', 'close:done', 'exit:0']);
    }
  });

  it('closes only once when both signals arrive', async () => {
    const t = setup(async () => {});
    t.handlers.get('SIGINT')!();
    t.handlers.get('SIGTERM')!();
    await settle();
    expect(t.closeSpy).toHaveBeenCalledTimes(1);
    expect(t.exit).toHaveBeenCalledTimes(1);
  });

  it('exits 1 when closing fails', async () => {
    const t = setup(async () => {
      throw new Error('boom');
    });
    t.handlers.get('SIGTERM')!();
    await settle();
    expect(t.exit).toHaveBeenCalledWith(1);
  });
});
