import { StyleSheet, Text, View } from 'react-native';
import { initials } from '@/lib/bots';
import { useTheme } from '@/theme';

/** Placeholder avatar (initials on the Bot's hue) until Bots expose an image. */
export function BotAvatar({ botId, name, size = 44 }: { botId: string; name: string; size?: number }) {
  const hue = useTheme().botHue(botId);
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: hue.fill }]}>
      <Text style={[styles.text, { color: hue.onFill, fontSize: size * 0.38 }]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '700' },
});
