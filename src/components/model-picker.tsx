import type { ModelListItemV1, ReasoningEffort } from '@famashines/ai-systems-contracts';
import { useState } from 'react';
import { ActivityIndicator, Animated, Dimensions, FlatList, KeyboardAvoidingView, Modal, PanResponder, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, Button } from '@/components/ui';
import type { Key } from '@/i18n';
import type { Choice as ModelChoice } from '@/lib/api';
import { useLive } from '@/state/live';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { motion, radius, rail, readingWidth, spacing, touchTarget, type } from '@/theme';

const Sheet = Animated.createAnimatedComponent(SafeAreaView);
const closeDistance = 120;
const closeSpeed = 0.8;
const tapDistance = 4;

function useDragToClose(onClose: () => void) {
  const [offset] = useState(() => new Animated.Value(0));
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_event, { dy }) => offset.setValue(Math.max(0, dy)),
      onPanResponderTerminate: () => Animated.spring(offset, { toValue: 0, useNativeDriver: true }).start(),
      onPanResponderRelease: (_event, { dy, vy }) => {
        if (dy < closeDistance && vy < closeSpeed && Math.abs(dy) >= tapDistance) {
          Animated.spring(offset, { toValue: 0, useNativeDriver: true }).start();
          return;
        }
        Animated.timing(offset, { toValue: Dimensions.get('window').height, duration: motion.open, useNativeDriver: true }).start(({ finished }) => {
          if (finished) onClose();
        });
      },
    }),
  );
  return { offset, handlers: responder.panHandlers };
}

const effortOrder: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function choiceOf(items: ModelListItemV1[], loaded: boolean, model: string | null, effort: ReasoningEffort | null): { item?: ModelListItemV1; choice: ModelChoice } {
  if (!loaded) return { choice: model ? { model, ...(effort ? { effort } : {}) } : {} };
  const item = items.find((candidate) => candidate.id === model);
  if (!item) return { choice: {} };
  const chosen = effort && item.efforts.includes(effort) ? effort : item.defaultEffort && item.efforts.includes(item.defaultEffort) ? item.defaultEffort : undefined;
  return { item, choice: { model: item.id, ...(chosen ? { effort: chosen } : {}) } };
}

export function shortName(name: string): string {
  const rest = name.slice(name.indexOf(': ') + 1).trim() || name;
  return rest.length > 12 ? rest.split(/\s+/).slice(-2).join(' ') : rest;
}

