import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Hermes' }} />
        <Stack.Screen name="pair" options={{ title: 'Pair with BFF', presentation: 'modal' }} />
        <Stack.Screen name="chat/[sessionId]" options={{ title: 'Chat' }} />
      </Stack>
    </ThemeProvider>
  );
}
