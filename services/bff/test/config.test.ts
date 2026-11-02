import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, parseHosts } from '../src/config.ts';

describe('parseHosts', () => {
  it('defaults to 0.0.0.0 when unset, empty or only blanks (backwards compatible)', () => {
    expect(parseHosts(undefined)).toEqual(['0.0.0.0']);
    expect(parseHosts('')).toEqual(['0.0.0.0']);
    expect(parseHosts(' , ,')).toEqual(['0.0.0.0']);
  });

  it('accepts a single address', () => {
    expect(parseHosts('127.0.0.1')).toEqual(['127.0.0.1']);
  });

  it('accepts a comma-separated list, trimming entries and ignoring blank ones', () => {
    expect(parseHosts(' 127.0.0.1 , 100.64.0.10,, ')).toEqual(['127.0.0.1', '100.64.0.10']);
  });

  it('accepts IPv6 literals and localhost', () => {
    expect(parseHosts('::1,localhost,fd7a:115c:a1e0::1')).toEqual(['::1', 'localhost', 'fd7a:115c:a1e0::1']);
  });

  it('drops repeated entries so the same address is never bound twice', () => {
    expect(parseHosts('127.0.0.1,100.64.0.10,127.0.0.1')).toEqual(['127.0.0.1', '100.64.0.10']);
  });

  it.each(['example.com', '300.1.1.1', '127.0.0.1:8787', '[::1]', 'http://127.0.0.1'])(
    'rejects %s, naming the bad entry',
    (bad) => {
      expect(() => parseHosts(`127.0.0.1,${bad}`)).toThrow(`BFF_HOST has an invalid entry "${bad}"`);
    },
  );
});

describe('loadConfig hosts', () => {
  afterEach(() => vi.unstubAllEnvs());

  const stubRequired = () => {
    vi.stubEnv('HERMES_API_KEY', 'k');
    vi.stubEnv('DEVICE_TOKEN', 't');
  };

  it('exposes the parsed list as hosts', () => {
    stubRequired();
    vi.stubEnv('BFF_HOST', '127.0.0.1, 100.64.0.10');
    expect(loadConfig().hosts).toEqual(['127.0.0.1', '100.64.0.10']);
  });

  it('fails at startup on an invalid BFF_HOST', () => {
    stubRequired();
    vi.stubEnv('BFF_HOST', '127.0.0.1,nope.example');
    expect(() => loadConfig()).toThrow(/BFF_HOST.*"nope\.example"/);
  });
});
