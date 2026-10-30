import { useEffect, useEffectEvent, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { spacing } from '@/theme';

export function LockScreen() {
  const { t, colors } = useSettings();
  const { unlock } = useSession();
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);

  const prompt = () =>
    void unlock(t('lock.prompt')).then((ok) => {
      setBusy(false);
      setFailed(!ok);
    });

  const attempt = () => {
    setBusy(true);
    setFailed(false);
    prompt();
  };

  const firstPrompt = useEffectEvent(prompt);

  useEffect(() => {
    firstPrompt();
  }, []);

  return (
    <View style={[StyleSheet.absoluteFill, styles.lock, { backgroundColor: colors.surface }]} accessibilityViewIsModal>
      <AppText variant="headline" accessibilityRole="header" style={styles.center}>
        {t('lock.title')}
      </AppText>
      <AppText color="onSurfaceVariant" style={styles.center}>
        {t('lock.body')}
      </AppText>
      {failed ? (
        <AppText color="error" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.center}>
          {t('lock.failed')}
        </AppText>
      ) : null}
      <Button label={failed ? t('common.retry') : t('lock.button')} onPress={attempt} busy={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  lock: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  center: { textAlign: 'center' },
});
