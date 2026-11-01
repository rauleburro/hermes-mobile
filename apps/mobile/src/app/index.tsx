import type { BotSummary, BotsResponse } from '@hermes-mobile/api';
import { router, Stack, useFocusEffect, useTheme } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { BotAvatar } from '@/components/BotAvatar';
import { BotModeDisabled } from '@/components/BotModeDisabled';
import { BffError, getBotChat, getBotMessages, listBots } from '@/lib/bff';
import { lastMessagePreview } from '@/lib/bots';
import { bindCache, readRoster, savedDataHint, writeRoster } from '@/lib/cache';
import { loadConfig, pairedUrl } from '@/lib/config';

const NO_BOT_CHAT = 'No Bot Chat yet';

/** Last line of a Bot's Bot Chat, or why there isn't one. Undefined when it couldn't be read. */
async function loadPreview(botId: string): Promise<string | undefined> {
  try {
    const { sessionId } = await getBotChat(botId);
    return lastMessagePreview(await getBotMessages(botId, sessionId)) ?? 'No messages yet';
  } catch (e) {
    return e instanceof BffError && e.code === 'bot_chat_missing' ? NO_BOT_CHAT : undefined;
  }
}

export default function HomeScreen() {
  const { colors } = useTheme();
  // First paint comes from the paired BFF's saved roster (synchronous), then the BFF replaces it.
  const [initial] = useState(() => {
    const url = pairedUrl();
    const saved = readRoster(url);
    return { saved, owner: saved ? url : null };
  });
  const [roster, setRoster] = useState<BotsResponse | null>(initial.saved?.roster ?? null);
  const [previews, setPreviews] = useState<Record<string, string | undefined>>(initial.saved?.previews ?? {});
  /** The BFF the roster on screen came from; set together with the roster, so a save never mislabels it. */
  const [rosterOwner, setRosterOwner] = useState<string | null>(initial.owner);
  /** True while the roster on screen is the saved copy, not a fresh answer from the BFF. */
  const [fromCache, setFromCache] = useState(initial.saved !== null);
  /** The BFF the last refresh asked, to notice a re-pairing. */
  const owner = useRef(initial.owner);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Why the saved roster is on screen after a failed refresh ("Offline", or the BFF's error). */
  const [savedHint, setSavedHint] = useState<string | null>(null);
  // Each refresh bumps this; previews from an older refresh are dropped when they land.
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const config = await loadConfig();
    if (!config) {
      router.push('/pair');
      return;
    }
    const url = config.url;
    bindCache(url);
    if (owner.current !== null && owner.current !== url) {
      // Paired with another BFF since this roster was loaded: never show its data.
      setRoster(null);
      setRosterOwner(null);
      setPreviews({});
      setFromCache(false);
    }
    owner.current = url;
    const current = ++generation.current;
    setLoading(true);
    try {
      const next = await listBots();
      if (current !== generation.current) return;
      setRoster(next);
      setRosterOwner(url);
      setFromCache(false);
      setError(null);
      // Previews fill in after the roster renders; one failing Bot never blanks the list.
      next.bots
        .filter((b) => b.reachable)
        .forEach((b) =>
          loadPreview(b.id).then((p) => {
            if (current === generation.current) setPreviews((prev) => ({ ...prev, [b.id]: p }));
          }),
        );
    } catch (e) {
      if (current === generation.current) {
        setError((e as Error).message);
        setSavedHint(savedDataHint(e, 'data'));
      }
    } finally {
      // Only the latest refresh owns the spinner.
      if (current === generation.current) setLoading(false);
    }
  }, []);

  // Only fresh data is saved, under the BFF it came from: a failed refresh never overwrites the
  // cache, and a fetch that lands after re-pairing is refused by the new BFF's cache.
  useEffect(() => {
    if (roster && rosterOwner && !fromCache) writeRoster(rosterOwner, roster, previews);
  }, [roster, rosterOwner, previews, fromCache]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const header = (
    <Stack.Screen options={{ headerLeft: () => <Button title="Pair" onPress={() => router.push('/pair')} /> }} />
  );

  if (roster && !roster.botModeEnabled) {
    return (
      <>
        {header}
        <BotModeDisabled onRetry={refresh} error={error} />
      </>
    );
  }

  const renderBot = ({ item }: { item: BotSummary }) => {
    const subtitle = item.reachable ? previews[item.id] : 'Unreachable: the BFF has no API key for this Bot';
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[item.name, item.title, subtitle].filter(Boolean).join(', ')}
        disabled={!item.reachable}
        onPress={() => router.push({ pathname: '/bot/[botId]', params: { botId: item.id, name: item.name } })}
        style={({ pressed }) => [
          styles.row,
          { borderColor: colors.border, opacity: !item.reachable ? 0.45 : pressed ? 0.6 : 1 },
        ]}>
        <BotAvatar name={item.name} />
        <View style={styles.rowText}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {item.name}
          </Text>
          {item.title ? (
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
              {item.title}
            </Text>
          ) : null}
          {subtitle ? (
            <Text style={[styles.preview, { color: colors.text }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

  return (
    <>
      {header}
      <FlatList
        testID="roster"
        data={roster?.bots ?? []}
        keyExtractor={(b) => b.id}
        refreshing={loading}
        onRefresh={refresh}
        ListHeaderComponent={
          fromCache && (loading || error) ? (
            <Text style={[styles.hint, { color: colors.text }]}>{error ? savedHint : 'Updating…'}</Text>
          ) : error ? (
            <Text style={[styles.error, { color: colors.notification }]}>{error}</Text>
          ) : undefined
        }
        ListEmptyComponent={
          roster && !error ? (
            <Text style={[styles.empty, { color: colors.text }]}>No Bots yet. Create one in Hermes Desktop (Bots tab).</Text>
          ) : undefined
        }
        renderItem={renderBot}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '600' },
  title: { fontSize: 13, opacity: 0.7 },
  preview: { fontSize: 14, opacity: 0.6 },
  empty: { textAlign: 'center', marginTop: 48, opacity: 0.6, paddingHorizontal: 24 },
  error: { padding: 16 },
  hint: { paddingHorizontal: 16, paddingVertical: 6, fontSize: 12, opacity: 0.6, textAlign: 'center' },
});
