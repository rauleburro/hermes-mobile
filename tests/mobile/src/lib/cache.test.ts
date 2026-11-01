import type { BotsResponse, SessionMessage } from '@hermes-mobile/api';
import { BffError } from '@mobile/lib/bff';
import {
  bindCache,
  cacheOwner,
  CACHE_SCHEMA_VERSION,
  CHAT_CACHE_LIMIT,
  cacheStorage,
  clearCache,
  readChat,
  readRoster,
  savedDataHint,
  writeChat,
  writeRoster,
} from '@mobile/lib/cache';

const BFF = 'http://bff.local:8787';
const OTHER_BFF = 'http://other.local:8787';

const roster: BotsResponse = {
  botModeEnabled: true,
  bots: [{ id: 'default', name: 'Hermes', title: null, description: null, reachable: true }],
};

const msg = (i: number): SessionMessage => ({ id: i, role: i % 2 ? 'assistant' : 'user', content: `line ${i}` });

beforeEach(() => {
  cacheStorage().clearAll();
});

describe('cache', () => {
  it('reads nothing before it is bound to a BFF', () => {
    writeRoster(BFF, roster, {});
    writeChat(BFF, 'default', 'chat-default', [msg(1)]);

    expect(readRoster(BFF)).toBeNull();
    expect(readChat(BFF, 'default')).toBeNull();
  });

  it('round-trips the roster with its previews once bound', () => {
    bindCache(BFF);
    writeRoster(BFF, roster, { default: 'pong' });

    expect(readRoster(BFF)).toEqual({ roster, previews: { default: 'pong' }, savedAt: expect.any(Number) });
  });

  it('refuses a write fetched from another BFF than the one it is bound to', () => {
    bindCache(OTHER_BFF);
    writeRoster(BFF, roster, {});
    writeChat(BFF, 'default', 'chat-default', [msg(1)]);

    expect(cacheStorage().getAllKeys()).toEqual(['meta']);
  });

  it('reads nothing for a BFF other than the one it is bound to', () => {
    bindCache(BFF);
    writeRoster(BFF, roster, {});
    writeChat(BFF, 'default', 'chat-default', [msg(1)]);

    expect(readRoster(OTHER_BFF)).toBeNull();
    expect(readRoster(null)).toBeNull();
    expect(readChat(OTHER_BFF, 'default')).toBeNull();
    expect(readRoster(BFF)?.roster).toEqual(roster);
  });

  it("keeps only each Bot Chat's last messages, per Bot", () => {
    bindCache(BFF);
    const many = Array.from({ length: CHAT_CACHE_LIMIT + 10 }, (_, i) => msg(i));
    writeChat(BFF, 'default', 'chat-default', many);
    writeChat(BFF, 'researcher', 'chat-researcher', [msg(1)]);

    const cached = readChat(BFF, 'default');
    expect(cached?.sessionId).toBe('chat-default');
    expect(cached?.messages).toHaveLength(CHAT_CACHE_LIMIT);
    expect(cached?.messages.at(-1)).toEqual(many.at(-1));
    expect(readChat(BFF, 'researcher')?.messages).toEqual([msg(1)]);
  });

  it('keeps only user and assistant text, reduced to id, role and content, before counting the last messages', () => {
    bindCache(BFF);
    const chat: SessionMessage[] = [
      { id: 1, role: 'user', content: 'question', tool_calls: [{ id: 'c1' }], timestamp: 5 } as SessionMessage,
      ...Array.from({ length: CHAT_CACHE_LIMIT }, (_, i) => ({ id: 100 + i, role: 'tool' as const, content: 'file contents' })),
      { id: 2, role: 'system', content: 'system prompt' },
      { id: 3, role: 'assistant', content: '' },
      { id: 4, role: 'assistant', content: 'answer' },
    ];
    writeChat(BFF, 'default', 'chat-default', chat);

    expect(readChat(BFF, 'default')?.messages).toEqual([
      { id: 1, role: 'user', content: 'question' },
      { id: 4, role: 'assistant', content: 'answer' },
    ]);
    expect(cacheStorage().getString('chat:default')).not.toContain('file contents');
  });

  it('never saves hidden rows, so the saved copy shows what the live view shows', () => {
    bindCache(BFF);
    const chat: SessionMessage[] = [
      { id: 1, role: 'user', content: 'goal control', display_kind: 'hidden' },
      { id: 2, role: 'user', content: 'question', display_kind: 'internal_notification' },
      { id: 3, role: 'assistant', content: 'held turn', display_kind: 'hidden' },
      { id: 4, role: 'assistant', content: 'answer' },
    ];
    writeChat(BFF, 'default', 'chat-default', chat);

    expect(readChat(BFF, 'default')?.messages).toEqual([
      { id: 2, role: 'user', content: 'question' },
      { id: 4, role: 'assistant', content: 'answer' },
    ]);
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
    writeRoster(BFF, roster, {});
    bindCache(BFF);

    expect(readRoster(BFF)?.roster).toEqual(roster);
  });

  it('wipes everything when bound to a different BFF', () => {
    bindCache(BFF);
    writeRoster(BFF, roster, {});
    writeChat(BFF, 'default', 'chat-default', [msg(1)]);

    bindCache(OTHER_BFF);

    expect(readRoster(OTHER_BFF)).toBeNull();
    expect(readChat(OTHER_BFF, 'default')).toBeNull();
    expect(cacheStorage().getAllKeys()).toEqual(['meta']);
  });

  it('wipes everything and unbinds on clearCache (unpair)', () => {
    bindCache(BFF);
    writeRoster(BFF, roster, {});
    clearCache();

    expect(cacheStorage().getAllKeys()).toEqual([]);
    writeRoster(BFF, roster, {});
    expect(readRoster(BFF)).toBeNull();
  });

  it('discards a cache written with another schema version', () => {
    bindCache(BFF);
    writeRoster(BFF, roster, {});
    const meta = JSON.parse(cacheStorage().getString('meta')!);
    cacheStorage().set('meta', JSON.stringify({ ...meta, v: CACHE_SCHEMA_VERSION - 1 }));

    expect(readRoster(BFF)).toBeNull();
    expect(cacheStorage().getAllKeys()).toEqual([]);
  });

  it('drops a single entry from another schema version', () => {
    bindCache(BFF);
    writeRoster(BFF, roster, {});
    const entry = JSON.parse(cacheStorage().getString('roster')!);
    cacheStorage().set('roster', JSON.stringify({ ...entry, v: CACHE_SCHEMA_VERSION + 1 }));

    expect(readRoster(BFF)).toBeNull();
    expect(cacheStorage().contains('roster')).toBe(false);
  });

  it('treats corrupt entries as missing and removes them', () => {
    bindCache(BFF);
    cacheStorage().set('roster', '{not json');
    cacheStorage().set('chat:default', JSON.stringify({ v: CACHE_SCHEMA_VERSION, savedAt: 1, data: { messages: 'nope' } }));

    expect(readRoster(BFF)).toBeNull();
    expect(readChat(BFF, 'default')).toBeNull();
    expect(cacheStorage().contains('roster')).toBe(false);
    expect(cacheStorage().contains('chat:default')).toBe(false);
  });

  it('survives a corrupt meta entry by starting over', () => {
    cacheStorage().set('meta', 'garbage');

    expect(readRoster(BFF)).toBeNull();
    bindCache(BFF);
    writeRoster(BFF, roster, {});
    expect(readRoster(BFF)?.roster).toEqual(roster);
  });

  it('never stores the device token or the BFF URL in entries', () => {
    bindCache(BFF);
    writeRoster(BFF, roster, {});
    writeChat(BFF, 'default', 'chat-default', [msg(1)]);
    const dump = cacheStorage()
      .getAllKeys()
      .filter((k) => k !== 'meta')
      .map((k) => cacheStorage().getString(k))
      .join('\n');

    expect(dump).not.toContain('token');
    expect(dump).not.toContain(BFF);
  });
});

describe('savedDataHint', () => {
  it('says offline only when the BFF could not be reached', () => {
    expect(savedDataHint(new TypeError('Network request failed'), 'data')).toBe('Offline · showing saved data');
    expect(savedDataHint(new Error('fetch failed'), 'messages')).toBe('Offline · showing saved messages');
  });

  it('shows the BFF error when it answered with one', () => {
    expect(savedDataHint(new BffError('GET /bots failed (401)', 401), 'data')).toBe(
      'GET /bots failed (401) · showing saved data',
    );
  });
});
