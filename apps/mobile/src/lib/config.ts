import * as SecureStore from 'expo-secure-store';
import { bindCache, clearCache } from './cache';

export type BffConfig = { url: string; token: string };

const KEY = 'hermes-bff-config';

export async function loadConfig(): Promise<BffConfig | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as BffConfig) : null;
}

/** Stores the pairing (the token only in secure storage) and binds the local cache to this BFF. */
export async function saveConfig(config: BffConfig) {
  const url = config.url.replace(/\/$/, '');
  await SecureStore.setItemAsync(KEY, JSON.stringify({ ...config, url }));
  bindCache(url); // A different BFF wipes the previous one's cached roster and chats.
}

/** Unpairs: forgets the pairing and wipes the local cache. */
export async function clearConfig() {
  await SecureStore.deleteItemAsync(KEY);
  clearCache();
}
