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
  // Memoize on the first values (strings), so a repeated param's new array each render doesn't refill the form.
  const rawUrl = [params.url].flat()[0];
  const rawToken = [params.token].flat()[0];
  const link = useMemo(() => parsePairParams({ url: rawUrl, token: rawToken }), [rawUrl, rawToken]);
  const { colors } = useTheme();
  const [url, setUrl] = useState(link.url ?? '');
  const [token, setToken] = useState(link.token ?? '');
  // True while the token field holds the STORED token (filled by the app, not typed or from a link).
  // The stored token is only ever sent to the stored BFF.
  const [tokenFromStore, setTokenFromStore] = useState(false);
  const [stored, setStored] = useState<BffConfig | null>(null);
  const [status, setStatus] = useState<string | null>(link.error ?? null);
  const [busy, setBusy] = useState(false);

  // A link opened while this screen is already showing only changes the params: refill the form.
  const [shownLink, setShownLink] = useState(link);
  if (link !== shownLink) {
    setShownLink(link);
    setStatus(link.error ?? null);
    if (link.url || link.error) {
      const reuse = !link.token && stored != null && link.url === stored.url;
      setUrl(link.url ?? '');
      setToken(link.token ?? (reuse ? stored.token : ''));
      setTokenFromStore(reuse);
    } else if (link.token) {
      setToken(link.token);
      setTokenFromStore(false);
    }
  }

  useEffect(() => {
    let ignore = false; // a later link re-runs this effect; drop the stale load
    loadConfig().then((c) => {
      if (ignore || !c) return;
      setStored(c);
      // Values from the link win; the stored pairing only fills what the link left out,
      // and its token only when the URL is the stored BFF.
      if (!link.url && !link.error) setUrl(c.url);
      if (!link.token && !link.error && (!link.url || link.url === c.url)) {
        setToken(c.token);
        setTokenFromStore(true);
      }
    });
    return () => {
      ignore = true;
    };
  }, [link]);

  const fieldUrl = normalizeBffUrl(url);
  const replacing = stored != null && fieldUrl != null && fieldUrl !== stored.url;

  async function pair() {
    setBusy(true);
    setStatus(null);
    try {
      const normalized = normalizeBffUrl(url);
      if (!normalized) {
        setStatus('Enter the BFF URL as http://host:port or https://host.');
        return;
      }
      if (tokenFromStore && normalized !== stored?.url) {
        setStatus('Enter the device token for this BFF (from `pnpm pair`).');
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
      <TextInput style={input} value={token} onChangeText={(t) => (setToken(t), setTokenFromStore(false))} placeholder="from `pnpm pair`" autoCapitalize="none" autoCorrect={false} secureTextEntry />
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
