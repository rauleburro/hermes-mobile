// Dynamic Expo config. The static parts live in app.json; the app identifiers come from env vars
// so a fork can rebrand and rebuild without editing tracked files:
//
//   APP_NAME             display name                                  default "Hermes"
//   APP_SLUG             Expo slug                                     default "hermes-mobile"
//   APP_SCHEME           URL scheme of the pairing link                default "hermesmobile"
//   APP_BUNDLE_ID        iOS bundle identifier (reverse-DNS)           default "dev.rauleburro.hermesmobile"
//   APP_ANDROID_PACKAGE  Android application id (reverse-DNS)          default "dev.rauleburro.hermesmobile"
//
// Blank values count as unset. Invalid values throw, so a typo never produces a half-renamed build.
// The BFF reads the same APP_SCHEME (services/bff/.env) to print matching pairing links.
// This file is evaluated by the Expo CLI in plain Node: keep it free of app/workspace imports.
import type { ConfigContext, ExpoConfig } from 'expo/config';

type Env = Record<string, string | undefined>;

const DEFAULTS = {
  APP_NAME: 'Hermes',
  APP_SLUG: 'hermes-mobile',
  APP_SCHEME: 'hermesmobile',
  APP_BUNDLE_ID: 'dev.rauleburro.hermesmobile',
  APP_ANDROID_PACKAGE: 'dev.rauleburro.hermesmobile',
} as const;

type Name = keyof typeof DEFAULTS;

// Lowercase only: Android intent-filter schemes are case-sensitive. http(s) would hijack web links.
const isScheme = (v: string) => /^[a-z][a-z0-9+.-]*$/.test(v) && v !== 'http' && v !== 'https';
const isSlug = (v: string) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v);
// Reverse-DNS: at least two dot-separated segments, each starting with a letter.
const isBundleId = (v: string) => /^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z][A-Za-z0-9-]*)+$/.test(v);
const isAndroidPackage = (v: string) => /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(v);

const RULES: Partial<Record<Name, [(v: string) => boolean, string]>> = {
  APP_SLUG: [isSlug, 'letters, digits, "-" and "_", not starting with a symbol'],
  APP_SCHEME: [isScheme, 'a lowercase URI scheme (letters, digits, "+", "-", "."; starting with a letter; not http/https)'],
  APP_BUNDLE_ID: [isBundleId, 'a reverse-DNS id such as com.example.app (letters, digits, "-")'],
  APP_ANDROID_PACKAGE: [isAndroidPackage, 'a reverse-DNS package such as com.example.app (letters, digits, "_"; no "-")'],
};

export function identifiers(env: Env) {
  const errors: string[] = [];
  const read = (name: Name): string => {
    const value = env[name]?.trim() || DEFAULTS[name];
    const rule = RULES[name];
    if (rule && !rule[0](value)) errors.push(`${name}="${value}" is invalid: expected ${rule[1]}`);
    return value;
  };
  const result = {
    name: read('APP_NAME'),
    slug: read('APP_SLUG'),
    scheme: read('APP_SCHEME'),
    ios: { bundleIdentifier: read('APP_BUNDLE_ID') },
    android: { package: read('APP_ANDROID_PACKAGE') },
  };
  if (errors.length) throw new Error(`Invalid app identifiers:\n${errors.join('\n')}`);
  return result;
}

// Expo calls this with the static app.json config; `env` is only injectable for tests.
export default function appConfig({ config }: Pick<ConfigContext, 'config'>, env: Env = process.env): ExpoConfig {
  const id = identifiers(env);
  return {
    ...config,
    name: id.name,
    slug: id.slug,
    scheme: id.scheme,
    ios: { ...config.ios, ...id.ios },
    android: { ...config.android, ...id.android },
  };
}
