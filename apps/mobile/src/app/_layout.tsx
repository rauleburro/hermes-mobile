import { Stack, ThemeProvider } from 'expo-router';
import { navigationTheme, useTheme } from '@/theme';

export default function RootLayout() {
  const { scheme } = useTheme();
  return (
    <ThemeProvider value={navigationTheme(scheme)}>
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Bots' }} />
        <Stack.Screen name="pair" options={{ title: 'Pair with BFF', presentation: 'modal' }} />
        <Stack.Screen name="bot/[botId]" options={{ title: 'Bot Chat' }} />
      </Stack>
    </ThemeProvider>
  );
}
