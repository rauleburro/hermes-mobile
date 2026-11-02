import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENV_PATH = fileURLToPath(new URL('../.env', import.meta.url));

export type Config = {
  hermesUrl: string;
  hermesApiKey: string;
  hosts: string[];
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
    hosts: parseHosts(process.env.BFF_HOST),
    port: Number(process.env.BFF_PORT ?? 8787),
    deviceToken: required('DEVICE_TOKEN'),
    hermesHome: process.env.HERMES_HOME ?? join(homedir(), '.hermes'),
    profileKeys: profileKeysFromEnv(),
  };
}

// Lowercase `localhost`, canonicalise IPv6 (so `::1` and `0:0:0:0:0:0:0:1` compare equal); a zone id is kept.
function canonicalHost(entry: string): string {
  if (entry.toLowerCase() === 'localhost') return 'localhost';
  if (isIP(entry) !== 6) return entry;
  const [address = '', ...zone] = entry.split('%');
  const canonical = new URL(`http://[${address}]`).hostname.slice(1, -1);
  return zone.length ? `${canonical}%${zone.join('%')}` : canonical;
}

// BFF_HOST: comma-separated IPv4/IPv6 literals or `localhost`; one listener per address.
// Unset (or only blanks) keeps the historical default, every IPv4 interface.
export function parseHosts(raw: string | undefined): string[] {
  const entries = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries) {
    if (entry.toLowerCase() !== 'localhost' && !isIP(entry)) {
      throw new Error(`BFF_HOST has an invalid entry "${entry}": use IPv4/IPv6 addresses or localhost, separated by commas`);
    }
  }
  const hosts = [...new Set(entries.map(canonicalHost))];
  if (hosts.includes('::') && hosts.includes('0.0.0.0')) {
    throw new Error('BFF_HOST lists both "::" and "0.0.0.0": "::" already listens on IPv4 too (dual-stack), so keep only one of them');
  }
  return hosts.length ? hosts : ['0.0.0.0'];
}

// HERMES_PROFILE_KEY_<PROFILE>=<that profile's API_SERVER_KEY>, e.g. HERMES_PROFILE_KEY_RESEARCHER.
function profileKeysFromEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env)
      .filter(([k, v]) => k.startsWith('HERMES_PROFILE_KEY_') && v?.trim())
      .map(([k, v]) => [k.slice('HERMES_PROFILE_KEY_'.length).toLowerCase().replace(/_/g, '-'), v!.trim()]),
  );
}
