import type { BudgetMonthV1 } from '@famashines/ai-systems-contracts';
import * as Crypto from 'expo-crypto';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { LiveBar } from '@/components/live-bar';
import { AppText, Button, Screen, StateView } from '@/components/ui';
import type { Key } from '@/i18n';
import * as api from '@/lib/api';
import { formatUsd, parseUsd, usdText } from '@/lib/money';
import { useLive } from '@/state/live';
import { useSettings } from '@/state/settings';
import { radius, spacing, touchTarget, type } from '@/theme';

type Save = 'idle' | 'saving' | 'saved' | Extract<Key, 'budget.invalid' | 'budget.softAbove' | 'budget.failed' | 'budget.rejected'>;

function NoCap() {
  const { t, colors } = useSettings();
  return (
    <AppText color="onErrorContainer" accessibilityRole="alert" style={[styles.warning, { backgroundColor: colors.errorContainer }]}>
      {t('budget.noCap')}
    </AppText>
  );
}

function Line({ label, micro, alert = false }: { label: string; micro: number | null; alert?: boolean }) {
  const { t, language } = useSettings();
  const amount = micro === null ? t('budget.none') : formatUsd(language, micro);
  return (
    <View accessible accessibilityLabel={t('budget.item', { label, amount })} style={styles.line}>
      <AppText color={alert ? 'error' : 'onSurfaceVariant'}>{label}</AppText>
      <AppText color={alert ? 'error' : 'onSurface'}>{amount}</AppText>
    </View>
  );
}

function Month({ month }: { month: BudgetMonthV1 }) {
  const { t, colors } = useSettings();
  return (
    <View style={[styles.card, { backgroundColor: colors.surfaceContainer }]}>
      <AppText variant="label" color="onSurfaceVariant" accessibilityRole="header">
        {t('budget.month', { month: month.month })}
      </AppText>
      {month.capMicroUsd === null ? <NoCap /> : null}
      <Line label={t('budget.cap')} micro={month.capMicroUsd} />
      <Line label={t('budget.softCap')} micro={month.softCapMicroUsd ?? null} />
      <Line label={t('budget.spent')} micro={month.spentMicroUsd} />
      <Line label={t('budget.reserved')} micro={month.reservedMicroUsd} />
      <Line label={t('budget.remaining')} micro={month.remainingMicroUsd} />
      {month.overCapMicroUsd > 0 ? <Line label={t('budget.overCap')} micro={month.overCapMicroUsd} alert /> : null}
    </View>
  );
}

function Field({ label, value, onChange, testID }: { label: string; value: string; onChange: (text: string) => void; testID: string }) {
  const { colors } = useSettings();
  const { online } = useLive();
  return (
    <View style={styles.field}>
      <AppText variant="label" color="onSurfaceVariant">
        {label}
      </AppText>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        editable={online}
        keyboardType="decimal-pad"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !online }}
        style={[styles.input, type.body, { color: colors.onSurface, borderColor: colors.outline, backgroundColor: colors.surfaceContainer }]}
      />
    </View>
  );
}

function CapForm({ month }: { month: BudgetMonthV1 | null }) {
  const { t } = useSettings();
  const { online, reloadBudget } = useLive();
  const [hard, setHard] = useState(month?.capMicroUsd == null ? '' : usdText(month.capMicroUsd));
  const [soft, setSoft] = useState(month?.softCapMicroUsd === undefined ? '' : usdText(month.softCapMicroUsd));
  const [save, setSave] = useState<Save>('idle');
  const key = useRef<string | null>(null);

  const edit = (set: (text: string) => void) => (text: string) => {
    key.current = null;
    setSave('idle');
    set(text);
  };

  const submit = async () => {
    const hardCap = parseUsd(hard);
    const softCap = soft.trim() ? parseUsd(soft) : undefined;
    if (hardCap === null || softCap === null) return setSave('budget.invalid');
    if (softCap !== undefined && softCap > hardCap) return setSave('budget.softAbove');
    key.current ??= Crypto.randomUUID();
    setSave('saving');
    try {
      await api.setBudget(hardCap, softCap, key.current);
      key.current = null;
      setSave('saved');
      reloadBudget();
    } catch (error) {
      if (!(error instanceof api.ApiError)) return setSave('budget.failed');
      if (error.kind === 'rejected') return setSave(error.status === 0 ? 'budget.invalid' : 'budget.rejected');
      setSave('budget.failed');
    }
  };

  const message = save === 'idle' || save === 'saving' ? null : save === 'saved' ? t('budget.saved') : t(save);
  const bad = save !== 'idle' && save !== 'saving' && save !== 'saved';
  return (
    <View style={styles.form}>
      <AppText variant="label" color="onSurfaceVariant" accessibilityRole="header">
        {t('budget.setTitle')}
      </AppText>
      <Field testID="budget-hard" label={t('budget.hardLabel')} value={hard} onChange={edit(setHard)} />
      <Field testID="budget-soft" label={t('budget.softLabel')} value={soft} onChange={edit(setSoft)} />
      {online ? null : (
        <AppText variant="bodySmall" color="onSurfaceVariant" accessibilityLiveRegion="polite">
          {t('budget.offline')}
        </AppText>
      )}
      {message ? (
        <AppText color={bad ? 'error' : 'onSurface'} accessibilityLiveRegion="polite" accessibilityRole={bad ? 'alert' : undefined}>
          {message}
        </AppText>
      ) : null}
      <Button label={t('budget.save')} busy={save === 'saving'} disabled={!online || !hard.trim()} onPress={() => void submit()} />
    </View>
  );
}

export default function Budget() {
  const { t } = useSettings();
  const { budget, reloadBudget } = useLive();
  return (
    <Screen title={t('tabs.budget')}>
      <LiveBar />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {budget.loaded ? (
          budget.doc ? (
            <Month month={budget.doc} />
          ) : (
            <NoCap />
          )
        ) : budget.load === 'error' ? (
          <StateView kind="error" title={t('budget.error')} retryLabel={t('common.retry')} onRetry={reloadBudget} />
        ) : (
          <StateView kind="loading" title={t('budget.loading')} />
        )}
        {budget.loaded ? <CapForm month={budget.doc} /> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingBottom: spacing.xl },
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg },
  line: { minHeight: touchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  warning: { padding: spacing.md, borderRadius: radius.md },
  form: { gap: spacing.md },
  field: { gap: spacing.xs },
  input: { minHeight: touchTarget, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.md, textAlign: 'auto' },
});
