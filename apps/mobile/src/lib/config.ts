import * as SecureStore from 'expo-secure-store';

export type BffConfig = { url: string; token: string };

const KEY = 'hermes-bff-config';

export async function loadConfig(): Promise<BffConfig | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as BffConfig) : null;
}

export async function saveConfig(config: BffConfig) {
  await SecureStore.setItemAsync(KEY, JSON.stringify({ ...config, url: config.url.replace(/\/$/, '') }));
}

export async function clearConfig() {
  await SecureStore.deleteItemAsync(KEY);
}
