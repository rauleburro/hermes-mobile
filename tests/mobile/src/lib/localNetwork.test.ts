import { BffError } from '@mobile/lib/bff';
import {
  checkedLocalNetworkHint,
  ensureLocalNetworkAccess,
  isLocalNetworkUrl,
  localNetworkHint,
  LOCAL_NETWORK_HINT,
  LOCAL_NETWORK_PERMISSION,
  type LocalNetworkPermissions,
} from '@mobile/lib/localNetwork';

const android17 = { OS: 'android', Version: 37 } as const;
const android16 = { OS: 'android', Version: 36 } as const;
const ios = { OS: 'ios', Version: '26.0' } as const;

/** A fake PermissionsAndroid: `held` is what check() answers, `answer` what request() resolves to. */
function permissions(held: boolean, answer: 'granted' | 'denied' | 'never_ask_again' = 'granted') {
  return {
    check: jest.fn<Promise<boolean>, [string]>().mockResolvedValue(held),
    request: jest.fn<Promise<'granted' | 'denied' | 'never_ask_again'>, [string]>().mockResolvedValue(answer),
  } satisfies LocalNetworkPermissions;
}

describe('isLocalNetworkUrl', () => {
  it.each([
    'http://10.0.0.5:8787',
    'http://172.16.0.1:8787',
    'http://172.31.255.254',
    'http://192.168.1.10:8787',
    'http://169.254.10.20:8787',
    'http://100.64.0.1:8787',
    'http://100.127.255.254',
    'http://hermes-bff.local:8787',
    'http://Hermes-BFF.LOCAL.:8787',
    'http://[fe80::1]:8787',
    'http://[fd12:3456::1]:8787',
  ])('treats %s as the local network', (url) => {
    expect(isLocalNetworkUrl(url)).toBe(true);
  });

  it.each([
    'http://localhost:8787',
    'http://127.0.0.1:8787',
    'http://[::1]:8787',
    'https://bff.example.com',
    'http://8.8.8.8',
    'http://172.32.0.1',
    'http://100.128.0.1',
    'http://192.0.2.1:9',
    'http://localhost.example.com',
    'not a url',
  ])('does not treat %s as the local network', (url) => {
    expect(isLocalNetworkUrl(url)).toBe(false);
  });
});

describe('ensureLocalNetworkAccess', () => {
  it('asks for Nearby devices on Android 17 before reaching a local address the app may not use yet', async () => {
    const perms = permissions(false, 'granted');

    await expect(ensureLocalNetworkAccess('http://192.168.1.10:8787', android17, perms)).resolves.toBe('granted');

    expect(perms.check).toHaveBeenCalledWith(LOCAL_NETWORK_PERMISSION);
    expect(perms.request).toHaveBeenCalledWith(LOCAL_NETWORK_PERMISSION);
    expect(LOCAL_NETWORK_PERMISSION).toBe('android.permission.ACCESS_LOCAL_NETWORK');
  });

  it('does not ask again when the app already holds it', async () => {
    const perms = permissions(true);

    await expect(ensureLocalNetworkAccess('http://bff.local:8787', android17, perms)).resolves.toBe('granted');

    expect(perms.request).not.toHaveBeenCalled();
  });

  it.each(['denied', 'never_ask_again'] as const)('reports a %s answer as denied', async (answer) => {
    const perms = permissions(false, answer);

    await expect(ensureLocalNetworkAccess('http://10.0.0.5:8787', android17, perms)).resolves.toBe('denied');
  });

  it.each([
    ['loopback (adb reverse is exempt)', 'http://localhost:8787', android17],
    ['a public address', 'https://bff.example.com', android17],
    ['Android 16 and older', 'http://192.168.1.10:8787', android16],
    ['iOS', 'http://192.168.1.10:8787', ios],
  ] as const)('never checks or asks for %s', async (_case, url, env) => {
    const perms = permissions(false);

    await expect(ensureLocalNetworkAccess(url, env, perms)).resolves.toBe('not-needed');

    expect(perms.check).not.toHaveBeenCalled();
    expect(perms.request).not.toHaveBeenCalled();
  });
});

