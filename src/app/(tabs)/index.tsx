import { StyleSheet, TextInput, View } from 'react-native';

import { AppText, Button, Screen, StateView } from '@/components/ui';
import { useSettings } from '@/state/settings';
import { radius, spacing, touchTarget, type } from '@/theme';

export default function Chat() {
  const { t, colors } = useSettings();
  return (
    <Screen title={t('tabs.chat')}>
      <StateView kind="empty" title={t('chat.empty')} />
      <View style={styles.composer}>
        <AppText variant="bodySmall" color="onSurfaceVariant">
          {t('chat.comingSoon')}
        </AppText>
        <View style={styles.row}>
          <TextInput
            editable={false}
            accessibilityLabel={t('chat.inputLabel')}
            accessibilityHint={t('chat.comingSoon')}
            accessibilityState={{ disabled: true }}
            placeholder={t('chat.placeholder')}
            placeholderTextColor={colors.onSurfaceVariant}
            style={[styles.input, type.body, { color: colors.onSurface, borderColor: colors.outline, backgroundColor: colors.surfaceContainer }]}
          />
          <Button label={t('chat.send')} onPress={() => {}} disabled accessibilityHint={t('chat.comingSoon')} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  composer: { gap: spacing.sm, paddingBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: { flex: 1, minHeight: touchTarget, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.md, textAlign: 'auto' },
});
