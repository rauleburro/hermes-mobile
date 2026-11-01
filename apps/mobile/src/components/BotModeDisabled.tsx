import { useTheme } from 'expo-router';
import { Button, StyleSheet, Text, View } from 'react-native';

/** Shown when Hermes has no Bots: the app is a Bots client and never creates loose sessions. */
export function BotModeDisabled({ onRetry }: { onRetry: () => void }) {
  const { colors } = useTheme();
  const text = { color: colors.text };
  return (
    <View style={styles.container}>
      <Text style={[styles.title, text]}>Bot Mode is not enabled</Text>
      <Text style={[styles.body, text]}>
        This app talks to your Hermes Bots. Turn on Bot Mode in Hermes Desktop to get started:
      </Text>
      <Text style={[styles.step, text]}>1. Open Hermes Desktop on the machine that runs Hermes.</Text>
      <Text style={[styles.step, text]}>2. Go to the Bots tab and create a Bot (or enable Bot Mode).</Text>
      <Text style={[styles.step, text]}>3. Open the Bot once there so its Bot Chat exists.</Text>
      <Text style={[styles.body, text]}>Then come back and check again.</Text>
      <Button title="Check again" onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12, marginTop: 24 },
  title: { fontSize: 20, fontWeight: '700' },
  body: { fontSize: 15, opacity: 0.8 },
  step: { fontSize: 15 },
});
