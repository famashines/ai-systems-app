import { router } from 'expo-router';
import { useState, useSyncExternalStore } from 'react';
import { Animated, I18nManager, Keyboard, Modal, PanResponder, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { askDelete } from '@/components/chat-menu';
import { AppText, Icon, IconButton, Mark, useStill, type IconName } from '@/components/ui';
import type { Key } from '@/i18n';
import { direct, type ChatSummary } from '@/lib/direct';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { drawerWidth, ease, headerHeight, mark, motion, radius, spacing, touchTarget } from '@/theme';

type Section = '/budget' | '/settings';

const swipeWidth = 80;
const swipeSlop = 8;
const swipeSpeed = 0.5;
const swipeDrag = 4;
let openRow: (() => void) | null = null;

const sections: [Section, Key, IconName][] = [
  ['/budget', 'tabs.budget', { ios: 'dollarsign.circle', android: 'savings', web: 'savings' }],
  ['/settings', 'tabs.settings', { ios: 'gearshape', android: 'settings', web: 'settings' }],
];

function Heading({ label }: { label: string }) {
  return (
    <AppText variant="bodySmall" color="onSurfaceVariant" accessibilityRole="header" style={styles.heading}>
      {label}
    </AppText>
  );
}

function ChatRow({ item, selected, onOpen }: { item: ChatSummary; selected: boolean; onOpen: () => void }) {
  const { t, colors } = useSettings();
  const [x] = useState(() => new Animated.Value(0));
  const [shown, setShown] = useState(false);
  const [swipe] = useState(() => {
    const toward = I18nManager.isRTL ? 1 : -1;
    let open = false;
    const shut = () => settle(false);
    const settle = (next: boolean) => {
      open = next;
      if (next && openRow !== shut) openRow?.();
      if (next) openRow = shut;
      else if (openRow === shut) openRow = null;
      setShown(next);
      Animated.spring(x, { toValue: next ? toward * swipeWidth : 0, useNativeDriver: true, bounciness: 0 }).start();
    };
    const pulled = (dx: number) => {
      const raw = Math.max(0, (open ? swipeWidth : 0) + dx * toward);
      return raw > swipeWidth ? swipeWidth + (raw - swipeWidth) / swipeDrag : raw;
    };
    const responder = PanResponder.create({
      onMoveShouldSetPanResponder: (_event, { dx, dy }) => Math.abs(dx) > swipeSlop && Math.abs(dx) > Math.abs(dy) * 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_event, { dx }) => x.setValue(pulled(dx) * toward),
      onPanResponderRelease: (_event, { dx, vx }) => settle(Math.min(swipeWidth, pulled(dx)) > swipeWidth / 2 || vx * toward > swipeSpeed),
      onPanResponderTerminate: () => settle(open),
    });
    return { handlers: responder.panHandlers, settle, isOpen: () => open };
  });
  const remove = () => {
    swipe.settle(false);
    askDelete(t, item.chatId);
  };
  const deleteLabel = t('drawer.chatDelete', { title: item.title });

  return (
    <View style={styles.chat}>
      <Pressable
        testID={`drawer-chat-delete-${item.chatId}`}
        accessibilityRole="button"
        accessibilityLabel={deleteLabel}
        accessibilityElementsHidden={!shown}
        importantForAccessibility={shown ? 'yes' : 'no-hide-descendants'}
        onPress={remove}
        style={[styles.swipeDelete, { backgroundColor: colors.error }]}
      >
        <Icon name={{ ios: 'trash', android: 'delete', web: 'delete' }} color="onError" />
      </Pressable>
      <Animated.View {...swipe.handlers} style={[styles.chatFace, { backgroundColor: selected ? colors.surfaceContainerHigh : colors.surface, transform: [{ translateX: x }] }]}>
        <Pressable
          testID={`drawer-chat-${item.chatId}`}
          accessibilityRole="button"
          accessibilityLabel={t('drawer.chat', { title: item.title })}
          accessibilityState={{ selected }}
          accessibilityActions={[{ name: 'delete', label: deleteLabel }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'delete') remove();
          }}
          onPress={() => (swipe.isOpen() ? swipe.settle(false) : onOpen())}
          android_ripple={{ color: colors.outlineVariant }}
          style={styles.chatTitle}
        >
          <AppText numberOfLines={1}>{item.title}</AppText>
        </Pressable>
      </Animated.View>
    </View>
  );
}

