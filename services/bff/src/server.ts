import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { readRoster } from './roster.ts';

const config = loadConfig();
const app = createApp({ ...config, readRoster: () => readRoster(config.hermesHome) });

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, ({ address, port }) => {
  console.log(`hermes-bff listening on http://${address}:${port} → ${config.hermesUrl}`);
});
