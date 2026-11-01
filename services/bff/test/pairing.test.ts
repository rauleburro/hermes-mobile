import { describe, expect, it } from 'vitest';
import { appScheme, pairingLink, pairingUrl } from '../src/pairing.ts';

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
