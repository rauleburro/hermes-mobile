import { describe, expect, it, vi } from 'vitest';
import { appScheme, pairingLink, pairingNotes, pairingUrl, preparePairing, resolveAppScheme, resolveBffHosts } from '../src/pairing.ts';

describe('pairingUrl', () => {
  it('uses --url when given (adb reverse, Tailscale, a reverse proxy), without trailing slash', () => {
    expect(pairingUrl({ argv: ['--url', 'http://localhost:8787/'], port: '8787', lanIp: '192.0.2.10' })).toBe(
      'http://localhost:8787',
    );
    expect(pairingUrl({ argv: ['--url=https://bff.example.ts.net'], port: '8787' })).toBe('https://bff.example.ts.net');
  });

  it('defaults to the first LAN address and the BFF port', () => {
    expect(pairingUrl({ argv: [], port: '8795', lanIp: '192.0.2.10' })).toBe('http://192.0.2.10:8795');
  });

  it('falls back to localhost when there is no LAN address', () => {
    expect(pairingUrl({ argv: [], port: '8787' })).toBe('http://localhost:8787');
  });

  it('rejects a --url that is not http(s)', () => {
    expect(() => pairingUrl({ argv: ['--url', 'bff.local:8787'], port: '8787' })).toThrow(/http/);
    expect(() => pairingUrl({ argv: ['--url'], port: '8787' })).toThrow(/http/);
  });
});

describe('pairingLink', () => {
  it('encodes the URL and token for hermesmobile://pair', () => {
    expect(pairingLink('http://localhost:8787', 'a+b/c=')).toBe(
      'hermesmobile://pair?url=http%3A%2F%2Flocalhost%3A8787&token=a%2Bb%2Fc%3D',
    );
  });

  it('uses a custom scheme for a fork build', () => {
    expect(pairingLink('http://localhost:8787', 'tok', 'forkbots')).toBe(
      'forkbots://pair?url=http%3A%2F%2Flocalhost%3A8787&token=tok',
    );
  });
});

describe('appScheme', () => {
  it('defaults to the official scheme when APP_SCHEME is unset or blank', () => {
    expect(appScheme(undefined)).toBe('hermesmobile');
    expect(appScheme('  ')).toBe('hermesmobile');
  });

  it('returns the trimmed custom scheme', () => {
    expect(appScheme(' forkbots ')).toBe('forkbots');
    expect(appScheme('fork-bots.v2+x')).toBe('fork-bots.v2+x');
  });

  it.each(['Bad_Scheme', 'ForkBots', '1fork', 'a://b', 'has space', 'http', 'https'])(
    'rejects APP_SCHEME=%s like the app config does',
    (scheme) => {
      expect(() => appScheme(scheme)).toThrow(/APP_SCHEME/);
    },
  );
});

describe('resolveAppScheme', () => {
  it('prefers the shell value over the .env file', () => {
    expect(resolveAppScheme('shellscheme', 'APP_SCHEME=filescheme\n')).toBe('shellscheme');
  });

  it('treats a blank shell value as unset and falls back to the .env file', () => {
    expect(resolveAppScheme('', 'APP_SCHEME=filescheme\n')).toBe('filescheme');
    expect(resolveAppScheme('   ', 'APP_SCHEME=filescheme\n')).toBe('filescheme');
  });

  it('reads the .env file alone, ignoring comments', () => {
    expect(resolveAppScheme(undefined, '# APP_SCHEME=commented\nAPP_SCHEME=filescheme\n')).toBe('filescheme');
  });

  it('defaults when neither is set or both are blank', () => {
    expect(resolveAppScheme(undefined, 'BFF_PORT=8787\n')).toBe('hermesmobile');
    expect(resolveAppScheme('', 'APP_SCHEME=\n')).toBe('hermesmobile');
  });

  it('throws on an invalid scheme from either source', () => {
    expect(() => resolveAppScheme('Bad_Scheme', '')).toThrow(/APP_SCHEME/);
    expect(() => resolveAppScheme(undefined, 'APP_SCHEME=Bad_Scheme\n')).toThrow(/APP_SCHEME/);
  });
});

