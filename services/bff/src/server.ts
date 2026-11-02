import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { listenAll, onShutdown } from './listen.ts';
import { readRoster } from './roster.ts';

try {
  const config = loadConfig();
  const app = createApp({ ...config, readRoster: () => readRoster(config.hermesHome) });
  const listeners = await listenAll({ fetch: app.fetch, hosts: config.hosts, port: config.port });
  console.log(`hermes-bff → ${config.hermesUrl}`);

  onShutdown(listeners, { on: (signal, handler) => process.once(signal, handler), exit: (code) => process.exit(code) });
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
