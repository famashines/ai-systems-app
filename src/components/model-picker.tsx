import type { ModelListItemV1, ReasoningEffort } from '@famashines/ai-systems-contracts';
import { useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Choice } from '@/components/task';
import { AppText, Button } from '@/components/ui';
import type { Key } from '@/i18n';
import type { Choice as ModelChoice } from '@/lib/api';
import { useLive } from '@/state/live';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { radius, readingWidth, spacing, touchTarget, type } from '@/theme';

export function choiceOf(items: ModelListItemV1[], model: string | null, effort: ReasoningEffort | null): { item?: ModelListItemV1; choice: ModelChoice } {
  const item = items.find((candidate) => candidate.id === model);
  if (!item) return { choice: {} };
  return { item, choice: { model: item.id, ...(effort && item.efforts.includes(effort) ? { effort } : {}) } };
}

export function shortName(name: string): string {
  return name.slice(name.indexOf(': ') + 1).trim() || name;
}

export function useChoice(): ModelChoice {
  const { settings } = useSettings();
  const { models } = useLive();
  return choiceOf(models.items, settings.model, settings.effort).choice;
}

function Row({ label, detail, selected, onPress }: { label: string; detail?: string; selected: boolean; onPress: () => void }) {
  const { colors } = useSettings();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      android_ripple={{ color: colors.outlineVariant }}
      style={[styles.row, { backgroundColor: selected ? colors.surfaceContainerHigh : 'transparent' }]}
    >
      <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.outline }]}>{selected ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}</View>
      <View style={styles.fill}>
        <AppText numberOfLines={1}>{label}</AppText>
        {detail ? (
          <AppText variant="bodySmall" color="onSurfaceVariant" numberOfLines={1}>
            {detail}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

export function ModelPicker({ disabled }: { disabled: boolean }) {
  const { t, colors, settings, update } = useSettings();
  const { models, reloadModels } = useLive();
  const { locked } = useSession();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  if (open && locked) setOpen(false);

  const { item, choice } = choiceOf(models.items, settings.model, settings.effort);
  const auto = t('chat.modelAuto');
  const effortName = (effort: ReasoningEffort) => t(`effort.${effort}` as Key);
  const effortText = choice.effort ? effortName(choice.effort) : auto;
  const words = query.trim().toLowerCase();
  const shown = words ? models.items.filter((model) => model.name.toLowerCase().includes(words) || model.id.toLowerCase().includes(words)) : models.items;

  const show = () => {
    setQuery('');
    setOpen(true);
    if (models.load === 'error' || (models.load === 'idle' && models.items.length === 0)) reloadModels();
  };
  const close = () => setOpen(false);
  const pick = (next: ModelListItemV1 | null) => {
    const effort = next && settings.effort && next.efforts.includes(settings.effort) ? settings.effort : null;
    void update({ model: next?.id ?? null, effort });
  };

  return (
    <>
      <Pressable
        testID="model-chip"
        accessibilityRole="button"
        accessibilityLabel={t('chat.modelChip', { model: item?.name ?? auto, effort: effortText })}
        accessibilityHint={t('chat.modelHint')}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={show}
        android_ripple={{ color: colors.outlineVariant }}
        style={[styles.chip, { backgroundColor: colors.surfaceContainerHigh, opacity: disabled ? 0.38 : 1 }]}
      >
        <AppText variant="label" numberOfLines={1}>
          {item ? (choice.effort ? t('chat.modelChipText', { model: shortName(item.name), effort: effortText }) : shortName(item.name)) : auto}
        </AppText>
      </Pressable>
      <Modal testID="model-picker" visible={open && !locked} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
        <Pressable accessible={false} importantForAccessibility="no" onPress={close} style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} />
        <KeyboardAvoidingView behavior="padding" pointerEvents="box-none" style={styles.wrap}>
          <SafeAreaView testID="model-panel" accessibilityViewIsModal edges={['bottom', 'left', 'right']} style={[styles.sheet, { backgroundColor: colors.surface }]}>
            <AppText variant="title" accessibilityRole="header">
              {t('chat.modelTitle')}
            </AppText>
            <TextInput
              testID="model-search"
              value={query}
              onChangeText={setQuery}
              accessibilityLabel={t('chat.modelSearch')}
              placeholder={t('chat.modelSearch')}
              placeholderTextColor={colors.onSurfaceVariant}
              autoCorrect={false}
              autoCapitalize="none"
              style={[styles.search, type.body, { color: colors.onSurface, borderColor: colors.outline, backgroundColor: colors.surfaceContainer }]}
            />
            <AppText variant="label" color="onSurfaceVariant" accessibilityRole="header">
              {t('chat.model')}
            </AppText>
            <View accessibilityRole="radiogroup" accessibilityLabel={t('chat.model')} style={styles.fill}>
              <FlatList
                testID="model-list"
                keyboardShouldPersistTaps="handled"
                data={[null, ...shown]}
                keyExtractor={(model) => model?.id ?? ''}
                renderItem={({ item: model }) =>
                  model ? <Row label={model.name} detail={model.id} selected={model.id === item?.id} onPress={() => pick(model)} /> : <Row label={auto} selected={!item} onPress={() => pick(null)} />
                }
                ListFooterComponent={
                  models.load === 'loading' ? (
                    <ActivityIndicator style={styles.note} color={colors.primary} accessibilityLabel={t('chat.modelsLoading')} />
                  ) : models.load === 'error' ? (
                    <View style={styles.note} accessibilityLiveRegion="polite">
                      <AppText variant="bodySmall" color="onSurfaceVariant">
                        {t('chat.modelsError')}
                      </AppText>
                      <Button label={t('common.retry')} variant="outline" onPress={reloadModels} />
                    </View>
                  ) : words && shown.length === 0 ? (
                    <AppText variant="bodySmall" color="onSurfaceVariant" accessibilityLiveRegion="polite" style={styles.note}>
                      {t('chat.modelsNone')}
                    </AppText>
                  ) : undefined
                }
              />
            </View>
            {item && item.efforts.length > 0 ? (
              <>
                <AppText variant="label" color="onSurfaceVariant" accessibilityRole="header">
                  {t('chat.effort')}
                </AppText>
                <View accessibilityRole="radiogroup" accessibilityLabel={t('chat.effort')} style={styles.efforts}>
                  <Choice label={item.defaultEffort ? t('chat.effortAuto', { effort: effortName(item.defaultEffort) }) : auto} selected={!choice.effort} onPress={() => void update({ effort: null })} />
                  {item.efforts.map((effort) => (
                    <Choice key={effort} label={effortName(effort)} selected={choice.effort === effort} onPress={() => void update({ effort })} />
                  ))}
                </View>
              </>
            ) : null}
            <Button label={t('chat.done')} onPress={close} />
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    height: '85%',
    width: '100%',
    maxWidth: readingWidth,
    alignSelf: 'center',
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderTopStartRadius: radius.xl,
    borderTopEndRadius: radius.xl,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  chip: { minHeight: touchTarget, minWidth: touchTarget, maxWidth: 136, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.md, borderRadius: radius.full, overflow: 'hidden' },
  search: { minHeight: touchTarget, paddingHorizontal: spacing.md, borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: radius.full, textAlign: 'auto' },
  row: { minHeight: touchTarget + spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderCurve: 'continuous', overflow: 'hidden' },
  radio: { width: 20, height: 20, borderRadius: radius.full, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: radius.full },
  efforts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  note: { gap: spacing.sm, padding: spacing.md, alignItems: 'flex-start' },
});
