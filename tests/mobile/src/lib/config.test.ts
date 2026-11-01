import type { BotsResponse } from '@hermes-mobile/api';
import { cacheStorage, readRoster, writeRoster } from '@mobile/lib/cache';
import { clearConfig, loadConfig, saveConfig } from '@mobile/lib/config';

jest.mock('expo-secure-store', () => {
  const items = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => items.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void items.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void items.delete(k)),
  };
});

const roster: BotsResponse = { botModeEnabled: true, bots: [] };

beforeEach(async () => {
  cacheStorage().clearAll();
  await clearConfig();
});

describe('config and the local cache', () => {
  it('binds the cache to the BFF it pairs with', async () => {
    await saveConfig({ url: 'http://bff.local:8787/', token: 't' });
    writeRoster(roster, {});

    expect(readRoster()?.roster).toEqual(roster);
    expect(await loadConfig()).toEqual({ url: 'http://bff.local:8787', token: 't' });
  });

  it('keeps the cache when re-pairing with the same BFF (e.g. a new token)', async () => {
    await saveConfig({ url: 'http://bff.local:8787', token: 't' });
    writeRoster(roster, {});
    await saveConfig({ url: 'http://bff.local:8787/', token: 'new' });

    expect(readRoster()?.roster).toEqual(roster);
  });

  it('wipes the cache when pairing with a different BFF', async () => {
    await saveConfig({ url: 'http://bff.local:8787', token: 't' });
    writeRoster(roster, {});
    await saveConfig({ url: 'http://other.local:8787', token: 't' });

    expect(readRoster()).toBeNull();
  });

  it('wipes the cache on unpair', async () => {
    await saveConfig({ url: 'http://bff.local:8787', token: 't' });
    writeRoster(roster, {});
    await clearConfig();

    expect(readRoster()).toBeNull();
    expect(cacheStorage().getAllKeys()).toEqual([]);
  });

  it('keeps the device token out of the cache', async () => {
    await saveConfig({ url: 'http://bff.local:8787', token: 'super-secret-token' });
    writeRoster(roster, {});
    const dump = cacheStorage()
      .getAllKeys()
      .map((k) => cacheStorage().getString(k))
      .join('\n');

    expect(dump).not.toContain('super-secret-token');
  });
});
