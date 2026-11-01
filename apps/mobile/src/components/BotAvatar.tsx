import { useTheme } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { initials } from '@/lib/bots';

/** Placeholder avatar (initials) until Bots expose an image. */
export function BotAvatar({ name, size = 44 }: { name: string; size?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primary }]}>
      <Text style={[styles.text, { fontSize: size * 0.38 }]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  text: { color: '#fff', fontWeight: '700' },
});
