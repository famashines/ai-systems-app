import type { TaskDetailV1 } from '@famashines/ai-systems-contracts';
import { router } from 'expo-router';
import { useRef, useState, useSyncExternalStore, type ComponentRef } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Menu } from '@/components/drawer';
import { LiveBar } from '@/components/live-bar';
import { CopyButton, Markdown } from '@/components/markdown';
import { ModelPicker, useChoice } from '@/components/model-picker';
import { PlanActions, PlanSummary } from '@/components/task';
import { AppText, Button, Card, Icon, IconButton, Screen, StateView } from '@/components/ui';
import type { Key } from '@/i18n';
import { taskTextMax } from '@/lib/api';
import type { ChatMessage } from '@/lib/chat';
import { direct, type DirectError, type DirectMessage } from '@/lib/direct';
import { formatUsd } from '@/lib/money';
import { canReply, endedStatuses } from '@/lib/task';
import { useLive, type Message, type StreamRow } from '@/state/live';
import { useSettings } from '@/state/settings';
import { radius, shadow, spacing, touchTarget, type } from '@/theme';

type Row =
  | { kind: 'pending'; message: Message }
  | { kind: 'plan'; detail: TaskDetailV1 }
  | { kind: 'stream'; stream: StreamRow }
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'direct'; message: DirectMessage; last: boolean };
type Reply = (taskId: string) => void;

const awayOffset = 240;

const openTask = (taskId: string, edit = false) => router.push({ pathname: '/task/[id]', params: edit ? { id: taskId, edit: '1' } : { id: taskId } });

function PlanCard({ detail }: { detail: TaskDetailV1 }) {
  const { t } = useSettings();
  const plan = detail.plan;
  if (!plan) return null;
  return (
    <Card testID={`plan-${detail.taskId}`}>
      <AppText variant="label" accessibilityRole="header">
        {t('plan.preview', { title: detail.title, version: String(plan.planVersion) })}
      </AppText>
      <PlanSummary subtasks={plan.subtasks} />
      <PlanActions detail={detail} onEdit={() => openTask(detail.taskId, true)} />
      <View style={styles.actions}>
        <Button label={t('chat.openTask')} variant="outline" onPress={() => openTask(detail.taskId)} />
      </View>
    </Card>
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
    <View style={[styles.owner, { backgroundColor: colors.surfaceContainerHigh }]}>
      <View accessible accessibilityLiveRegion="polite" accessibilityLabel={t('chat.message', { text: message.text, status })} style={styles.body}>
        <AppText>{message.text}</AppText>
        <AppText variant="bodySmall" color={bad ? 'error' : 'onSurfaceVariant'}>
          {status}
        </AppText>
      </View>
      {message.state === 'failed' ? <Button label={t('chat.retry')} variant="outline" disabled={!online} onPress={() => retry(message.key)} /> : null}
    </View>
  );
}

const errorKeys: Record<DirectError, Key> = {
  network: 'chat.errorNetwork',
  unauthorized: 'chat.errorUnauthorized',
  rateLimited: 'chat.errorRateLimited',
  budget: 'chat.errorBudget',
  tooLong: 'chat.errorTooLong',
  failed: 'chat.errorFailed',
};

