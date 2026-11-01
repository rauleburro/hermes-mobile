// Android 17 (API 37) local network protection: traffic to a local-network address needs the
// runtime permission ACCESS_LOCAL_NETWORK, shown to users as "Nearby devices". Without it a
// request to a BFF on the LAN is blocked, which in practice hangs until the app gives up (15 s).
// Apps that target API 36 or lower and don't declare it get it implicitly with INTERNET; debug
// builds declare it (React Native's debug manifest), so there it can be denied.
// See https://developer.android.com/privacy-and-security/local-network-permission
import { Platform, PermissionsAndroid } from 'react-native';
import { BffError } from './bff';

type Env = { OS: string; Version: number | string };
type Answer = 'granted' | 'denied' | 'never_ask_again';
/** The part of PermissionsAndroid this module uses (injectable for tests). */
export type LocalNetworkPermissions = {
  check(permission: typeof LOCAL_NETWORK_PERMISSION): Promise<boolean>;
  request(permission: typeof LOCAL_NETWORK_PERMISSION): Promise<Answer>;
};

export const LOCAL_NETWORK_PERMISSION = PermissionsAndroid.PERMISSIONS.ACCESS_LOCAL_NETWORK;

/** First API level that enforces local network protection. */
const ENFORCED_FROM = 37;

export const LOCAL_NETWORK_HINT =
  'Android may be blocking the local network for this app. Allow "Nearby devices": Settings > Apps > this app > Permissions > Nearby devices > Allow.';

const octets = (host: string) => {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return m ? m.slice(1).map(Number) : null;
};

/**
 * Whether `url` points at the local network as Android defines it: RFC 1918, CGNAT (100.64/10),
 * link-local and multicast addresses, IPv6 link-local and unique-local (in practice a directly
 * connected route), and mDNS `.local` names. Loopback is not: `adb reverse` traffic is exempt.
 * Other names (e.g. `mac.lan`) can't be told apart without resolving them.
 * See https://developer.android.com/privacy-and-security/local-network-definition
 */
export function isLocalNetworkUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return false;
  }
  if (host.startsWith('[')) {
    const v6 = host.slice(1, -1);
    // fe80::/10 link-local, fc00::/7 unique-local, ff00::/8 multicast.
    return /^(fe[89ab]|f[cd]|ff)/.test(v6);
  }
  const ip = octets(host);
  if (!ip) return host.endsWith('.local');
  const [a, b] = ip;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a >= 224 && a <= 239) ||
    host === '255.255.255.255'
  );
}

/** Whether Android gates traffic to `url` behind the Nearby devices permission. */
const gated = (url: string, env: Env) =>
  env.OS === 'android' && Number(env.Version) >= ENFORCED_FROM && isLocalNetworkUrl(url);

/**
 * Asks for Nearby devices before the app talks to `url`, when Android gates it and the app doesn't
 * hold it yet. The answer only shapes what the app explains: callers still make the request
 * (a build that doesn't declare the permission is denied without a prompt, yet keeps access).
 */
export async function ensureLocalNetworkAccess(
  url: string,
  env: Env = Platform,
  permissions: LocalNetworkPermissions = PermissionsAndroid,
): Promise<'not-needed' | 'granted' | 'denied'> {
  if (!gated(url, env)) return 'not-needed';
  if (await permissions.check(LOCAL_NETWORK_PERMISSION)) return 'granted';
  return (await permissions.request(LOCAL_NETWORK_PERMISSION)) === 'granted' ? 'granted' : 'denied';
}

/**
 * How fetch rejects when the request never got an answer: Expo's global fetch (the app's since
 * SDK 58) with a plain Error, "fetch failed: …"; React Native's with a TypeError, "Network
 * request failed" or "Network request timed out".
 */
const FETCH_FAILURE = /^(fetch failed\b|Network request (failed|timed out)\b)/;

/**
 * Whether `error` means the BFF couldn't be reached: a fetch failure, or the app's own request
 * timeout (a BffError with code `timeout` and no HTTP status). Other errors are not: a BffError
 * means the BFF answered, the app isn't paired, or the app aborted the request; anything else
 * (a 200 that isn't JSON, a malformed answer, secure storage) happened after the BFF answered
 * or away from the network.
 */
function isNetworkFailure(error: unknown): boolean {
  if (error instanceof BffError) return error.code === 'timeout' && error.status === undefined;
  return error instanceof Error && FETCH_FAILURE.test(error.message);
}

/**
 * The hint to show after `error` reaching the BFF at `url`, or null. Only for a network failure
 * (a blocked local connection may also never answer, so the request times out) against a local
 * address on Android 17 or later.
 */
export function localNetworkHint(url: string | null, error: unknown, { env = Platform }: { env?: Env } = {}): string | null {
  if (!url || !isNetworkFailure(error) || !gated(url, env)) return null;
  return LOCAL_NETWORK_HINT;
}
