import { Stack } from 'expo-router';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LockScreen } from '@/components/lock-screen';
import { LiveProvider } from '@/state/live';
import { SessionProvider, useSession } from '@/state/session';
import { SettingsProvider, useSettings } from '@/state/settings';

void SplashScreen.preventAutoHideAsync().catch(() => {});

function Shell() {
  const { colors, dark } = useSettings();
  const { status, locked } = useSession();
  const base = dark ? DarkTheme : DefaultTheme;

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync().catch(() => {});
  }, [status]);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.surface).catch(() => {});
  }, [colors.surface]);

  if (status === 'loading') return null;

  return (
    <ThemeProvider
      value={{
        ...base,
        colors: { ...base.colors, primary: colors.primary, background: colors.surface, card: colors.surfaceContainer, text: colors.onSurface, border: colors.outlineVariant },
      }}
    >
      <StatusBar style={dark ? 'light' : 'dark'} />
      <View style={{ flex: 1 }} importantForAccessibility={locked ? 'no-hide-descendants' : 'auto'}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}>
          <Stack.Protected guard={status === 'signedIn'}>
            <Stack.Screen name="(tabs)" />
          </Stack.Protected>
          <Stack.Protected guard={status !== 'signedIn'}>
            <Stack.Screen name="login" />
          </Stack.Protected>
        </Stack>
      </View>
      {locked ? <LockScreen /> : null}
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <SettingsProvider>
          <LiveProvider>
            <Shell />
          </LiveProvider>
        </SettingsProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
