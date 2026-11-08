import { Tabs } from 'expo-router/tabs';

import { useSettings } from '@/state/settings';

export default function SectionsLayout() {
  const { colors } = useSettings();
  return (
    <Tabs tabBar={() => null} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.surface } }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="tasks" />
      <Tabs.Screen name="budget" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
