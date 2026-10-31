import type { SessionSummary } from '@hermes-mobile/api';
import { router, Stack, useFocusEffect, useTheme } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Button, FlatList, Pressable, RefreshControl, StyleSheet, Text } from 'react-native';
import { createSession, listSessions } from '@/lib/bff';
import { loadConfig } from '@/lib/config';

export default function SessionsScreen() {
  const { colors } = useTheme();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!(await loadConfig())) {
      router.push('/pair');
      return;
    }
    setLoading(true);
    try {
      setSessions(await listSessions());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  async function newChat() {
    try {
      const id = await createSession();
      router.push({ pathname: '/chat/[sessionId]', params: { sessionId: id } });
    } catch (e) {
      Alert.alert('Could not create a chat', (e as Error).message);
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => <Button title="New" onPress={newChat} />,
          headerLeft: () => <Button title="Pair" onPress={() => router.push('/pair')} />,
        }}
      />
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
        ListHeaderComponent={error ? <Text style={[styles.error, { color: colors.notification }]}>{error}</Text> : undefined}
        ListEmptyComponent={!loading && !error ? <Text style={[styles.empty, { color: colors.text }]}>No sessions yet. Tap New.</Text> : undefined}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/chat/[sessionId]', params: { sessionId: item.id, title: item.title ?? '' } })}
            style={({ pressed }) => [styles.row, { borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
              {item.title || item.preview || item.id}
            </Text>
            <Text style={{ color: colors.text, opacity: 0.6 }} numberOfLines={1}>
              {[item.source, item.message_count != null ? `${item.message_count} messages` : null].filter(Boolean).join(' · ')}
            </Text>
          </Pressable>
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
  title: { fontSize: 16, fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: 48, opacity: 0.6 },
  error: { padding: 16 },
});
