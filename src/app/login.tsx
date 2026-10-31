import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Screen } from '@/components/ui';
import { IssuerUnreachableError } from '@/lib/auth';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { spacing } from '@/theme';

type State = 'idle' | 'busy' | 'unreachable' | 'failed';

export default function Login() {
  const { t } = useSettings();
  const { signIn, ended } = useSession();
  const [state, setState] = useState<State>('idle');

  const press = async () => {
    setState('busy');
    try {
      await signIn();
      setState('idle');
    } catch (error) {
      setState(error instanceof IssuerUnreachableError ? 'unreachable' : 'failed');
    }
  };

  return (
    <Screen title={t('app.name')}>
      <View style={styles.body}>
        <AppText variant="headline">{t('login.title')}</AppText>
        <AppText color="onSurfaceVariant">{t('login.body')}</AppText>
        {ended && state === 'idle' ? (
          <AppText color="error" accessibilityRole="alert" accessibilityLiveRegion="polite">
            {t(ended === 'refused' ? 'login.refused' : 'login.ended')}
          </AppText>
        ) : null}
        {state === 'unreachable' || state === 'failed' ? (
          <AppText color="error" accessibilityRole="alert" accessibilityLiveRegion="polite">
            {t(state === 'unreachable' ? 'login.errorUnreachable' : 'login.errorFailed')}
          </AppText>
        ) : null}
        <Button
          label={state === 'busy' ? t('login.busy') : state === 'idle' ? t('login.button') : t('common.retry')}
          onPress={() => void press()}
          busy={state === 'busy'}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, justifyContent: 'center', gap: spacing.md },
});