export function useChoice(): ModelChoice {
  const { settings } = useSettings();
  const { models } = useLive();
  return choiceOf(models.items, models.loaded, settings.model, settings.effort).choice;
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
      style={[styles.row, { backgroundColor: selected ? colors.primaryContainer : 'transparent' }]}
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

function EffortRail({ efforts, selected, onPick }: { efforts: ReasoningEffort[]; selected?: ReasoningEffort; onPick: (effort: ReasoningEffort) => void }) {
  const { t, colors } = useSettings();
  const steps = effortOrder.filter((effort) => efforts.includes(effort));
  const at = selected ? steps.indexOf(selected) : -1;
  const edge = (lit: boolean, shown: boolean) => <View style={[styles.edge, { backgroundColor: !shown ? 'transparent' : lit ? colors.primary : colors.outline }]} />;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('chat.effort')}>
      <ScrollView testID="effort-rail" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {steps.map((effort, index) => {
          const on = index === at;
          const size = on ? rail.nodeOn : rail.node;
          return (
            <Pressable key={effort} accessibilityRole="radio" accessibilityLabel={t(`effort.${effort}` as Key)} accessibilityState={{ checked: on }} onPress={() => onPick(effort)} android_ripple={{ color: colors.outlineVariant }} style={styles.step}>
              <View style={styles.track}>
                {edge(index <= at, index > 0)}
                <View style={{ width: size, height: size, borderRadius: radius.full, backgroundColor: index <= at ? colors.primary : colors.outline }} />
                {edge(index < at, index < steps.length - 1)}
              </View>
              <AppText variant={on ? 'label' : 'bodySmall'} color={on ? 'primary' : 'onSurfaceVariant'} numberOfLines={2} style={styles.stepLabel}>
                {t(`effort.${effort}` as Key)}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function ModelPicker({ disabled }: { disabled: boolean }) {
  const { t, colors, settings, update } = useSettings();
  const { models, reloadModels } = useLive();
  const { locked } = useSession();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const drag = useDragToClose(() => setOpen(false));
  if (open && locked) setOpen(false);

  const { item, choice } = choiceOf(models.items, models.loaded, settings.model, settings.effort);
  const effortText = choice.effort ? t(`effort.${choice.effort}` as Key) : null;
  const fullName = item?.name ?? choice.model?.slice(choice.model.lastIndexOf('/') + 1);
  const chipLabel = !fullName ? t('chat.modelChoose') : effortText ? t('chat.modelChip', { model: fullName, effort: effortText }) : t('chat.modelOnly', { model: fullName });
  const words = query.trim().toLowerCase();
  const shown = words ? models.items.filter((model) => model.name.toLowerCase().includes(words) || model.id.toLowerCase().includes(words)) : models.items;

  const show = () => {
    setQuery('');
    drag.offset.setValue(0);
    setOpen(true);
    if (models.load === 'error' || (models.load === 'idle' && models.items.length === 0)) reloadModels();
  };
  const close = () => setOpen(false);
  const pick = (next: ModelListItemV1) => {
    const effort = item && settings.effort && next.efforts.includes(settings.effort) ? settings.effort : null;
    void update({ model: next.id, effort });
  };

  return (
    <>
      <Pressable
        testID="model-chip"
        accessibilityRole="button"
        accessibilityLabel={chipLabel}
        accessibilityHint={t('chat.modelHint')}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={show}
        android_ripple={{ color: colors.outlineVariant }}
        style={[styles.chip, { backgroundColor: fullName ? colors.surfaceContainerHigh : colors.primaryContainer, opacity: disabled ? 0.38 : 1 }]}
      >
        <AppText variant="label" color={fullName ? 'onSurface' : 'onPrimaryContainer'} numberOfLines={fullName ? 1 : 2} style={styles.chipText}>
          {fullName ? shortName(fullName) : t('chat.modelChoose')}
        </AppText>
        {effortText ? (
          <AppText variant="bodySmall" color="onSurfaceVariant" numberOfLines={1}>
            {effortText}
          </AppText>
        ) : null}
      </Pressable>
      <Modal testID="model-picker" visible={open && !locked} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
        <Pressable accessible={false} importantForAccessibility="no" onPress={close} style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} />
        <KeyboardAvoidingView behavior="padding" pointerEvents="box-none" style={styles.wrap}>
          <Sheet testID="model-panel" accessibilityViewIsModal edges={['bottom', 'left', 'right']} style={[styles.sheet, { backgroundColor: colors.surface, transform: [{ translateY: drag.offset }] }]}>
            <View testID="model-handle" accessible accessibilityRole="button" accessibilityLabel={t('chat.modelClose')} onAccessibilityTap={close} {...drag.handlers} style={styles.handle}>
              <View style={[styles.pill, { backgroundColor: colors.outline }]} />
            </View>
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
                data={shown}
                keyExtractor={(model) => model.id}
                renderItem={({ item: model }) => <Row label={model.name} detail={model.id} selected={model.id === item?.id} onPress={() => pick(model)} />}
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
                <EffortRail efforts={item.efforts} {...(choice.effort ? { selected: choice.effort } : {})} onPick={(effort) => void update({ effort })} />
              </>
            ) : null}
            <Button label={t('chat.done')} onPress={close} />
          </Sheet>
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
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderTopStartRadius: radius.xl,
    borderTopEndRadius: radius.xl,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  handle: { height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  pill: { width: 36, height: rail.edge, borderRadius: radius.full },
  chip: { minHeight: touchTarget, minWidth: touchTarget, maxWidth: 104, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.sm + spacing.xs, borderRadius: radius.full, overflow: 'hidden' },
  search: { minHeight: touchTarget, paddingHorizontal: spacing.md, borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: radius.full, textAlign: 'auto' },
  row: { minHeight: touchTarget + spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderCurve: 'continuous', overflow: 'hidden' },
  radio: { width: 20, height: 20, borderRadius: radius.full, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: radius.full },
  chipText: { textAlign: 'center' },
  rail: { flexGrow: 1 },
  step: { flex: 1, minWidth: touchTarget, minHeight: touchTarget + spacing.md, gap: spacing.xs, paddingVertical: spacing.sm, alignItems: 'stretch', overflow: 'hidden' },
  track: { flexDirection: 'row', alignItems: 'center', height: rail.nodeOn },
  edge: { flex: 1, height: rail.edge },
  stepLabel: { textAlign: 'center' },
  note: { gap: spacing.sm, padding: spacing.md, alignItems: 'flex-start' },
});
