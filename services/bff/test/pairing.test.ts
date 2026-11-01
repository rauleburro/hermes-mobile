import { describe, expect, it, vi } from 'vitest';
import { appScheme, pairingLink, pairingUrl, preparePairing, resolveAppScheme } from '../src/pairing.ts';

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
