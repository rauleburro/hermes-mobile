import { router, useLocalSearchParams, useTheme } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { checkHealth } from '@/lib/bff';
import { type BffConfig, loadConfig, saveConfig } from '@/lib/config';
import { normalizeBffUrl, parsePairParams } from '@/lib/pairing';

// Reached manually or via hermesmobile://pair?url=…&token=… (the QR printed by `pnpm pair`).
// The link only prefills the form: nothing is stored until the user taps Pair.
export default function PairScreen() {
  const params = useLocalSearchParams<{ url?: string | string[]; token?: string | string[] }>();
  const link = useMemo(() => parsePairParams({ url: params.url, token: params.token }), [params.url, params.token]);
  const { colors } = useTheme();
  const [url, setUrl] = useState(link.url ?? '');
  const [token, setToken] = useState(link.token ?? '');
  const [stored, setStored] = useState<BffConfig | null>(null);
  const [status, setStatus] = useState<string | null>(link.error ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadConfig().then((c) => {
      if (!c) return;
      setStored(c);
      // Values from the link win; the stored pairing only fills what the link left out.
      if (!link.url && !link.error) setUrl(c.url);
      if (!link.token) setToken(c.token);
    });
  }, [link]);

  const replacing =
    stored != null && ((link.url != null && link.url !== stored.url) || (link.token != null && link.token !== stored.token));

  async function pair() {
    setBusy(true);
    setStatus(null);
    try {
      const normalized = normalizeBffUrl(url);
      if (!normalized) {
        setStatus('Enter the BFF URL as http://host:port or https://host.');
        return;
      }
      const config = { url: normalized, token: token.trim() };
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
      {replacing && <Text style={{ color: colors.text }}>Pairing replaces the current BFF ({stored?.url}).</Text>}
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
