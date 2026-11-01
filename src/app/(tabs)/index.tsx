import type { TaskDetailV1 } from '@famashines/ai-systems-contracts';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { LiveBar } from '@/components/live-bar';
import { PlanActions, PlanSummary } from '@/components/task';
import { AppText, Button, Screen, StateView } from '@/components/ui';
import type { Key } from '@/i18n';
import { taskTextMax } from '@/lib/api';
import type { ChatMessage } from '@/lib/chat';
import { formatUsd } from '@/lib/money';
import { endedStatuses } from '@/lib/task';
import { useLive, type Message, type StreamRow } from '@/state/live';
import { useSettings } from '@/state/settings';
import { radius, spacing, touchTarget, type } from '@/theme';

type Row = { kind: 'pending'; message: Message } | { kind: 'plan'; detail: TaskDetailV1 } | { kind: 'stream'; stream: StreamRow } | { kind: 'message'; message: ChatMessage };
type Reply = (taskId: string) => void;

const openTask = (taskId: string, edit = false) => router.push({ pathname: '/task/[id]', params: edit ? { id: taskId, edit: '1' } : { id: taskId } });

function PlanCard({ detail, onReply }: { detail: TaskDetailV1; onReply: Reply }) {
  const { t, colors } = useSettings();
  const plan = detail.plan;
  if (!plan) return null;
  return (
    <View testID={`plan-${detail.taskId}`} style={[styles.message, styles.plan, { backgroundColor: colors.surfaceContainer }]}>
      <AppText variant="label" accessibilityRole="header">
        {t('plan.preview', { title: detail.title, version: String(plan.planVersion) })}
      </AppText>
      <PlanSummary subtasks={plan.subtasks} />
      <PlanActions detail={detail} onEdit={() => openTask(detail.taskId, true)} />
      <View style={styles.actions}>
        <Button label={t('chat.openTask')} variant="tonal" onPress={() => openTask(detail.taskId)} />
        <Button label={t('chat.replyTo')} variant="tonal" onPress={() => onReply(detail.taskId)} />
      </View>
    </View>
  );
}

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

