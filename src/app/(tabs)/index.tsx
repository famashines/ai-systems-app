import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { LiveBar } from '@/components/live-bar';
import { AppText, Button, Screen, StateView } from '@/components/ui';
import type { Key } from '@/i18n';
import { taskTextMax } from '@/lib/api';
import type { ChatMessage } from '@/lib/chat';
import { formatUsd } from '@/lib/money';
import { useLive, type Message, type StreamRow } from '@/state/live';
import { useSettings } from '@/state/settings';
import { radius, spacing, touchTarget, type } from '@/theme';

type Row = { kind: 'pending'; message: Message } | { kind: 'stream'; stream: StreamRow } | { kind: 'message'; message: ChatMessage };

function statusKey(message: Message): Key {
  if (message.state === 'failed') return 'chat.failed';
  if (message.state === 'rejected') return 'chat.rejected';
  if (message.state === 'waiting') return 'chat.waiting';
  return message.slow ? 'chat.slow' : 'chat.sending';
}

function Pending({ message }: { message: Message }) {
  const { t, colors } = useSettings();
  const { retry, online } = useLive();
  const status = t(statusKey(message));
  const bad = message.state === 'failed' || message.state === 'rejected';
  return (
    <View style={[styles.message, styles.owner, { backgroundColor: colors.primaryContainer }]}>
      <View accessible accessibilityLiveRegion="polite" accessibilityLabel={t('chat.message', { text: message.text, status })}>
        <AppText color="onPrimaryContainer">{message.text}</AppText>
        <AppText variant="bodySmall" color={bad ? 'error' : 'onPrimaryContainer'}>
          {status}
        </AppText>
      </View>
      {message.state === 'failed' ? <Button label={t('chat.retry')} variant="tonal" disabled={!online} onPress={() => retry(message.key)} /> : null}
    </View>
  );
}

function Stream({ stream }: { stream: StreamRow }) {
  const { t, colors } = useSettings();
  return (
    <View testID={`stream-${stream.taskId}`} accessible accessibilityLabel={t('chat.stream', { text: stream.text })} style={[styles.message, { backgroundColor: colors.surfaceContainer }]}>
      <AppText>{stream.text}</AppText>
      <AppText variant="bodySmall" color="onSurfaceVariant">
        {t('chat.writing')}
      </AppText>
    </View>
  );
}

function Posted({ message }: { message: ChatMessage }) {
  const { t, colors, language } = useSettings();
  if (message.role === 'owner') {
    const status = t('chat.received');
    return (
      <View accessible accessibilityLabel={t('chat.message', { text: message.text, status })} style={[styles.message, styles.owner, { backgroundColor: colors.primaryContainer }]}>
        <AppText color="onPrimaryContainer">{message.text}</AppText>
        <AppText variant="bodySmall" color="onPrimaryContainer">
          {status}
        </AppText>
      </View>
    );
  }
  const cost = message.costMicroUsd === undefined ? null : formatUsd(language, message.costMicroUsd);
  return (
    <View
      testID={`reply-${message.messageId}`}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={cost === null ? t('chat.reply', { text: message.text }) : t('chat.replyCost', { text: message.text, cost })}
      style={[styles.message, { backgroundColor: colors.surfaceContainer }]}
    >
      <AppText>{message.text}</AppText>
      {cost === null ? null : (
        <AppText variant="bodySmall" color="onSurfaceVariant">
          {t('chat.cost', { cost })}
        </AppText>
      )}
    </View>
  );
}

function Older() {
  const { t, colors } = useSettings();
  const { threadMore, loadOlder } = useLive();
  if (threadMore === 'loading') return <ActivityIndicator style={styles.older} color={colors.primary} accessibilityLabel={t('chat.loadingMore')} />;
  if (threadMore === 'error') return <StateView kind="error" title={t('chat.moreError')} retryLabel={t('common.retry')} onRetry={loadOlder} />;
  return null;
}

function Thread() {
  const { t } = useSettings();
  const { pending, streams, thread, threadLoad, threadLoaded, reloadThread, loadOlder } = useLive();
  const rows: Row[] = [
    ...pending.map((message): Row => ({ kind: 'pending', message })),
    ...streams.map((stream): Row => ({ kind: 'stream', stream })),
    ...thread.map((message): Row => ({ kind: 'message', message })),
  ];
  if (rows.length === 0) {
    if (threadLoad === 'error') return <StateView kind="error" title={t('chat.error')} retryLabel={t('common.retry')} onRetry={reloadThread} />;
    if (threadLoad === 'loading' && !threadLoaded) return <StateView kind="loading" title={t('chat.loading')} />;
    return <StateView kind="empty" title={t('chat.empty')} />;
  }
  return (
    <FlatList
      testID="chat-list"
      inverted
      accessibilityLabel={t('chat.messages')}
      data={rows}
      keyExtractor={(row) => (row.kind === 'pending' ? `pending-${row.message.key}` : row.kind === 'stream' ? `stream-${row.stream.taskId}` : row.message.messageId)}
      renderItem={({ item }) => (item.kind === 'pending' ? <Pending message={item.message} /> : item.kind === 'stream' ? <Stream stream={item.stream} /> : <Posted message={item.message} />)}
      onEndReached={loadOlder}
      onEndReachedThreshold={0.5}
      ListFooterComponent={Older}
      contentContainerStyle={styles.list}
    />
  );
}

export default function Chat() {
  const { t, colors } = useSettings();
  const { online, send } = useLive();
  const [text, setText] = useState('');
  const [newTask, setNewTask] = useState(false);

  const submit = () => {
    if (!online || !text.trim()) return;
    send(text, newTask);
    setText('');
    setNewTask(false);
  };

  return (
    <Screen title={t('tabs.chat')}>
      <LiveBar />
      <Thread />
      <View style={styles.composer}>
        {online ? null : (
          <AppText variant="bodySmall" color="onSurfaceVariant" accessibilityLiveRegion="polite">
            {t('chat.offline')}
          </AppText>
        )}
        {newTask ? (
          <AppText variant="bodySmall" color="onSurfaceVariant" accessibilityLiveRegion="polite">
            {t('chat.newTaskOn')}
          </AppText>
        ) : null}
        <View style={styles.row}>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel={t('chat.newTask')}
            accessibilityHint={t('chat.newTaskHint')}
            accessibilityState={{ checked: newTask, disabled: !online }}
            disabled={!online}
            onPress={() => setNewTask((on) => !on)}
            android_ripple={{ color: colors.outlineVariant }}
            style={[styles.toggle, { borderColor: colors.outline, backgroundColor: newTask ? colors.primaryContainer : 'transparent', opacity: online ? 1 : 0.38 }]}
          >
            <AppText variant="label" color={newTask ? 'onPrimaryContainer' : 'onSurface'}>
              {t('chat.newTask')}
            </AppText>
          </Pressable>
          <TextInput
            testID="chat-input"
            value={text}
            onChangeText={setText}
            editable={online}
            maxLength={taskTextMax}
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
  message: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, maxWidth: '88%', alignSelf: 'flex-start' },
  owner: { alignSelf: 'flex-end' },
  older: { padding: spacing.md },
  composer: { gap: spacing.sm, paddingBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  toggle: { minHeight: touchTarget, minWidth: touchTarget, justifyContent: 'center', paddingHorizontal: spacing.md, borderWidth: 1, borderRadius: radius.full },
  input: { flex: 1, minHeight: touchTarget, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.md, textAlign: 'auto' },
});
