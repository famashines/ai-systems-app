import { useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';

import { LiveBar } from '@/components/live-bar';
import { AppText, Button, Screen, StateView } from '@/components/ui';
import type { Key } from '@/i18n';
import { useLive, type Message } from '@/state/live';
import { useSettings } from '@/state/settings';
import { radius, spacing, touchTarget, type } from '@/theme';

function statusKey(message: Message, received: boolean): Key {
  if (received) return 'chat.received';
  if (message.state === 'failed') return 'chat.failed';
  if (message.state === 'rejected') return 'chat.rejected';
  if (message.state === 'waiting') return 'chat.waiting';
  return message.slow ? 'chat.slow' : 'chat.sending';
}

function Row({ message }: { message: Message }) {
  const { t, colors } = useSettings();
  const { known, retry, online } = useLive();
  const status = t(statusKey(message, known(message.taskId)));
  const bad = message.state === 'failed' || message.state === 'rejected';
  return (
    <View style={[styles.message, { backgroundColor: colors.surfaceContainer }]}>
      <View accessible accessibilityLabel={t('chat.message', { text: message.text, status })}>
        <AppText>{message.text}</AppText>
        <AppText variant="bodySmall" color={bad ? 'error' : 'onSurfaceVariant'}>
          {status}
        </AppText>
      </View>
      {message.state === 'failed' ? <Button label={t('chat.retry')} variant="tonal" disabled={!online} onPress={() => retry(message.key)} /> : null}
    </View>
  );
}

export default function Chat() {
  const { t, colors } = useSettings();
  const { messages, online, send } = useLive();
  const [text, setText] = useState('');

  const submit = () => {
    send(text);
    setText('');
  };

  return (
    <Screen title={t('tabs.chat')}>
      <LiveBar />
      {messages.length === 0 ? (
        <StateView kind="empty" title={t('chat.empty')} />
      ) : (
        <FlatList
          accessibilityLabel={t('chat.messages')}
          data={messages}
          keyExtractor={(message) => message.key}
          renderItem={({ item }) => <Row message={item} />}
          contentContainerStyle={styles.list}
        />
      )}
      <View style={styles.composer}>
        {online ? null : (
          <AppText variant="bodySmall" color="onSurfaceVariant" accessibilityLiveRegion="polite">
            {t('chat.offline')}
          </AppText>
        )}
        <View style={styles.row}>
          <TextInput
            testID="chat-input"
            value={text}
            onChangeText={setText}
            editable={online}
            accessibilityLabel={t('chat.inputLabel')}
            accessibilityHint={online ? undefined : t('chat.offline')}
            accessibilityState={{ disabled: !online }}
            placeholder={t('chat.placeholder')}
            placeholderTextColor={colors.onSurfaceVariant}
            onSubmitEditing={submit}
            style={[styles.input, type.body, { color: colors.onSurface, borderColor: colors.outline, backgroundColor: colors.surfaceContainer }]}
          />
          <Button label={t('chat.send')} onPress={submit} disabled={!online || !text.trim()} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm, paddingBottom: spacing.sm },
  message: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg },
  composer: { gap: spacing.sm, paddingBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: { flex: 1, minHeight: touchTarget, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.md, textAlign: 'auto' },
});
