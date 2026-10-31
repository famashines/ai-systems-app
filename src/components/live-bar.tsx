import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useLive } from '@/state/live';
import { useSettings } from '@/state/settings';
import { radius, spacing } from '@/theme';

export function LiveBar() {
  const { t, colors } = useSettings();
  const { status, updated } = useLive();
  const reconnecting = status === 'reconnecting';
  if (!reconnecting && !updated) return null;
  return (
    <View
      testID="live-bar"
      accessibilityLiveRegion="polite"
      style={[styles.bar, { backgroundColor: reconnecting ? colors.surfaceContainerHigh : colors.primaryContainer }]}
    >
      <AppText variant="label" color={reconnecting ? 'onSurface' : 'onPrimaryContainer'}>
        {t(reconnecting ? 'live.reconnecting' : 'live.updated')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md },
});
