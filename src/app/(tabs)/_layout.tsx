import { Tabs } from 'expo-router/tabs';

import { useSettings } from '@/state/settings';

export default function SectionsLayout() {
  const { colors } = useSettings();
  return <Tabs tabBar={() => null} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.surface } }} />;
}
