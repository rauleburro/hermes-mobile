import type { BotsResponse, SessionMessage } from '@hermes-mobile/api';
import { createMMKV, type MMKV } from 'react-native-mmkv';

/**
 * Local cache for an instant first paint: the Bots roster (with previews) and each Bot Chat's
 * last messages, saved per paired BFF. Reads are synchronous so screens can render cached data
 * in their first frame, then refresh from the BFF.
 *
 * Every read and write names the BFF it is for: the cache only answers for, and only accepts data
 * fetched from, the BFF it is bound to. So a fetch that lands after re-pairing never ends up in the
 * new BFF's cache, and a cache from another pairing never paints.
 *
 * Hygiene: holds no secrets (the device token stays in expo-secure-store) and only chat text
 * (user and assistant lines; no tool output). The `meta` entry records the schema version and the
 * owning BFF; binding to another BFF, unpairing or a schema bump wipes everything. Corrupt or
 * mismatched entries read as missing and are removed.
 */

/** Bump when the shape of any entry changes: older caches are discarded, never migrated. */
export const CACHE_SCHEMA_VERSION = 2;
/** Chat lines (user and assistant) kept per Bot Chat. */
export const CHAT_CACHE_LIMIT = 50;

export type CachedMessage = Pick<SessionMessage, 'id' | 'role' | 'content'>;
export type CachedRoster = { roster: BotsResponse; previews: Record<string, string>; savedAt: number };
export type CachedChat = { sessionId: string; messages: CachedMessage[]; savedAt: number };

type Meta = { v: number; owner: string };
type Entry<T> = { v: number; savedAt: number; data: T };

const META = 'meta';
const ROSTER = 'roster';
const chatKey = (botId: string) => `chat:${botId}`;

let storage: MMKV | null = null;

/** The underlying MMKV instance (exported for tests). */
export function cacheStorage(): MMKV {
  storage ??= createMMKV({ id: 'hermes-cache' });
  return storage;
}

function parse(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/** The current meta, or null when unbound. Wipes the store when it's corrupt or from another schema. */
function readMeta(): Meta | null {
  const store = cacheStorage();
  if (!store.contains(META)) return null;
  const meta = parse(store.getString(META));
  if (isObject(meta) && meta.v === CACHE_SCHEMA_VERSION && typeof meta.owner === 'string') {
    return { v: meta.v, owner: meta.owner };
  }
  store.clearAll();
  return null;
}

/** True when the cache is bound to exactly this BFF. */
const ownedBy = (bffUrl: string | null) => bffUrl !== null && readMeta()?.owner === bffUrl;

/**
 * Ties the cache to the paired BFF. Same BFF: keeps the cache. Different BFF (or none yet):
 * wipes it and starts a fresh one for `bffUrl`.
 */
export function bindCache(bffUrl: string) {
  if (ownedBy(bffUrl)) return;
  const store = cacheStorage();
  store.clearAll();
  store.set(META, JSON.stringify({ v: CACHE_SCHEMA_VERSION, owner: bffUrl } satisfies Meta));
}

/** The BFF URL the cache belongs to, or null when unbound. */
export const cacheOwner = (): string | null => readMeta()?.owner ?? null;

/** Wipes everything and unbinds (unpair). */
export function clearCache() {
  cacheStorage().clearAll();
}

function read<T>(bffUrl: string | null, key: string, valid: (data: unknown) => data is T): (T & { savedAt: number }) | null {
  if (!ownedBy(bffUrl)) return null;
  const store = cacheStorage();
  const entry = parse(store.getString(key));
  if (entry === undefined && !store.contains(key)) return null;
  if (
    isObject(entry) &&
    entry.v === CACHE_SCHEMA_VERSION &&
    typeof entry.savedAt === 'number' &&
    valid(entry.data)
  ) {
    return { ...entry.data, savedAt: entry.savedAt };
  }
  store.remove(key);
  return null;
}

/** Saves data fetched from `bffUrl`, only if the cache still belongs to that BFF. */
function write<T>(bffUrl: string, key: string, data: T) {
  if (!ownedBy(bffUrl)) return;
  cacheStorage().set(key, JSON.stringify({ v: CACHE_SCHEMA_VERSION, savedAt: Date.now(), data } satisfies Entry<T>));
}

const isRoster = (d: unknown): d is Omit<CachedRoster, 'savedAt'> =>
  isObject(d) &&
  isObject(d.roster) &&
  typeof d.roster.botModeEnabled === 'boolean' &&
  Array.isArray(d.roster.bots) &&
  isObject(d.previews);

const isChat = (d: unknown): d is Omit<CachedChat, 'savedAt'> =>
  isObject(d) && typeof d.sessionId === 'string' && Array.isArray(d.messages);

/** The saved roster of `bffUrl` (the paired BFF), or null. */
export const readRoster = (bffUrl: string | null): CachedRoster | null => read(bffUrl, ROSTER, isRoster);

/** Saves a roster fetched from `bffUrl`, with the previews known so far. */
export function writeRoster(bffUrl: string, roster: BotsResponse, previews: Record<string, string | undefined>) {
  const known = Object.fromEntries(Object.entries(previews).filter(([, p]) => typeof p === 'string')) as Record<
    string,
    string
  >;
  write(bffUrl, ROSTER, { roster, previews: known });
}

/** The saved Bot Chat of `botId` on `bffUrl` (the paired BFF), or null. */
export const readChat = (bffUrl: string | null, botId: string): CachedChat | null =>
  read(bffUrl, chatKey(botId), isChat);

/**
 * Saves the last CHAT_CACHE_LIMIT chat lines (user and assistant text only) of a Bot Chat fetched
 * from `bffUrl`. Hidden rows are skipped, as in the live view: the saved copy drops `display_kind`.
 */
export function writeChat(bffUrl: string, botId: string, sessionId: string, messages: SessionMessage[]) {
  const lines: CachedMessage[] = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content && m.display_kind !== 'hidden')
    .map(({ id, role, content }) => ({ id, role, content }))
    .slice(-CHAT_CACHE_LIMIT);
  write(bffUrl, chatKey(botId), { sessionId, messages: lines });
}

/** Forgets one Bot Chat (e.g. the BFF says it no longer exists). */
export function dropChat(botId: string) {
  cacheStorage().remove(chatKey(botId));
}

/**
 * The hint shown next to saved data when a refresh failed: "Offline" only when the BFF couldn't
 * be reached; when it answered with an error (a BffError carries its status), that error.
 */
export function savedDataHint(error: unknown, what: 'data' | 'messages'): string {
  const status = isObject(error) ? error.status : undefined;
  const reason = typeof status === 'number' && error instanceof Error ? error.message : 'Offline';
  return `${reason} · showing saved ${what}`;
}
