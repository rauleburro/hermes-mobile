import type { AddressInfo, Server } from 'node:net';
import { createAdaptorServer, type ServerType } from '@hono/node-server';

export type Listeners = {
  addresses: { address: string; port: number }[];
  close: () => Promise<void>;
};

type Options = {
  fetch: (req: Request) => Response | Promise<Response>;
  hosts: string[];
  port: number;
  log?: (line: string) => void;
};

// Host part of a URL: IPv6 in brackets, a zone id escaped (`%` -> `%25`).
export const urlHost = (address: string) => (address.includes(':') ? `[${address.replace('%', '%25')}]` : address);
const hostPort = (address: string, port: number) => `${address.includes(':') ? `[${address}]` : address}:${port}`;

function bind(server: ServerType, host: string, port: number): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    const net = server as Server;
    net.once('error', reject);
    net.listen(port, host, () => {
      net.off('error', reject);
      resolve(net.address() as AddressInfo);
    });
  });
}

function closeServer(server: ServerType): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    // Streaming responses (SSE) keep connections open; drop them so shutdown does not hang.
    (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
  });
}

// One listener per host, all on the same port. All-or-nothing: if any address cannot be bound
// (e.g. a Tailscale interface that is not up yet) the ones already open are closed and it rejects.
export async function listenAll({ fetch, hosts, port, log = console.log }: Options): Promise<Listeners> {
  const servers: ServerType[] = [];
  const addresses: Listeners['addresses'] = [];
  const close = async () => void (await Promise.all(servers.map(closeServer)));
  const lines: string[] = [];
  let boundPort = port;
  for (const host of hosts) {
    const server = createAdaptorServer({ fetch, hostname: host });
    servers.push(server);
    try {
      const info = await bind(server, host, boundPort);
      boundPort = info.port; // with port 0, later hosts reuse the port the first one got
      addresses.push({ address: info.address, port: info.port });
      lines.push(`hermes-bff listening on http://${urlHost(info.address)}:${info.port}`);
    } catch (err) {
      await close();
      const reason = (err as NodeJS.ErrnoException).code ?? (err as Error).message;
      throw new Error(`BFF cannot listen on ${hostPort(host, boundPort)} (${reason}); check BFF_HOST`, { cause: err });
    }
  }
  lines.forEach((line) => log(line)); // only once every address is bound, so a rolled-back start logs nothing
  return { addresses, close };
}

type Signal = 'SIGINT' | 'SIGTERM';

// On SIGINT/SIGTERM close every listener, then exit (0, or 1 if closing failed). Closes once only.
export function onShutdown(
  listeners: Pick<Listeners, 'close'>,
  { on, exit }: { on: (signal: Signal, handler: () => void) => void; exit: (code: number) => void },
): void {
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    listeners.close().then(
      () => exit(0),
      (err) => {
        console.error(err instanceof Error ? err.message : err);
        exit(1);
      },
    );
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) on(signal, shutdown);
}
