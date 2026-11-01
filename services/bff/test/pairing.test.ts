import { describe, expect, it } from 'vitest';
import { pairingLink, pairingUrl } from '../src/pairing.ts';

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
});
