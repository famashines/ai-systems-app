import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, Icon, IconButton, type IconName } from '@/components/ui';
import { direct, titleMax, type ChatSummary } from '@/lib/direct';
import { useSettings } from '@/state/settings';
import { headerHeight, radius, readingWidth, shadow, spacing, touchTarget, type } from '@/theme';

function Item({ icon, label, danger = false, onPress }: { icon: IconName; label: string; danger?: boolean; onPress: () => void }) {
  const { colors } = useSettings();
  return (
    <Pressable accessibilityRole="menuitem" accessibilityLabel={label} onPress={onPress} android_ripple={{ color: colors.outlineVariant }} style={styles.item}>
      <Icon name={icon} color={danger ? 'error' : 'onSurfaceVariant'} size={20} />
      <AppText color={danger ? 'error' : 'onSurface'}>{label}</AppText>
    </Pressable>
  );
}

function RenameDialog({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  const { t, colors } = useSettings();
  const [name, setName] = useState(chat.title);
  const ok = name.trim() !== '';
  const save = () => {
    if (!ok) return;
    direct.rename(chat.chatId, name);
    onClose();
  };
  return (
    <Modal testID="rename-dialog" visible transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <Pressable accessible={false} importantForAccessibility="no" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} />
      <KeyboardAvoidingView behavior="padding" pointerEvents="box-none" style={styles.center}>
        <View accessibilityViewIsModal style={[styles.dialog, { backgroundColor: colors.surfaceContainerHigh }]}>
          <AppText variant="title" accessibilityRole="header">
            {t('chat.renameTitle')}
          </AppText>
          <TextInput
            testID="rename-input"
            value={name}
            onChangeText={setName}
            onSubmitEditing={save}
            autoFocus
            selectTextOnFocus
            maxLength={titleMax}
            returnKeyType="done"
            accessibilityLabel={t('chat.renameLabel')}
            placeholder={t('chat.renameLabel')}
            placeholderTextColor={colors.onSurfaceVariant}
            style={[styles.field, type.body, { color: colors.onSurface, backgroundColor: colors.surfaceContainer }]}
          />
          <View style={styles.actions}>
            <Button label={t('common.cancel')} variant="outline" onPress={onClose} />
            <Button label={t('common.save')} disabled={!ok} onPress={save} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function ChatMenu({ chat }: { chat: ChatSummary }) {
  const { t, colors } = useSettings();
  const { top } = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const close = () => setOpen(false);
  const confirmDelete = () => {
    close();
    Alert.alert(t('chat.deleteTitle'), t('chat.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('chat.delete'), style: 'destructive', onPress: () => direct.remove(chat.chatId) },
    ]);
  };

  return (
    <>
      <IconButton testID="chat-menu" icon={{ ios: 'ellipsis', android: 'more_vert', web: 'more_vert' }} label={t('chat.more')} onPress={() => setOpen(true)} />
      <Modal testID="chat-menu-panel" visible={open} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
        <Pressable accessible={false} importantForAccessibility="no" onPress={close} style={StyleSheet.absoluteFill} />
        <View accessibilityRole="menu" accessibilityViewIsModal style={[styles.menu, { top: top + headerHeight, backgroundColor: colors.surfaceContainerHigh }]}>
          <AppText variant="bodySmall" color="onSurfaceVariant" numberOfLines={1} style={styles.heading}>
            {chat.title}
          </AppText>
          <Item
            icon={chat.bookmarked ? { ios: 'bookmark.slash', android: 'bookmark_remove', web: 'bookmark_remove' } : { ios: 'bookmark', android: 'bookmark', web: 'bookmark' }}
            label={t(chat.bookmarked ? 'chat.unbookmark' : 'chat.bookmark')}
            onPress={() => {
              direct.bookmark(chat.chatId);
              close();
            }}
          />
          <Item
            icon={{ ios: 'pencil', android: 'edit', web: 'edit' }}
            label={t('chat.rename')}
            onPress={() => {
              close();
              setRenaming(true);
            }}
          />
          <Item icon={{ ios: 'trash', android: 'delete', web: 'delete' }} label={t('chat.delete')} danger onPress={confirmDelete} />
        </View>
      </Modal>
      {renaming ? <RenameDialog chat={chat} onClose={() => setRenaming(false)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  menu: { position: 'absolute', end: spacing.sm, minWidth: 220, maxWidth: 280, paddingVertical: spacing.xs, borderRadius: radius.md, boxShadow: shadow.menu, overflow: 'hidden' },
  heading: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget, paddingHorizontal: spacing.md },
  center: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  dialog: { width: '100%', maxWidth: readingWidth / 2, alignSelf: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.md },
  field: { minHeight: touchTarget, paddingHorizontal: spacing.md, borderRadius: radius.field, textAlign: 'auto' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});
