import { normalizeBffUrl, parsePairParams } from '@mobile/lib/pairing';

describe('normalizeBffUrl', () => {
  it('trims and drops trailing slashes', () => {
    expect(normalizeBffUrl('  http://bff.local:8787/  ')).toBe('http://bff.local:8787');
    expect(normalizeBffUrl('https://bff.example.ts.net//')).toBe('https://bff.example.ts.net');
  });

  it('keeps a path prefix', () => {
    expect(normalizeBffUrl('https://host.example/bff/')).toBe('https://host.example/bff');
  });

  it('rejects anything that is not an http(s) URL', () => {
    expect(normalizeBffUrl('not a url')).toBeNull();
    expect(normalizeBffUrl('ftp://bff.local')).toBeNull();
    expect(normalizeBffUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeBffUrl('')).toBeNull();
  });
});

describe('parsePairParams', () => {
  it('returns nothing for a plain visit (no link)', () => {
    expect(parsePairParams({})).toEqual({});
  });

  it('reads url and token from the pairing link', () => {
    expect(parsePairParams({ url: 'http://localhost:8787/', token: 'secret' })).toEqual({
      url: 'http://localhost:8787',
      token: 'secret',
    });
  });

  it('uses the first value when a param is repeated', () => {
    expect(parsePairParams({ url: ['http://a.local:1', 'http://b.local:2'], token: ['one', 'two'] })).toEqual({
      url: 'http://a.local:1',
      token: 'one',
    });
  });

  it('ignores blank params', () => {
    expect(parsePairParams({ url: '  ', token: '' })).toEqual({});
  });

  it('reports a malformed url instead of using it', () => {
    expect(parsePairParams({ url: 'javascript:alert(1)', token: 'secret' })).toEqual({
      token: 'secret',
      error: 'The pairing link has an invalid BFF URL.',
    });
  });
});
