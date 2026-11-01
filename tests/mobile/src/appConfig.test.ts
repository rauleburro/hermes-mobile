// The Expo config (apps/mobile/app.config.ts) reads the app identifiers from env vars so a fork
// can rebrand without editing tracked files. Tests pass a plain env object, never process.env.
import appConfig, { identifiers } from '../../../apps/mobile/app.config';

describe('identifiers defaults', () => {
  it('keeps the official identifiers when no env var is set', () => {
    expect(identifiers({})).toEqual({
      name: 'Hermes',
      slug: 'hermes-mobile',
      scheme: 'hermesmobile',
      ios: { bundleIdentifier: 'dev.rauleburro.hermesmobile' },
      android: { package: 'dev.rauleburro.hermesmobile' },
    });
  });

  it('treats blank values as unset', () => {
    expect(identifiers({ APP_NAME: '  ', APP_SCHEME: '', APP_BUNDLE_ID: ' ' })).toEqual(identifiers({}));
  });
});

describe('identifiers overrides', () => {
  it('applies each env var to its field, trimmed', () => {
    expect(
      identifiers({
        APP_NAME: ' Fork Bots ',
        APP_SLUG: 'fork-bots',
        APP_SCHEME: 'forkbots',
        APP_BUNDLE_ID: 'com.example.forkbots',
        APP_ANDROID_PACKAGE: 'com.example.forkbots',
      }),
    ).toEqual({
      name: 'Fork Bots',
      slug: 'fork-bots',
      scheme: 'forkbots',
      ios: { bundleIdentifier: 'com.example.forkbots' },
      android: { package: 'com.example.forkbots' },
    });
  });

  it('lets the iOS and Android ids differ', () => {
    const result = identifiers({ APP_BUNDLE_ID: 'com.example.ios', APP_ANDROID_PACKAGE: 'com.example.droid' });
    expect(result.ios.bundleIdentifier).toBe('com.example.ios');
    expect(result.android.package).toBe('com.example.droid');
  });
});

describe('identifiers validation', () => {
  it.each(['Bad_Scheme', 'HermesMobile', '1scheme', 'has space', 'a://b', 'http', 'https'])(
    'rejects APP_SCHEME=%s',
    (scheme) => {
      expect(() => identifiers({ APP_SCHEME: scheme })).toThrow(/APP_SCHEME/);
    },
  );

  it.each(['forkbots', 'fork-bots', 'fork.bots', 'fork+bots', 'a1'])('accepts APP_SCHEME=%s', (scheme) => {
    expect(identifiers({ APP_SCHEME: scheme }).scheme).toBe(scheme);
  });

  it.each(['hermes', 'com.', '.com.example', 'com..example', 'com.1example', 'com.exa_mple', 'com.exa mple'])(
    'rejects APP_BUNDLE_ID=%s (not reverse-DNS)',
    (id) => {
      expect(() => identifiers({ APP_BUNDLE_ID: id })).toThrow(/APP_BUNDLE_ID/);
    },
  );

  it('accepts hyphens in the iOS bundle id but not in the Android package', () => {
    expect(identifiers({ APP_BUNDLE_ID: 'com.my-fork.app' }).ios.bundleIdentifier).toBe('com.my-fork.app');
    expect(() => identifiers({ APP_ANDROID_PACKAGE: 'com.my-fork.app' })).toThrow(/APP_ANDROID_PACKAGE/);
  });

  it.each(['hermes', 'com.', 'com.1example', 'com.my-fork', 'com.exa mple', 'com..example'])(
    'rejects APP_ANDROID_PACKAGE=%s',
    (id) => {
      expect(() => identifiers({ APP_ANDROID_PACKAGE: id })).toThrow(/APP_ANDROID_PACKAGE/);
    },
  );

  it('accepts underscores in the Android package', () => {
    expect(identifiers({ APP_ANDROID_PACKAGE: 'com.my_fork.app' }).android.package).toBe('com.my_fork.app');
  });

  it.each(['Has Space', 'a/b', '-lead'])('rejects APP_SLUG=%j', (slug) => {
    expect(() => identifiers({ APP_SLUG: slug })).toThrow(/APP_SLUG/);
  });

  it('reports every invalid variable at once, with the bad value', () => {
    expect(() => identifiers({ APP_SCHEME: 'Bad_Scheme', APP_BUNDLE_ID: 'nope' })).toThrow(
      /APP_SCHEME.*"Bad_Scheme"[\s\S]*APP_BUNDLE_ID.*"nope"/,
    );
  });
});

describe('app.config default export', () => {
  const base = {
    name: 'static',
    slug: 'static',
    version: '1.0.0',
    ios: { icon: './icon' },
    android: { predictiveBackGestureEnabled: false },
  };

  it('merges the identifiers into the static config without losing other fields', () => {
    const result = appConfig({ config: base }, { APP_SCHEME: 'forkbots', APP_ANDROID_PACKAGE: 'com.example.forkbots' });
    expect(result).toMatchObject({
      version: '1.0.0',
      name: 'Hermes',
      scheme: 'forkbots',
      ios: { icon: './icon', bundleIdentifier: 'dev.rauleburro.hermesmobile' },
      android: { predictiveBackGestureEnabled: false, package: 'com.example.forkbots' },
    });
  });
});
