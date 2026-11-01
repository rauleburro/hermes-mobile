import type { BotSummary, BotsResponse } from '@hermes-mobile/api';
import { router, Stack, useFocusEffect, useTheme } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { BotAvatar } from '@/components/BotAvatar';
import { BotModeDisabled } from '@/components/BotModeDisabled';
import { BffError, getBotChat, getBotMessages, listBots } from '@/lib/bff';
import { lastMessagePreview } from '@/lib/bots';
import { bindCache, cacheOwner, readRoster, writeRoster } from '@/lib/cache';
import { loadConfig } from '@/lib/config';

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
  // First paint comes from the local cache (synchronous), then the BFF replaces it.
  const [saved] = useState(readRoster);
  const [roster, setRoster] = useState<BotsResponse | null>(saved?.roster ?? null);
  const [previews, setPreviews] = useState<Record<string, string | undefined>>(saved?.previews ?? {});
  /** True while the roster on screen is the saved copy, not a fresh answer from the BFF. */
  const [fromCache, setFromCache] = useState(saved !== null);
  /** Which BFF the roster on screen belongs to. */
  const owner = useRef(saved ? cacheOwner() : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Each refresh bumps this; previews from an older refresh are dropped when they land.
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const config = await loadConfig();
    if (!config) {
      router.push('/pair');
      return;
    }
    bindCache(config.url);
    if (owner.current !== null && owner.current !== config.url) {
      // Paired with another BFF since this roster was loaded: never show its data.
      setRoster(null);
      setPreviews({});
      setFromCache(false);
    }
    owner.current = config.url;
    const current = ++generation.current;
    setLoading(true);
    try {
      const next = await listBots();
      if (current !== generation.current) return;
      setRoster(next);
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
      if (current === generation.current) setError((e as Error).message);
    } finally {
      // Only the latest refresh owns the spinner.
      if (current === generation.current) setLoading(false);
    }
  }, []);

  // Only fresh data is saved: a failed refresh never overwrites the cache.
  useEffect(() => {
    if (roster && !fromCache) writeRoster(roster, previews);
  }, [roster, previews, fromCache]);

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
            <Text style={[styles.hint, { color: colors.text }]}>{error ? 'Offline · showing saved data' : 'Updating…'}</Text>
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
