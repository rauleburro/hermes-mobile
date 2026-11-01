// Builds the pairing link the phone opens: <scheme>://pair?url=<bff-url>&token=<device-token>.
// The scheme is `hermesmobile` unless APP_SCHEME says otherwise (a fork build, see apps/mobile/app.config.ts).

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

/**
 * The BFF URL to put in the link: `--url <url>` (or `--url=<url>`) when given, for example
 * `http://localhost:8787` over `adb reverse` or a Tailscale name; otherwise the first LAN address.
 */
export function pairingUrl({ argv, port, lanIp }: { argv: string[]; port: string; lanIp?: string }): string {
  const i = argv.findIndex((a) => a === '--url' || a.startsWith('--url='));
  if (i === -1) return `http://${lanIp ?? 'localhost'}:${port}`;
  const raw = (argv[i].startsWith('--url=') ? argv[i].slice('--url='.length) : argv[i + 1]) ?? '';
  const url = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+/i.test(url)) throw new Error(`--url must be an http(s) URL, got "${raw}"`);
  return url;
}

export function pairingLink(url: string, token: string, scheme: string = DEFAULT_APP_SCHEME): string {
  return `${scheme}://pair?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`;
}
