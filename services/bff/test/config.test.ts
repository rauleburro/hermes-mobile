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

  it('lowercases localhost and canonicalises IPv6 before comparing, so spelling variants are one address', () => {
    expect(parseHosts('LocalHost')).toEqual(['localhost']);
    expect(parseHosts('FD7A:115C:A1E0::1')).toEqual(['fd7a:115c:a1e0::1']);
    expect(parseHosts('0:0:0:0:0:0:0:1')).toEqual(['::1']);
    expect(parseHosts('localhost,LOCALHOST,::1,0:0:0:0:0:0:0:1,::01')).toEqual(['localhost', '::1']);
  });

  it('keeps a zone id on a link-local address', () => {
    expect(parseHosts('FE80::1%en0')).toEqual(['fe80::1%en0']);
  });

  it('rejects "::" together with 0.0.0.0 because "::" already listens on IPv4 (dual-stack)', () => {
    expect(() => parseHosts('0.0.0.0,::')).toThrow(/BFF_HOST.*"::".*"0\.0\.0\.0".*dual-stack/);
    expect(() => parseHosts(':: , 0.0.0.0')).toThrow(/dual-stack/);
    expect(() => parseHosts('0:0:0:0:0:0:0:0,0.0.0.0')).toThrow(/dual-stack/);
    expect(parseHosts('::,127.0.0.1')).toEqual(['::', '127.0.0.1']);
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