describe('preparePairing', () => {
  const generateToken = () => 'new-token';

  it('keeps an existing token and reports no change', () => {
    const env = 'BFF_PORT=8800\nDEVICE_TOKEN=old-token\n';
    expect(preparePairing({ envText: env, rotate: false, shellScheme: undefined, generateToken })).toEqual({
      envText: env,
      token: 'old-token',
      changed: false,
      port: '8800',
      scheme: 'hermesmobile',
      hosts: ['0.0.0.0'],
    });
  });

  it('fills an empty DEVICE_TOKEN line', () => {
    const result = preparePairing({ envText: 'DEVICE_TOKEN=\nBFF_PORT=8787\n', rotate: false, shellScheme: undefined, generateToken });
    expect(result).toMatchObject({ token: 'new-token', changed: true, port: '8787' });
    expect(result.envText).toBe('DEVICE_TOKEN=new-token\nBFF_PORT=8787\n');
  });

  it('appends DEVICE_TOKEN when there is no such line, and defaults the port', () => {
    const result = preparePairing({ envText: 'X=1', rotate: false, shellScheme: undefined, generateToken });
    expect(result.envText).toBe('X=1\nDEVICE_TOKEN=new-token\n');
    expect(result.port).toBe('8787');
  });

  it('rotates an existing token on request', () => {
    const result = preparePairing({ envText: 'DEVICE_TOKEN=old-token\n', rotate: true, shellScheme: undefined, generateToken });
    expect(result).toMatchObject({ token: 'new-token', changed: true });
    expect(result.envText).toBe('DEVICE_TOKEN=new-token\n');
  });

  it('resolves the scheme from the shell, then the file', () => {
    const envText = 'DEVICE_TOKEN=t\nAPP_SCHEME=filescheme\n';
    expect(preparePairing({ envText, rotate: false, shellScheme: 'shellscheme', generateToken }).scheme).toBe('shellscheme');
    expect(preparePairing({ envText, rotate: false, shellScheme: '', generateToken }).scheme).toBe('filescheme');
  });

  it('validates the scheme before generating a token, so --rotate with a bad scheme changes nothing', () => {
    const spy = vi.fn(generateToken);
    expect(() => preparePairing({ envText: 'DEVICE_TOKEN=old-token\n', rotate: true, shellScheme: 'Bad', generateToken: spy })).toThrow(/APP_SCHEME/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('resolveBffHosts', () => {
  it('prefers the shell value over the .env file, like APP_SCHEME', () => {
    expect(resolveBffHosts('127.0.0.1', 'BFF_HOST=100.64.0.10\n')).toEqual(['127.0.0.1']);
    expect(resolveBffHosts('  ', 'BFF_HOST=100.64.0.10\n')).toEqual(['100.64.0.10']);
  });

  it('reads a list from the .env file, ignoring comments, and defaults to 0.0.0.0', () => {
    expect(resolveBffHosts(undefined, '# BFF_HOST=1.2.3.4\nBFF_HOST=127.0.0.1, 100.64.0.10\n')).toEqual(['127.0.0.1', '100.64.0.10']);
    expect(resolveBffHosts(undefined, 'BFF_PORT=8787\n')).toEqual(['0.0.0.0']);
  });

  it('throws on an invalid entry', () => {
    expect(() => resolveBffHosts('nope', '')).toThrow(/BFF_HOST.*"nope"/);
  });
});

describe('preparePairing hosts', () => {
  const generateToken = () => 'new-token';

  it('returns the hosts from the shell, then the file', () => {
    const envText = 'DEVICE_TOKEN=t\nBFF_HOST=127.0.0.1\n';
    expect(preparePairing({ envText, rotate: false, shellScheme: undefined, shellHost: '100.64.0.10', generateToken }).hosts).toEqual(['100.64.0.10']);
    expect(preparePairing({ envText, rotate: false, shellScheme: undefined, generateToken }).hosts).toEqual(['127.0.0.1']);
  });

  it('validates BFF_HOST before generating a token, so a bad value never rotates it', () => {
    const spy = vi.fn(generateToken);
    expect(() => preparePairing({ envText: 'DEVICE_TOKEN=old\nBFF_HOST=nope\n', rotate: true, shellScheme: undefined, generateToken: spy })).toThrow(/BFF_HOST/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('pairingUrl follows BFF_HOST', () => {
  const lanIp = '192.0.2.10';

  it('loopback only: localhost', () => {
    expect(pairingUrl({ argv: [], port: '8787', lanIp, hosts: ['127.0.0.1'] })).toBe('http://localhost:8787');
    expect(pairingUrl({ argv: [], port: '8787', lanIp, hosts: ['localhost', '::1'] })).toBe('http://localhost:8787');
  });

  it('uses the first entry that is neither loopback nor wildcard', () => {
    expect(pairingUrl({ argv: [], port: '8787', lanIp, hosts: ['127.0.0.1', '100.64.0.10', '100.64.0.11'] })).toBe('http://100.64.0.10:8787');
    expect(pairingUrl({ argv: [], port: '8787', lanIp, hosts: ['0.0.0.0', '100.64.0.10'] })).toBe('http://100.64.0.10:8787');
  });

  it('brackets an IPv6 address and escapes a zone id', () => {
    expect(pairingUrl({ argv: [], port: '8787', hosts: ['fd7a:115c:a1e0::1'] })).toBe('http://[fd7a:115c:a1e0::1]:8787');
    expect(pairingUrl({ argv: [], port: '8787', hosts: ['fe80::1%en0'] })).toBe('http://[fe80::1%25en0]:8787');
  });

  it('a wildcard (with loopback or alone) gives the first LAN address, as before', () => {
    expect(pairingUrl({ argv: [], port: '8787', lanIp, hosts: ['0.0.0.0'] })).toBe('http://192.0.2.10:8787');
    expect(pairingUrl({ argv: [], port: '8787', lanIp, hosts: ['127.0.0.1', '::'] })).toBe('http://192.0.2.10:8787');
    expect(pairingUrl({ argv: [], port: '8787', hosts: ['0.0.0.0'] })).toBe('http://localhost:8787');
  });

  it('an explicit --url still wins', () => {
    expect(pairingUrl({ argv: ['--url', 'http://bff.example:9000'], port: '8787', lanIp, hosts: ['127.0.0.1'] })).toBe('http://bff.example:9000');
  });
});

describe('pairingNotes', () => {
  const base = { port: '8787' };

  it('hints adb reverse when the link points at loopback', () => {
    const notes = pairingNotes({ ...base, argv: [], url: 'http://localhost:8787', hosts: ['127.0.0.1'] });
    expect(notes).toEqual([expect.stringContaining('adb reverse tcp:8787 tcp:8787')]);
  });

  it('is silent for a LAN or Tailscale link that BFF_HOST covers', () => {
    expect(pairingNotes({ ...base, argv: [], url: 'http://100.64.0.10:8787', hosts: ['127.0.0.1', '100.64.0.10'] })).toEqual([]);
    expect(pairingNotes({ ...base, argv: ['--url', 'http://192.0.2.10:8787'], url: 'http://192.0.2.10:8787', hosts: ['0.0.0.0'] })).toEqual([]);
  });

  it('warns when an explicit --url IP is not covered by BFF_HOST', () => {
    const notes = pairingNotes({ ...base, argv: ['--url', 'http://192.0.2.10:8787'], url: 'http://192.0.2.10:8787', hosts: ['127.0.0.1', '100.64.0.10'] });
    expect(notes).toEqual([expect.stringMatching(/^Warning:.*192\.0\.2\.10.*BFF_HOST/)]);
  });

  it('warns when --url is localhost but BFF_HOST has no loopback address', () => {
    const notes = pairingNotes({ ...base, argv: ['--url', 'http://localhost:8787'], url: 'http://localhost:8787', hosts: ['100.64.0.10'] });
    expect(notes.some((n) => n.startsWith('Warning:'))).toBe(true);
  });

  it('does not warn for a hostname it cannot resolve (Tailscale name, reverse proxy)', () => {
    expect(pairingNotes({ ...base, argv: ['--url', 'https://bff.example.ts.net'], url: 'https://bff.example.ts.net', hosts: ['127.0.0.1'] })).toEqual([]);
  });

  it('treats "::" as covering IPv4 too, and 0.0.0.0 as not covering IPv6', () => {
    expect(pairingNotes({ ...base, argv: ['--url', 'http://192.0.2.10:8787'], url: 'http://192.0.2.10:8787', hosts: ['::'] })).toEqual([]);
    expect(pairingNotes({ ...base, argv: ['--url', 'http://[fd7a::1]:8787'], url: 'http://[fd7a::1]:8787', hosts: ['0.0.0.0'] })).toHaveLength(1);
  });

  it('still hints adb reverse for an explicit loopback --url that BFF_HOST covers', () => {
    const notes = pairingNotes({ ...base, argv: ['--url', 'http://localhost:8787'], url: 'http://localhost:8787', hosts: ['127.0.0.1'] });
    expect(notes).toEqual([expect.stringContaining('adb reverse')]);
  });
});