function Direct({ message, last }: { message: DirectMessage; last: boolean }) {
  const { t, colors, language } = useSettings();
  const { online } = useLive();
  const choice = useChoice();
  if (message.role === 'user') {
    return (
      <View testID={`direct-${message.id}`} style={styles.mine}>
        <View accessible accessibilityLabel={t('chat.you', { text: message.text })} style={[styles.owner, styles.body, { backgroundColor: colors.surfaceContainerHigh }]}>
          <AppText selectable>{message.text}</AppText>
        </View>
        <CopyButton text={message.text} label={t('chat.copy')} />
      </View>
    );
  }
  const streaming = message.state === 'streaming';
  const again = last && !streaming && online && choice.model !== undefined;
  return (
    <View testID={`direct-${message.id}`} style={styles.agent}>
      {message.text ? (
        <View accessibilityLabel={streaming ? undefined : t('chat.answer', { text: message.text })}>
          <Markdown text={message.text} />
        </View>
      ) : null}
      {streaming ? (
        <AppText variant="bodySmall" color="onSurfaceVariant" accessibilityLiveRegion="polite">
          {t('chat.writing')}
        </AppText>
      ) : null}
      {message.state === 'stopped' ? (
        <AppText variant="bodySmall" color="onSurfaceVariant">
          {t('chat.stopped')}
        </AppText>
      ) : null}
      {message.cut ? (
        <AppText variant="bodySmall" color="onSurfaceVariant">
          {t('chat.cut')}
        </AppText>
      ) : null}
      {message.error ? (
        <AppText color="error" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {t(errorKeys[message.error])}
        </AppText>
      ) : null}
      {streaming ? null : (
        <View style={styles.row}>
          {message.text ? <CopyButton testID="copy-answer" text={message.text} label={t('chat.copy')} /> : null}
          {again ? (
            <IconButton
              testID="regenerate"
              icon={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }}
              label={t('chat.regenerate')}
              onPress={() => direct.regenerate(choice)}
            />
          ) : null}
          {message.costMicroUsd === undefined ? null : (
            <AppText variant="bodySmall" color="onSurfaceVariant">
              {t('chat.cost', { cost: formatUsd(language, message.costMicroUsd) })}
            </AppText>
          )}
        </View>
      )}
    </View>
  );
}