describe('localNetworkHint', () => {
  const networkError = new TypeError('Network request failed');

  it('names the Nearby devices permission and where to allow it after a network error to a local address', () => {
    const hint = localNetworkHint('http://192.168.1.10:8787', networkError, { env: android17 });

    expect(hint).toMatch(/Nearby devices/);
    expect(hint).toMatch(/Settings/);
  });

  it("also after Expo's fetch error, which is a plain Error (the app's global fetch since SDK 58)", () => {
    const expoFetchError = new Error('fetch failed: java.net.UnknownHostException: Unable to resolve host "bff.local"');

    expect(localNetworkHint('http://bff.local:8787', expoFetchError, { env: android17 })).toMatch(/Nearby devices/);
  });

  it('also after the exact error a Pixel on Android 17 gives for an unresolvable .local host', () => {
    const onDevice = new Error(
      'fetch failed: java.net.UnknownHostException: Unable to resolve host "no-such-bff.local": No address associated with hostname',
    );

    expect(localNetworkHint('http://no-such-bff.local:8787', onDevice, { env: android17 })).toBe(LOCAL_NETWORK_HINT);
    expect(localNetworkHint('http://no-such-bff.local:8787', onDevice, { env: android17, granted: true })).toBeNull();
  });

  it("also after React Native's own fetch timeout", () => {
    expect(localNetworkHint('http://192.168.1.10:8787', new TypeError('Network request timed out'), { env: android17 })).toMatch(/Nearby devices/);
  });

  it('also after a request timeout: a blocked local connection never answers, so the app gives up at 15 s', () => {
    const timeout = new BffError('GET /bots timed out', undefined, 'timeout');

    expect(localNetworkHint('http://192.168.1.10:8787', timeout, { env: android17 })).toMatch(/Nearby devices/);
  });

  it('stays quiet when the app is known to hold Nearby devices: the failure has another cause', () => {
    expect(localNetworkHint('http://192.168.1.10:8787', networkError, { env: android17, granted: true })).toBeNull();
    expect(localNetworkHint('http://192.168.1.10:8787', networkError, { env: android17, granted: false })).toBe(LOCAL_NETWORK_HINT);
  });

  it.each([
    ['the BFF answered with an error', 'http://192.168.1.10:8787', new BffError('GET /bots failed (500)', 500), android17],
    ['the app is not paired', 'http://192.168.1.10:8787', new BffError('Not paired with a BFF'), android17],
    ['the request was aborted by the app', 'http://192.168.1.10:8787', new BffError('GET /bots aborted', undefined, 'aborted'), android17],
    ['a timeout carries an HTTP status', 'http://192.168.1.10:8787', new BffError('GET /bots failed (504)', 504, 'timeout'), android17],
    ['secure storage failed to save the pairing', 'http://192.168.1.10:8787', new Error("Calling the 'setValueWithKeyAsync' function has failed"), android17],
    ['a 200 answer was not JSON (captive portal, wrong port)', 'http://192.168.1.10:8787', new SyntaxError('JSON Parse error: Unexpected character: <'), android17],
    ['the roster was malformed', 'http://192.168.1.10:8787', new TypeError("Cannot read property 'filter' of undefined"), android17],
    ['the address is loopback', 'http://localhost:8787', networkError, android17],
    ['the address is public', 'https://bff.example.com', networkError, android17],
    ['there is no URL', null, networkError, android17],
    ['Android is older than 17', 'http://192.168.1.10:8787', networkError, android16],
    ['the platform is iOS', 'http://192.168.1.10:8787', networkError, ios],
  ] as const)('stays quiet when %s', (_case, url, error, env) => {
    expect(localNetworkHint(url, error, { env })).toBeNull();
  });
});

describe('checkedLocalNetworkHint', () => {
  const networkError = new TypeError('Network request failed');
  const local = 'http://192.168.1.10:8787';

  it('checks the permission before naming Nearby devices, and never asks for it', async () => {
    const perms = permissions(false);

    await expect(checkedLocalNetworkHint(local, networkError, { env: android17, permissions: perms })).resolves.toBe(LOCAL_NETWORK_HINT);

    expect(perms.check).toHaveBeenCalledWith(LOCAL_NETWORK_PERMISSION);
    expect(perms.request).not.toHaveBeenCalled();
  });

  it('stays quiet when the app holds Nearby devices', async () => {
    await expect(checkedLocalNetworkHint(local, networkError, { env: android17, permissions: permissions(true) })).resolves.toBeNull();
  });

  it('names Nearby devices when the check itself fails (not known to be granted)', async () => {
    const perms = permissions(true);
    perms.check.mockRejectedValue(new Error('PermissionsAndroid is not installed correctly.'));

    await expect(checkedLocalNetworkHint(local, networkError, { env: android17, permissions: perms })).resolves.toBe(LOCAL_NETWORK_HINT);
  });

  it('does not check when no hint would show anyway', async () => {
    const perms = permissions(false);

    await expect(checkedLocalNetworkHint('http://localhost:8787', networkError, { env: android17, permissions: perms })).resolves.toBeNull();
    await expect(checkedLocalNetworkHint(local, new Error('GET /bots failed (502)'), { env: android17, permissions: perms })).resolves.toBeNull();

    expect(perms.check).not.toHaveBeenCalled();
  });
});
