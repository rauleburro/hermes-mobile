import type { BotsResponse, SessionMessage } from '@hermes-mobile/api';
import { createMMKV, type MMKV } from 'react-native-mmkv';

/**
 * Local cache for an instant first paint: the Bots roster (with previews) and each Bot Chat's
 * last messages, saved per paired BFF. Reads are synchronous so screens can render cached data
 * in their first frame, then refresh from the BFF.
 *
 * Hygiene: holds no secrets (the device token stays in expo-secure-store). The `meta` entry
 * records the schema version and which BFF the data belongs to; binding to another BFF, unpairing
 * or a schema bump wipes everything. Corrupt or mismatched entries read as missing and are removed.
 */

/** Bump when the shape of any entry changes: older caches are discarded, never migrated. */
export const CACHE_SCHEMA_VERSION = 1;
/** Messages kept per Bot Chat. */
export const CHAT_CACHE_LIMIT = 50;

export type CachedRoster = { roster: BotsResponse; previews: Record<string, string>; savedAt: number };
export type CachedChat = { sessionId: string; messages: SessionMessage[]; savedAt: number };

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

/**
 * Ties the cache to the paired BFF. Same BFF: keeps the cache. Different BFF (or none yet):
 * wipes it and starts a fresh one for `bffUrl`.
 */
export function bindCache(bffUrl: string) {
  if (readMeta()?.owner === bffUrl) return;
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

function read<T>(key: string, valid: (data: unknown) => data is T): (T & { savedAt: number }) | null {
  if (!readMeta()) return null;
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

function write<T>(key: string, data: T) {
  if (!readMeta()) return; // Unbound: never cache data we can't attribute to a BFF.
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

export const readRoster = (): CachedRoster | null => read(ROSTER, isRoster);

/** Saves a roster fetched live from the BFF, with the previews known so far. */
export function writeRoster(roster: BotsResponse, previews: Record<string, string | undefined>) {
  const known = Object.fromEntries(Object.entries(previews).filter(([, p]) => typeof p === 'string')) as Record<
    string,
    string
  >;
  write(ROSTER, { roster, previews: known });
}

export const readChat = (botId: string): CachedChat | null => read(chatKey(botId), isChat);

/** Saves the last CHAT_CACHE_LIMIT messages of a Bot Chat fetched live from the BFF. */
export function writeChat(botId: string, sessionId: string, messages: SessionMessage[]) {
  write(chatKey(botId), { sessionId, messages: messages.slice(-CHAT_CACHE_LIMIT) });
}

/** Forgets one Bot Chat (e.g. the BFF says it no longer exists). */
export function dropChat(botId: string) {
  cacheStorage().remove(chatKey(botId));
}