function Posted({ message, onReply }: { message: ChatMessage; onReply: Reply }) {
  const { t, colors, language } = useSettings();
  const { tasks, details } = useLive();
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
  const status = details[message.taskId]?.status ?? tasks.find((item) => item.taskId === message.taskId)?.status;
  return (
    <View testID={`reply-${message.messageId}`} style={[styles.message, { backgroundColor: colors.surfaceContainer }]}>
      <View
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={cost === null ? t('chat.reply', { text: message.text }) : t('chat.replyCost', { text: message.text, cost })}
        style={styles.body}
      >
        <AppText>{message.text}</AppText>
        {cost === null ? null : (
          <AppText variant="bodySmall" color="onSurfaceVariant">
            {t('chat.cost', { cost })}
          </AppText>
        )}
      </View>
      {status === undefined || endedStatuses.has(status) ? null : (
        <View style={styles.actions}>
          <Button label={t('chat.replyTo')} variant="tonal" onPress={() => onReply(message.taskId)} />
          <Button label={t('chat.openTask')} variant="tonal" onPress={() => openTask(message.taskId)} />
        </View>
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

function Thread({ onReply }: { onReply: Reply }) {
  const { t } = useSettings();
  const { pending, streams, thread, threadLoad, threadLoaded, reloadThread, loadOlder, details } = useLive();
  const planned = [...new Set(thread.map((message) => message.taskId).filter((taskId): taskId is string => taskId !== undefined))]
    .map((taskId) => details[taskId])
    .filter((detail): detail is TaskDetailV1 => detail?.status === 'awaiting_approval' && detail.plan !== undefined);
  const rows: Row[] = [
    ...pending.map((message): Row => ({ kind: 'pending', message })),
    ...planned.map((detail): Row => ({ kind: 'plan', detail })),
    ...streams.map((stream): Row => ({ kind: 'stream', stream })),
    ...thread.map((message): Row => ({ kind: 'message', message })),
  ];
  if (rows.length === 0) {
    if (threadLoad === 'error') return <StateView kind="error" title={t('chat.error')} retryLabel={t('common.retry')} onRetry={reloadThread} />;
    if (threadLoad === 'loading' && !threadLoaded) return <StateView kind="loading" title={t('chat.loading')} />;
    return <StateView kind="empty" title={t('chat.empty')} />;
  }
  return (
    <>
      {threadLoad === 'error' ? <StateView kind="error" title={t('chat.error')} retryLabel={t('common.retry')} onRetry={reloadThread} /> : null}
      <FlatList
        testID="chat-list"
        inverted
        accessibilityLabel={t('chat.messages')}
        data={rows}
        keyExtractor={(row) =>
          row.kind === 'pending' ? `pending-${row.message.key}` : row.kind === 'plan' ? `plan-${row.detail.taskId}` : row.kind === 'stream' ? `stream-${row.stream.taskId}` : row.message.messageId
        }
        renderItem={({ item }) =>
          item.kind === 'pending' ? (
            <Pending message={item.message} />
          ) : item.kind === 'plan' ? (
            <PlanCard detail={item.detail} onReply={onReply} />
          ) : item.kind === 'stream' ? (
            <Stream stream={item.stream} />
          ) : (
            <Posted message={item.message} onReply={onReply} />
          )
        }
        onEndReached={loadOlder}
        onEndReachedThreshold={0.5}
        ListFooterComponent={Older}
        contentContainerStyle={styles.list}
      />
    </>
  );
}

export default function Chat() {
  const { t, colors } = useSettings();
  const { online, send, tasks, details } = useLive();
  const [text, setText] = useState('');
  const [newTask, setNewTask] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const replyTitle = replyTo ? (details[replyTo]?.title ?? tasks.find((item) => item.taskId === replyTo)?.title ?? t('task.title')) : null;

  const submit = () => {
    if (!online || !text.trim()) return;
    send(text, newTask, replyTo ?? undefined);
    setText('');
    setNewTask(false);
    setReplyTo(null);
  };
  const reply = (taskId: string) => {
    setReplyTo(taskId);
    setNewTask(false);
  };

  return (
    <Screen title={t('tabs.chat')}>
      <LiveBar />
      <Thread onReply={reply} />
      <View style={styles.composer}>
        {online ? null : (
          <AppText variant="bodySmall" color="onSurfaceVariant" accessibilityLiveRegion="polite">
            {t('chat.offline')}
          </AppText>
        )}
        {replyTitle ? (
          <View style={styles.row}>
            <AppText variant="bodySmall" color="onSurfaceVariant" accessibilityLiveRegion="polite" style={styles.shrink}>
              {t('chat.replyingTo', { title: replyTitle })}
            </AppText>
            <Button label={t('chat.replyCancel')} variant="tonal" onPress={() => setReplyTo(null)} />
          </View>
        ) : null}
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
            accessibilityState={{ checked: newTask, disabled: !online || replyTo !== null }}
            disabled={!online || replyTo !== null}
            onPress={() => setNewTask((on) => !on)}
            android_ripple={{ color: colors.outlineVariant }}
            style={[styles.toggle, { borderColor: colors.outline, backgroundColor: newTask ? colors.primaryContainer : 'transparent', opacity: online && replyTo === null ? 1 : 0.38 }]}
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
  plan: { maxWidth: '100%', alignSelf: 'stretch' },
  body: { gap: spacing.sm },
  shrink: { flexShrink: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  older: { padding: spacing.md },
  composer: { gap: spacing.sm, paddingBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  toggle: { minHeight: touchTarget, minWidth: touchTarget, justifyContent: 'center', paddingHorizontal: spacing.md, borderWidth: 1, borderRadius: radius.full },
  input: { flex: 1, minHeight: touchTarget, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.md, textAlign: 'auto' },
});
