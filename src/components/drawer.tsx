import { router } from 'expo-router';
import { useState, useSyncExternalStore } from 'react';
import { Animated, I18nManager, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, Icon, IconButton, Mark, type IconName } from '@/components/ui';
import type { Key } from '@/i18n';
import { direct } from '@/lib/direct';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { drawerWidth, mark, motion, radius, spacing, touchTarget } from '@/theme';

export type Section = '/' | '/budget' | '/settings';

const sections: [Exclude<Section, '/'>, Key, IconName][] = [
  ['/budget', 'tabs.budget', { ios: 'dollarsign.circle', android: 'savings', web: 'savings' }],
  ['/settings', 'tabs.settings', { ios: 'gearshape', android: 'settings', web: 'settings' }],
];

export function Menu({ current }: { current: Section }) {
  const { t, colors } = useSettings();
  const { locked } = useSession();
  const chat = useSyncExternalStore(direct.subscribe, direct.get);
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
  const go = (href: Section) => {
    close();
    router.navigate(href);
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
              <Mark size={mark.small} />
              <AppText variant="title" accessibilityRole="header" style={styles.name}>
                {t('app.name')}
              </AppText>
              <IconButton icon={{ ios: 'xmark', android: 'close', web: 'close' }} label={t('drawer.close')} onPress={close} />
            </View>
            <View style={styles.block}>
              <Pressable
                testID="drawer-new-chat"
                accessibilityRole="button"
                accessibilityLabel={t('chat.newChat')}
                onPress={() => {
                  direct.clear();
                  go('/');
                }}
                android_ripple={{ color: colors.outlineVariant }}
                style={[styles.row, { backgroundColor: colors.primaryContainer }]}
              >
                <Icon name={{ ios: 'square.and.pencil', android: 'edit_square', web: 'edit_square' }} color="onPrimaryContainer" />
                <AppText variant="label" color="onPrimaryContainer">
                  {t('chat.newChat')}
                </AppText>
              </Pressable>
            </View>
            <AppText variant="bodySmall" color="onSurfaceVariant" accessibilityRole="header" style={styles.heading}>
              {t('drawer.chats')}
            </AppText>
            <ScrollView style={styles.fill} contentContainerStyle={styles.block}>
              {chat.history.length === 0 ? (
                <AppText variant="bodySmall" color="onSurfaceVariant" style={styles.none}>
                  {t('drawer.noChats')}
                </AppText>
              ) : (
                chat.history.map((item) => {
                  const selected = current === '/' && item.chatId === chat.chatId;
                  return (
                    <View key={item.chatId} style={[styles.chat, { backgroundColor: selected ? colors.surfaceContainerHigh : 'transparent' }]}>
                      <Pressable
                        testID={`drawer-chat-${item.chatId}`}
                        accessibilityRole="button"
                        accessibilityLabel={t('drawer.chat', { title: item.title })}
                        accessibilityState={{ selected }}
                        onPress={() => {
                          void direct.open(item.chatId);
                          go('/');
                        }}
                        android_ripple={{ color: colors.outlineVariant }}
                        style={styles.chatTitle}
                      >
                        <AppText numberOfLines={1}>{item.title}</AppText>
                      </Pressable>
                      <IconButton
                        testID={`drawer-chat-delete-${item.chatId}`}
                        icon={{ ios: 'trash', android: 'delete', web: 'delete' }}
                        label={t('drawer.chatDelete', { title: item.title })}
                        onPress={() => direct.remove(item.chatId)}
                      />
                    </View>
                  );
                })
              )}
            </ScrollView>
            <View style={[styles.block, styles.foot, { borderColor: colors.outlineVariant }]}>
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
                    <Icon name={icon} color="onSurfaceVariant" />
                    <AppText variant="label">{t(key)}</AppText>
                  </Pressable>
                );
              })}
            </View>
          </SafeAreaView>
        </Animated.View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  panel: { position: 'absolute', top: 0, bottom: 0, start: 0, width: drawerWidth, maxWidth: '85%', borderTopEndRadius: radius.md, borderBottomEndRadius: radius.md, overflow: 'hidden' },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56, paddingStart: spacing.md, paddingEnd: spacing.xs },
  name: { flex: 1 },
  block: { paddingHorizontal: spacing.sm, gap: spacing.xs },
  foot: { paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth * 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget, paddingHorizontal: spacing.md, borderRadius: radius.md, borderCurve: 'continuous', overflow: 'hidden' },
  heading: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xs },
  none: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chat: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, borderCurve: 'continuous', overflow: 'hidden' },
  chatTitle: { flex: 1, justifyContent: 'center', minHeight: touchTarget, paddingHorizontal: spacing.md },
});
