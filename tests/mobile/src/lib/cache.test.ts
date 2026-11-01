import type { BotsResponse, SessionMessage } from '@hermes-mobile/api';
import {
  bindCache,
  cacheOwner,
  CACHE_SCHEMA_VERSION,
  CHAT_CACHE_LIMIT,
  cacheStorage,
  clearCache,
  readChat,
  readRoster,
  writeChat,
  writeRoster,
} from '@mobile/lib/cache';

const BFF = 'http://bff.local:8787';
const OTHER_BFF = 'http://other.local:8787';

const roster: BotsResponse = {
  botModeEnabled: true,
  bots: [{ id: 'default', name: 'Hermes', title: null, description: null, reachable: true }],
};

const msg = (i: number): SessionMessage => ({ role: i % 2 ? 'assistant' : 'user', content: `line ${i}` });

beforeEach(() => {
  cacheStorage().clearAll();
});

describe('cache', () => {
  it('reads nothing before it is bound to a BFF', () => {
    writeRoster(roster, {});
    writeChat('default', 'chat-default', [msg(1)]);

    expect(readRoster()).toBeNull();
    expect(readChat('default')).toBeNull();
  });

  it('round-trips the roster with its previews once bound', () => {
    bindCache(BFF);
    writeRoster(roster, { default: 'pong' });

    expect(readRoster()).toEqual({ roster, previews: { default: 'pong' }, savedAt: expect.any(Number) });
  });

  it("keeps only each Bot Chat's last messages, per Bot", () => {
    bindCache(BFF);
    const many = Array.from({ length: CHAT_CACHE_LIMIT + 10 }, (_, i) => msg(i));
    writeChat('default', 'chat-default', many);
    writeChat('researcher', 'chat-researcher', [msg(1)]);

    const cached = readChat('default');
    expect(cached?.sessionId).toBe('chat-default');
    expect(cached?.messages).toHaveLength(CHAT_CACHE_LIMIT);
    expect(cached?.messages.at(-1)).toEqual(many.at(-1));
    expect(readChat('researcher')?.messages).toEqual([msg(1)]);
  });

  it('reports which BFF it belongs to', () => {
    expect(cacheOwner()).toBeNull();
    bindCache(BFF);
    expect(cacheOwner()).toBe(BFF);
    clearCache();
    expect(cacheOwner()).toBeNull();
  });

  it('keeps the cache when re-bound to the same BFF', () => {
    bindCache(BFF);
    writeRoster(roster, {});
    bindCache(BFF);

    expect(readRoster()?.roster).toEqual(roster);
  });

  it('wipes everything when bound to a different BFF', () => {
    bindCache(BFF);
    writeRoster(roster, {});
    writeChat('default', 'chat-default', [msg(1)]);

    bindCache(OTHER_BFF);

    expect(readRoster()).toBeNull();
    expect(readChat('default')).toBeNull();
  });

  it('wipes everything and unbinds on clearCache (unpair)', () => {
    bindCache(BFF);
    writeRoster(roster, {});
    clearCache();

    expect(cacheStorage().getAllKeys()).toEqual([]);
    writeRoster(roster, {});
    expect(readRoster()).toBeNull();
  });

  it('discards a cache written with another schema version', () => {
    bindCache(BFF);
    writeRoster(roster, {});
    const meta = JSON.parse(cacheStorage().getString('meta')!);
    cacheStorage().set('meta', JSON.stringify({ ...meta, v: CACHE_SCHEMA_VERSION - 1 }));

    expect(readRoster()).toBeNull();
    expect(cacheStorage().getAllKeys()).toEqual([]);
  });

  it('drops a single entry from another schema version', () => {
    bindCache(BFF);
    writeRoster(roster, {});
    const entry = JSON.parse(cacheStorage().getString('roster')!);
    cacheStorage().set('roster', JSON.stringify({ ...entry, v: CACHE_SCHEMA_VERSION + 1 }));

    expect(readRoster()).toBeNull();
    expect(cacheStorage().contains('roster')).toBe(false);
  });

  it('treats corrupt entries as missing and removes them', () => {
    bindCache(BFF);
    cacheStorage().set('roster', '{not json');
    cacheStorage().set('chat:default', JSON.stringify({ v: CACHE_SCHEMA_VERSION, savedAt: 1, data: { messages: 'nope' } }));

    expect(readRoster()).toBeNull();
    expect(readChat('default')).toBeNull();
    expect(cacheStorage().contains('roster')).toBe(false);
    expect(cacheStorage().contains('chat:default')).toBe(false);
  });

  it('survives a corrupt meta entry by starting over', () => {
    cacheStorage().set('meta', 'garbage');

    expect(readRoster()).toBeNull();
    bindCache(BFF);
    writeRoster(roster, {});
    expect(readRoster()?.roster).toEqual(roster);
  });

  it('never stores the device token or the BFF URL in entries', () => {
    bindCache(BFF);
    writeRoster(roster, {});
    writeChat('default', 'chat-default', [msg(1)]);
    const dump = cacheStorage()
      .getAllKeys()
      .filter((k) => k !== 'meta')
      .map((k) => cacheStorage().getString(k))
      .join('\n');

    expect(dump).not.toContain('token');
    expect(dump).not.toContain(BFF);
  });
});
