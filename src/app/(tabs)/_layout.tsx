import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useSettings } from '@/state/settings';

export default function TabsLayout() {
  const { t, colors } = useSettings();
  return (
    <NativeTabs
      backgroundColor={colors.surfaceContainer}
      indicatorColor={colors.primaryContainer}
      rippleColor={colors.outlineVariant}
      iconColor={{ default: colors.onSurfaceVariant, selected: colors.onPrimaryContainer }}
      labelStyle={{ default: { color: colors.onSurfaceVariant }, selected: { color: colors.onSurface } }}
      labelVisibilityMode="labeled"
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf="bubble.left" md="chat" />
        <NativeTabs.Trigger.Label>{t('tabs.chat')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tasks">
        <NativeTabs.Trigger.Icon sf="checklist" md="checklist" />
        <NativeTabs.Trigger.Label>{t('tabs.tasks')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
        <NativeTabs.Trigger.Label>{t('tabs.settings')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
