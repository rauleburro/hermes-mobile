// Builds the pairing link the phone opens: <scheme>://pair?url=<bff-url>&token=<device-token>.
// The scheme is `hermesmobile` unless APP_SCHEME says otherwise (a fork build, see apps/mobile/app.config.ts).

import { isIP } from 'node:net';
import { parseEnv } from 'node:util';
import { parseHosts } from './config.ts';

export const DEFAULT_APP_SCHEME = 'hermesmobile';

/**
 * The URL scheme for pairing links from APP_SCHEME. Blank means the default. Same rules as the app
 * config: lowercase RFC 3986 scheme, not http(s). Invalid values throw instead of printing a dead link.
 */
export function appScheme(raw: string | undefined): string {
  const value = raw?.trim() || DEFAULT_APP_SCHEME;
  if (!/^[a-z][a-z0-9+.-]*$/.test(value) || value === 'http' || value === 'https') {
    throw new Error(`APP_SCHEME="${value}" is invalid: expected a lowercase URI scheme (letters, digits, "+", "-", "."; starting with a letter; not http/https)`);
  }
  return value;
}

/** APP_SCHEME from the shell if non-blank, else from the .env file text, else the default; validated. */
export function resolveAppScheme(shellValue: string | undefined, envFileText: string): string {
  return appScheme(shellValue?.trim() || parseEnv(envFileText).APP_SCHEME);
}

/** BFF_HOST from the shell if non-blank, else from the .env file text, else the default; validated. */
export function resolveBffHosts(shellValue: string | undefined, envFileText: string): string[] {
  return parseHosts(shellValue?.trim() || parseEnv(envFileText).BFF_HOST);
}

/**
 * What `pnpm pair` needs from the .env text, with no I/O: the scheme and BFF_HOST list (validated
 * FIRST, so a bad APP_SCHEME or BFF_HOST never rotates or writes a token), the device token (generated
 * when missing or on `rotate`), the updated .env text, and whether it changed (the caller writes it only then).
 */
export function preparePairing({
  envText,
  rotate,
  shellScheme,
  shellHost,
  generateToken,
}: {
  envText: string;
  rotate: boolean;
  shellScheme: string | undefined;
  shellHost?: string;
  generateToken: () => string;
}): { envText: string; token: string; changed: boolean; port: string; scheme: string; hosts: string[] } {
  const scheme = resolveAppScheme(shellScheme, envText);
  const hosts = resolveBffHosts(shellHost, envText);
  const port = envText.match(/^BFF_PORT=(\d+)$/m)?.[1] ?? '8787';
  const existing = envText.match(/^DEVICE_TOKEN=(.+)$/m)?.[1]?.trim();
  if (existing && !rotate) return { envText, token: existing, changed: false, port, scheme, hosts };
  const token = generateToken();
  const updated = /^DEVICE_TOKEN=.*$/m.test(envText)
    ? envText.replace(/^DEVICE_TOKEN=.*$/m, `DEVICE_TOKEN=${token}`)
    : `${envText.trimEnd()}\nDEVICE_TOKEN=${token}\n`;
  return { envText: updated, token, changed: true, port, scheme, hosts };
}

const isLoopback = (h: string) => h === 'localhost' || h === '::1' || h.startsWith('127.');
const isWildcard = (h: string) => h === '0.0.0.0' || h === '::';
const urlArgIndex = (argv: string[]) => argv.findIndex((a) => a === '--url' || a.startsWith('--url='));
const urlHostPart = (h: string) => (h.includes(':') ? `[${h.replace('%', '%25')}]` : h);

/**
 * The BFF URL to put in the link: `--url <url>` (or `--url=<url>`) when given, for example
 * `http://localhost:8787` over `adb reverse` or a Tailscale name. Otherwise it follows BFF_HOST: the
 * first address that is neither loopback nor wildcard; a wildcard means the first LAN address; loopback
 * only means `localhost` (reached with `adb reverse`).
 */
export function pairingUrl({
  argv,
  port,
  lanIp,
  hosts = ['0.0.0.0'],
}: {
  argv: string[];
  port: string;
  lanIp?: string;
  hosts?: string[];
}): string {
  const i = urlArgIndex(argv);
  if (i === -1) {
    const specific = hosts.find((h) => !isLoopback(h) && !isWildcard(h));
    if (specific) return `http://${urlHostPart(specific)}:${port}`;
    if (hosts.some(isWildcard)) return `http://${lanIp ?? 'localhost'}:${port}`;
    return `http://localhost:${port}`;
  }
  const raw = (argv[i].startsWith('--url=') ? argv[i].slice('--url='.length) : argv[i + 1]) ?? '';
  const url = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+/i.test(url)) throw new Error(`--url must be an http(s) URL, got "${raw}"`);
  return url;
}

/**
 * Lines `pnpm pair` prints after the link: the `adb reverse` command when the link points at loopback,
 * and a warning when an explicit `--url` IP/localhost is not covered by BFF_HOST. Host names (Tailscale
 * names, a reverse proxy) can't be checked and never warn.
 */
export function pairingNotes({ argv, url, port, hosts }: { argv: string[]; url: string; port: string; hosts: string[] }): string[] {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return [];
  }
  const notes: string[] = [];
  if (isLoopback(host)) notes.push(`Over USB run: adb reverse tcp:${port} tcp:${port}`);
  if (urlArgIndex(argv) !== -1) {
    const family = isIP(host);
    const covered = isLoopback(host)
      ? hosts.some((h) => isLoopback(h) || isWildcard(h))
      : family === 4
        ? hosts.includes(host) || hosts.some(isWildcard)
        : family === 6
          ? hosts.includes(host) || hosts.includes('::')
          : true;
    if (!covered) {
      notes.push(
        `Warning: ${host} is not covered by BFF_HOST (${hosts.join(', ')}), so the phone won't reach the BFF there. Add it to BFF_HOST and restart the BFF.`,
      );
    }
  }
  return notes;
}

export function pairingLink(url: string, token: string, scheme: string = DEFAULT_APP_SCHEME): string {
  return `${scheme}://pair?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`;
}
