import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Animated, I18nManager, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, Icon, IconButton, type IconName } from '@/components/ui';
import type { Key } from '@/i18n';
import { useLive } from '@/state/live';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { drawerWidth, motion, radius, spacing, touchTarget } from '@/theme';

export type Section = '/' | '/tasks' | '/budget' | '/settings';

const sections: [Section, Key, IconName][] = [
  ['/', 'tabs.chat', { ios: 'bubble.left', android: 'chat_bubble', web: 'chat_bubble' }],
  ['/tasks', 'tabs.tasks', { ios: 'checklist', android: 'checklist', web: 'checklist' }],
  ['/budget', 'tabs.budget', { ios: 'dollarsign.circle', android: 'savings', web: 'savings' }],
  ['/settings', 'tabs.settings', { ios: 'gearshape', android: 'settings', web: 'settings' }],
];

const recentMax = 10;

export function Menu({ current }: { current: Section }) {
  const { t, colors } = useSettings();
  const { tasks, online, snapshot } = useLive();
  const { locked } = useSession();
  const [open, setOpen] = useState(false);
  if (open && locked) setOpen(false);
  const [progress] = useState(() => new Animated.Value(0));
  const side = I18nManager.isRTL ? 1 : -1;

  const show = () => {
    progress.setValue(0);
    setOpen(true);
    Animated.timing(progress, { toValue: 1, duration: motion.open, useNativeDriver: true }).start();
  };
  const close = () => setOpen(false);
  const go = (href: Href, push = false) => {
    close();
    if (push) router.push(href);
    else router.navigate(href);
  };

  return (
    <>
      <IconButton testID="menu" icon={{ ios: 'line.3.horizontal', android: 'menu', web: 'menu' }} label={t('drawer.open')} onPress={show} />
      <Modal testID="drawer" visible={open && !locked} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim, opacity: progress }]} />
        <Pressable testID="drawer-scrim" accessibilityRole="button" accessibilityLabel={t('drawer.close')} onPress={close} style={StyleSheet.absoluteFill} />
        <Animated.View
          testID="drawer-panel"
          accessibilityViewIsModal
          style={[
            styles.panel,
            { backgroundColor: colors.surface, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [side * drawerWidth, 0] }) }] },
          ]}
        >
          <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.fill}>
            <View style={styles.top}>
              <AppText variant="title" accessibilityRole="header" style={styles.fill}>
                {t('app.name')}
              </AppText>
              <IconButton icon={{ ios: 'xmark', android: 'close', web: 'close' }} label={t('drawer.close')} onPress={close} />
            </View>
            <ScrollView contentContainerStyle={styles.list}>
              {sections.map(([href, key, icon]) => {
                const selected = href === current;
                return (
                  <Pressable
                    key={href}
                    testID={`drawer-${href}`}
                    accessibilityRole="button"
                    accessibilityLabel={t(key)}
                    accessibilityState={{ selected }}
                    onPress={() => go(href)}
                    android_ripple={{ color: colors.outlineVariant }}
                    style={[styles.row, { backgroundColor: selected ? colors.surfaceContainerHigh : 'transparent' }]}
                  >
                    <Icon name={icon} color={selected ? 'onSurface' : 'onSurfaceVariant'} />
                    <AppText variant="label">{t(key)}</AppText>
                  </Pressable>
                );
              })}
              <View style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />
              <AppText variant="bodySmall" color="onSurfaceVariant" accessibilityRole="header" style={styles.heading}>
                {t('drawer.recent')}
              </AppText>
              {tasks.length === 0 ? (
                online && snapshot === 'idle' ? (
                  <AppText variant="bodySmall" color="onSurfaceVariant" style={styles.heading}>
                    {t('tasks.empty')}
                  </AppText>
                ) : null
              ) : (
                tasks.slice(0, recentMax).map((task) => {
                  const status = t(`taskStatus.${task.status}`);
                  return (
                    <Pressable
                      key={task.taskId}
                      testID={`drawer-task-${task.taskId}`}
                      accessibilityRole="button"
                      accessibilityLabel={t('drawer.task', { title: task.title, status })}
                      accessibilityHint={t('tasks.open')}
                      onPress={() => go({ pathname: '/task/[id]', params: { id: task.taskId } }, true)}
                      android_ripple={{ color: colors.outlineVariant }}
                      style={styles.task}
                    >
                      <AppText numberOfLines={1}>{task.title}</AppText>
                      <AppText variant="bodySmall" color="onSurfaceVariant">
                        {status}
                      </AppText>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  panel: { position: 'absolute', top: 0, bottom: 0, start: 0, width: drawerWidth, maxWidth: '85%', borderTopEndRadius: radius.lg, borderBottomEndRadius: radius.lg, overflow: 'hidden' },
  top: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingStart: spacing.md, paddingEnd: spacing.xs },
  list: { paddingHorizontal: spacing.sm, paddingBottom: spacing.lg, gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget, paddingHorizontal: spacing.md, borderRadius: radius.md, borderCurve: 'continuous', overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.sm, marginHorizontal: spacing.md },
  heading: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  task: { justifyContent: 'center', minHeight: touchTarget + spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.md, overflow: 'hidden' },
});
