import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENV_PATH = fileURLToPath(new URL('../.env', import.meta.url));

export type Config = {
  hermesUrl: string;
  hermesApiKey: string;
  host: string;
  port: number;
  deviceToken: string;
  hermesHome: string;
  profileKeys: Record<string, string>;
};

export function loadConfig(): Config {
  if (existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);
  const required = (name: string) => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is not set (see services/bff/.env.example)`);
    return value;
  };
  return {
    hermesUrl: (process.env.HERMES_URL ?? 'http://127.0.0.1:8642').replace(/\/$/, ''),
    hermesApiKey: required('HERMES_API_KEY'),
    host: process.env.BFF_HOST ?? '0.0.0.0',
    port: Number(process.env.BFF_PORT ?? 8787),
    deviceToken: required('DEVICE_TOKEN'),
    hermesHome: process.env.HERMES_HOME ?? join(homedir(), '.hermes'),
    profileKeys: profileKeysFromEnv(),
  };
}

// HERMES_PROFILE_KEY_<PROFILE>=<that profile's API_SERVER_KEY>, e.g. HERMES_PROFILE_KEY_RESEARCHER.
function profileKeysFromEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env)
      .filter(([k, v]) => k.startsWith('HERMES_PROFILE_KEY_') && v?.trim())
      .map(([k, v]) => [k.slice('HERMES_PROFILE_KEY_'.length).toLowerCase().replace(/_/g, '-'), v!.trim()]),
  );
}
