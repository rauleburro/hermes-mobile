// Builds the pairing link the phone opens: hermesmobile://pair?url=<bff-url>&token=<device-token>.

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

export function pairingLink(url: string, token: string): string {
  return `hermesmobile://pair?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`;
}
