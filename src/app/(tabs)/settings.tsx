import Constants from 'expo-constants';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Menu } from '@/components/drawer';
import { AppText, Button, Card, Screen, StateView } from '@/components/ui';
import { languages, type Key } from '@/i18n';
import { useSession } from '@/state/session';
import { useSettings, type LanguageChoice, type ThemeChoice } from '@/state/settings';
import { radius, spacing, touchTarget } from '@/theme';

function Choices<T extends string>({ label, options, value, onChange }: { label: string; options: [T, string][]; value: T; onChange: (value: T) => void }) {
  const { colors } = useSettings();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.group}>
      <AppText variant="label" color="onSurfaceVariant" accessibilityRole="header" style={styles.heading}>
        {label}
      </AppText>
      <Card>
        {options.map(([option, text]) => {
          const selected = option === value;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityLabel={text}
              accessibilityState={{ checked: selected }}
              onPress={() => onChange(option)}
              android_ripple={{ color: colors.outlineVariant }}
              style={styles.option}
            >
              <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.outline }]}>
                {selected ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}
              </View>
              <AppText>{text}</AppText>
            </Pressable>
          );
        })}
      </Card>
    </View>
  );
}

export default function Settings() {
  const { t, settings, update, colors } = useSettings();
  const version = Constants.expoConfig?.version ?? '';
  const { signOut, deviceSecure } = useSession();
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');

  const leave = async () => {
    setState('busy');
    try {
      await signOut();
    } catch {
      setState('failed');
    }
  };

  const languageOptions: [LanguageChoice, string][] = [
    ['system', t('settings.languageSystem')],
    ...languages.map((language): [LanguageChoice, string] => [language, t(`language.${language}` as Key)]),
  ];
  const themeOptions: [ThemeChoice, string][] = [
    ['system', t('settings.themeSystem')],
    ['light', t('settings.themeLight')],
    ['dark', t('settings.themeDark')],
  ];

  return (
    <Screen title={t('tabs.settings')} start={<Menu current="/settings" />}>
      <ScrollView contentContainerStyle={styles.content}>
        <Choices label={t('settings.language')} options={languageOptions} value={settings.language} onChange={(language) => void update({ language })} />
        <Choices label={t('settings.theme')} options={themeOptions} value={settings.theme} onChange={(theme) => void update({ theme })} />
        {deviceSecure ? null : (
          <AppText color="onErrorContainer" accessibilityRole="alert" style={[styles.warning, { backgroundColor: colors.errorContainer }]}>
            {t('settings.noScreenLock')}
          </AppText>
        )}
        <View style={styles.version} accessible accessibilityLabel={t('settings.versionValue', { version })}>
          <AppText color="onSurfaceVariant">{t('settings.version')}</AppText>
          <AppText color="onSurfaceVariant" selectable>
            {version}
          </AppText>
        </View>
        {state === 'failed' ? <StateView kind="error" title={t('common.error')} retryLabel={t('common.retry')} onRetry={() => void leave()} /> : null}
        <Button label={t('settings.signOut')} variant="outline" busy={state === 'busy'} onPress={() => void leave()} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingBottom: spacing.xl },
  group: { gap: spacing.xs },
  heading: { paddingHorizontal: spacing.xs },
  version: { minHeight: touchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xs },
  option: { minHeight: touchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, overflow: 'hidden' },
  radio: { width: 20, height: 20, borderRadius: radius.full, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  warning: { padding: spacing.md, borderRadius: radius.md, borderCurve: 'continuous', overflow: 'hidden' },
  dot: { width: 10, height: 10, borderRadius: radius.full },
});