function Stream({ stream }: { stream: StreamRow }) {
  const { t } = useSettings();
  return (
    <View testID={`stream-${stream.taskId}`} accessible accessibilityLabel={t('chat.stream', { text: stream.text })} style={styles.agent}>
      <Markdown text={stream.text} />
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
      <View accessible accessibilityLabel={t('chat.message', { text: message.text, status })} style={[styles.owner, styles.body, { backgroundColor: colors.surfaceContainerHigh }]}>
        <AppText>{message.text}</AppText>
        <AppText variant="bodySmall" color="onSurfaceVariant">
          {status}
        </AppText>
      </View>
    );
  }
  const cost = message.costMicroUsd === undefined ? null : formatUsd(language, message.costMicroUsd);
  const status = tasks.find((item) => item.taskId === message.taskId)?.status ?? details[message.taskId]?.status;
  return (
    <View testID={`reply-${message.messageId}`} style={styles.agent}>
      <View
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={cost === null ? t('chat.reply', { text: message.text }) : t('chat.replyCost', { text: message.text, cost })}
        style={styles.body}
      >
        <Markdown text={message.text} />
        {cost === null ? null : (
          <AppText variant="bodySmall" color="onSurfaceVariant">
            {t('chat.cost', { cost })}
          </AppText>
        )}
      </View>
      <View style={styles.row}>
        <CopyButton text={message.text} label={t('chat.copy')} />
      </View>
      {status === undefined || endedStatuses.has(status) ? null : (
        <View style={styles.actions}>
          {canReply(status) ? <Button label={t('chat.replyTo')} variant="outline" onPress={() => onReply(message.taskId)} /> : null}
          <Button label={t('chat.openTask')} variant="outline" onPress={() => openTask(message.taskId)} />
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
  const chat = useSyncExternalStore(direct.subscribe, direct.get);
  const list = useRef<FlatList<Row>>(null);
  const [away, setAway] = useState(false);
  const { pending, streams, thread, threadLoad, threadLoaded, reloadThread, loadOlder, details, tasks } = useLive();
  const listed = (taskId: string) => tasks.find((item) => item.taskId === taskId)?.status ?? 'awaiting_approval';
  const planned = [...new Set(thread.map((message) => message.taskId).filter((taskId): taskId is string => taskId !== undefined))]
    .map((taskId) => details[taskId])
    .filter((detail): detail is TaskDetailV1 => detail?.status === 'awaiting_approval' && detail.plan !== undefined && listed(detail.taskId) === 'awaiting_approval');
  const rows: Row[] = [
    ...pending.map((message): Row => ({ kind: 'pending', message })),
    ...planned.map((detail): Row => ({ kind: 'plan', detail })),
    ...streams.map((stream): Row => ({ kind: 'stream', stream })),
    ...[
      ...thread.map((message): Row => ({ kind: 'message', message })),
      ...chat.messages.map((message, index): Row => ({ kind: 'direct', message, last: index === chat.messages.length - 1 })).reverse(),
    ].sort((a, b) => (a.kind === 'message' || a.kind === 'direct') && (b.kind === 'message' || b.kind === 'direct') ? Date.parse(b.message.createdAt) - Date.parse(a.message.createdAt) : 0),
  ];
  if (rows.length === 0) {
    if (threadLoad === 'error') return <StateView kind="error" title={t('chat.error')} retryLabel={t('common.retry')} onRetry={reloadThread} />;
    if (threadLoad === 'loading' && !threadLoaded) return <StateView kind="loading" title={t('chat.loading')} />;
    return <StateView kind="empty" mark title={t('chat.empty')} />;
  }
  return (
    <>
      {threadLoad === 'error' ? <StateView kind="error" title={t('chat.error')} retryLabel={t('common.retry')} onRetry={reloadThread} /> : null}
      <FlatList
        ref={list}
        testID="chat-list"
        inverted
        onScroll={(event) => setAway(event.nativeEvent.contentOffset.y > awayOffset)}
        accessibilityLabel={t('chat.messages')}
        data={rows}
        keyExtractor={(row) =>
          row.kind === 'pending' ? `pending-${row.message.key}` : row.kind === 'plan' ? `plan-${row.detail.taskId}` : row.kind === 'stream' ? `stream-${row.stream.taskId}` : row.kind === 'direct' ? row.message.id : row.message.messageId
        }
        renderItem={({ item }) =>
          item.kind === 'pending' ? (
            <Pending message={item.message} />
          ) : item.kind === 'plan' ? (
            <PlanCard detail={item.detail} />
          ) : item.kind === 'stream' ? (
            <Stream stream={item.stream} />
          ) : item.kind === 'direct' ? (
            <Direct message={item.message} last={item.last} />
          ) : (
            <Posted message={item.message} onReply={onReply} />
          )
        }
        onEndReached={loadOlder}
        onEndReachedThreshold={0.5}
        ListFooterComponent={Older}
        contentContainerStyle={styles.list}
      />
      {away ? (
        <View style={styles.latest}>
          <IconButton
            testID="latest"
            filled
            icon={{ ios: 'arrow.down', android: 'arrow_downward', web: 'arrow_downward' }}
            label={t('chat.latest')}
            onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
          />
        </View>
      ) : null}
    </>
  );
}

export default function Chat() {
  const { t, colors } = useSettings();
  const { online, send, newChat, tasks, details, models } = useLive();
  const [text, setText] = useState('');
  const [newTask, setNewTask] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const replyTitle = replyTo ? (details[replyTo]?.title ?? tasks.find((item) => item.taskId === replyTo)?.title ?? t('task.title')) : null;
  const choice = useChoice();
  const busy = useSyncExternalStore(direct.subscribe, () => direct.get().busy);
  const toTeam = newTask || replyTo !== null;
  const needsModel = replyTo === null && choice.model === undefined;
  const canSend = online && text.trim() !== '' && !needsModel && (toTeam || !busy);

  const submit = () => {
    if (!canSend) return;
    if (toTeam) send(text, newTask, replyTo ?? undefined, choice);
    else direct.send(text, choice);
    setText('');
    setNewTask(false);
    setReplyTo(null);
  };
  const reply = (taskId: string) => {
    setReplyTo(taskId);
    setNewTask(false);
  };
  const startNew = () => {
    newChat();
    setReplyTo(null);
    setNewTask(false);
    input.current?.focus();
  };

  return (
    <Screen
      title={t('tabs.chat')}
      start={<Menu current="/" />}
      end={<IconButton icon={{ ios: 'square.and.pencil', android: 'edit_square', web: 'edit_square' }} label={t('chat.newChat')} disabled={!online} onPress={startNew} />}
    >
      <LiveBar />
      <Thread onReply={reply} />
      <View style={styles.composer}>
        {online ? null : (
          <AppText variant="bodySmall" color="onSurfaceVariant" accessibilityLiveRegion="polite">
            {t('chat.offline')}
          </AppText>
        )}
        {online && needsModel && models.load !== 'loading' ? (
          <AppText variant="bodySmall" color="onSurfaceVariant" accessibilityLiveRegion="polite">
            {t('chat.modelNeeded')}
          </AppText>
        ) : null}
        {replyTitle ? (
          <View style={styles.row}>
            <AppText variant="bodySmall" color="onSurfaceVariant" accessibilityLiveRegion="polite" style={styles.shrink}>
              {t('chat.replyingTo', { title: replyTitle })}
            </AppText>
            <Button label={t('chat.replyCancel')} variant="outline" onPress={() => setReplyTo(null)} />
          </View>
        ) : null}
        {newTask ? (
          <AppText variant="bodySmall" color="onSurfaceVariant" accessibilityLiveRegion="polite">
            {t('chat.newTaskOn')}
          </AppText>
        ) : null}
        <View testID="composer" style={[styles.bar, { backgroundColor: colors.surfaceContainer, borderColor: colors.outline }]}>
          <TextInput
            ref={input}
            testID="chat-input"
            value={text}
            onChangeText={setText}
            editable={online}
            multiline
            maxLength={taskTextMax}
            accessibilityLabel={t('chat.inputLabel')}
            accessibilityHint={online ? undefined : t('chat.offline')}
            accessibilityState={{ disabled: !online }}
            placeholder={t('chat.placeholder')}
            placeholderTextColor={colors.onSurfaceVariant}
            style={[styles.input, type.body, { color: colors.onSurface }]}
          />
          <View style={styles.tools}>
            <Pressable
              testID="new-task"
              accessibilityRole="switch"
              accessibilityLabel={t('chat.newTask')}
              accessibilityHint={t('chat.newTaskHint')}
              accessibilityState={{ checked: newTask, disabled: !online || replyTo !== null }}
              disabled={!online || replyTo !== null}
              onPress={() => setNewTask((on) => !on)}
              android_ripple={{ color: colors.outlineVariant }}
              style={[styles.round, { backgroundColor: newTask ? colors.primaryContainer : colors.surfaceContainerHigh, opacity: online && replyTo === null ? 1 : 0.38 }]}
            >
              <Icon name={{ ios: 'checklist', android: 'add_task', web: 'add_task' }} color={newTask ? 'onPrimaryContainer' : 'onSurfaceVariant'} size={22} />
            </Pressable>
            <View style={styles.fill} />
            <ModelPicker disabled={!online || replyTo !== null} />
            {busy && !toTeam ? (
              <IconButton testID="stop" icon={{ ios: 'stop.fill', android: 'stop', web: 'stop' }} label={t('chat.stop')} filled onPress={direct.stop} />
            ) : (
              <IconButton icon={{ ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' }} label={t('chat.send')} filled disabled={!canSend} onPress={submit} />
            )}
          </View>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.lg, paddingVertical: spacing.md },
  owner: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + spacing.xs, borderRadius: radius.lg, borderCurve: 'continuous', maxWidth: '85%', alignSelf: 'flex-end' },
  agent: { gap: spacing.sm, alignSelf: 'stretch' },
  mine: { alignItems: 'flex-end' },
  latest: { position: 'absolute', alignSelf: 'center', bottom: spacing.sm },
  body: { gap: spacing.xs },
  shrink: { flexShrink: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  older: { padding: spacing.md },
  composer: { gap: spacing.sm, paddingBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bar: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth * 2,
    boxShadow: shadow.composer,
  },
  tools: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fill: { flex: 1 },
  round: { width: touchTarget, height: touchTarget, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  input: { minHeight: touchTarget, maxHeight: 160, paddingHorizontal: spacing.sm, paddingVertical: (touchTarget - type.body.lineHeight) / 2, textAlign: 'auto', textAlignVertical: 'top' },
});
