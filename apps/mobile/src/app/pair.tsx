import { router, useLocalSearchParams, useTheme } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { checkHealth } from '@/lib/bff';
import { loadConfig, saveConfig } from '@/lib/config';

// Reached manually or via hermesmobile://pair?url=…&token=… (the QR printed by `pnpm pair`).
export default function PairScreen() {
  const params = useLocalSearchParams<{ url?: string; token?: string }>();
  const { colors } = useTheme();
  const [url, setUrl] = useState(params.url ?? '');
  const [token, setToken] = useState(params.token ?? '');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (params.url) return;
    loadConfig().then((c) => c && (setUrl(c.url), setToken(c.token)));
  }, [params.url]);

  async function pair() {
    setBusy(true);
    setStatus(null);
    try {
      const config = { url: url.trim().replace(/\/$/, ''), token: token.trim() };
      const health = await checkHealth(config);
      await saveConfig(config);
      if (!health.hermes) setStatus('Paired, but the BFF cannot reach Hermes yet.');
      router.replace('/');
    } catch (error) {
      setStatus(`Could not reach the BFF: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const input = [styles.input, { color: colors.text, borderColor: colors.border }];
  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.text }]}>BFF URL</Text>
      <TextInput style={input} value={url} onChangeText={setUrl} placeholder="http://192.168.1.10:8787" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      <Text style={[styles.label, { color: colors.text }]}>Device token</Text>
      <TextInput style={input} value={token} onChangeText={setToken} placeholder="from `pnpm pair`" autoCapitalize="none" autoCorrect={false} secureTextEntry />
      {busy ? <ActivityIndicator /> : <Button title="Pair" onPress={pair} disabled={!url || !token} />}
      {status && <Text style={{ color: colors.notification }}>{status}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  label: { fontWeight: '600' },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, padding: 12, fontSize: 16 },
});