export function Back() {
  const { t } = useSettings();
  const icon: IconName = I18nManager.isRTL ? { ios: 'chevron.right', android: 'arrow_forward', web: 'arrow_forward' } : { ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' };
  return <IconButton testID="back" icon={icon} label={t('common.back')} onPress={() => router.navigate('/')} />;
}

export function Menu() {
  const { t, colors } = useSettings();
  const { locked } = useSession();
  const chat = useSyncExternalStore(direct.subscribe, direct.get);
  const [open, setOpen] = useState(false);
  if (open && locked) setOpen(false);
  const [progress] = useState(() => new Animated.Value(0));
  const still = useStill();
  const side = I18nManager.isRTL ? 1 : -1;
  const groups: [Key, ChatSummary[]][] = [
    ['drawer.bookmarks', chat.history.filter((item) => item.bookmarked)],
    ['drawer.chats', chat.history.filter((item) => !item.bookmarked)],
  ];

  const show = () => {
    Keyboard.dismiss();
    progress.setValue(0);
    setOpen(true);
    Animated.timing(progress, { toValue: 1, duration: motion.open, easing: ease.drawer, useNativeDriver: true }).start();
  };
  const close = () =>
    Animated.timing(progress, { toValue: 0, duration: motion.close, easing: ease.out, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setOpen(false);
    });
  const go = (href: '/' | Section) => {
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
            { backgroundColor: colors.surface },
            still ? { opacity: progress } : { transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [side * drawerWidth, 0] }) }] },
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
            <ScrollView style={styles.fill} contentContainerStyle={styles.block}>
              {chat.history.length === 0 ? (
                <>
                  <Heading label={t('drawer.chats')} />
                  <AppText variant="bodySmall" color="onSurfaceVariant" style={styles.none}>
                    {t('drawer.noChats')}
                  </AppText>
                </>
              ) : (
                groups.map(([key, items]) =>
                  items.length === 0 ? null : (
                    <View key={key} style={styles.group}>
                      <Heading label={t(key)} />
                      {items.map((item) => (
                        <ChatRow
                          key={item.chatId}
                          item={item}
                          selected={item.chatId === chat.chatId}
                          onOpen={() => {
                            void direct.open(item.chatId);
                            go('/');
                          }}
                        />
                      ))}
                    </View>
                  ),
                )
              )}
            </ScrollView>
            <View style={[styles.block, styles.foot, { borderColor: colors.outlineVariant }]}>
              {sections.map(([href, key, icon]) => (
                <Pressable
                  key={href}
                  testID={`drawer-${href}`}
                  accessibilityRole="button"
                  accessibilityLabel={t(key)}
                  onPress={() => go(href)}
                  android_ripple={{ color: colors.outlineVariant }}
                  style={styles.row}
                >
                  <Icon name={icon} color="onSurfaceVariant" />
                  <AppText variant="label">{t(key)}</AppText>
                </Pressable>
              ))}
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
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: headerHeight, paddingStart: spacing.md, paddingEnd: spacing.xs },
  name: { flex: 1 },
  block: { paddingHorizontal: spacing.sm, gap: spacing.xs },
  foot: { paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth * 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget, paddingHorizontal: spacing.md, borderRadius: radius.md, overflow: 'hidden' },
  heading: { paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.xs },
  none: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  group: { gap: spacing.xs },
  chat: { borderRadius: radius.md, overflow: 'hidden' },
  chatFace: { borderRadius: radius.md, overflow: 'hidden' },
  chatTitle: { justifyContent: 'center', minHeight: touchTarget, paddingHorizontal: spacing.md },
  swipeDelete: { position: 'absolute', top: 0, bottom: 0, end: 0, width: swipeWidth, alignItems: 'center', justifyContent: 'center' },
});
