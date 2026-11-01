import type { TaskListItemV1 } from '@famashines/ai-systems-contracts';
import { router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Menu } from '@/components/drawer';
import { LiveBar } from '@/components/live-bar';
import { AppText, Screen, StateView } from '@/components/ui';
import { formatTime } from '@/i18n';
import { useLive } from '@/state/live';
import { useSettings } from '@/state/settings';
import { spacing, touchTarget } from '@/theme';

function Row({ task }: { task: TaskListItemV1 }) {
  const { t, colors, language } = useSettings();
  const status = t(`taskStatus.${task.status}`);
  const time = formatTime(language, task.createdAt);
  return (
    <Pressable
      testID={`task-${task.taskId}`}
      accessibilityRole="button"
      accessibilityLabel={t('tasks.item', { title: task.title, status, time })}
      accessibilityHint={t('tasks.open')}
      onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.taskId } })}
      android_ripple={{ color: colors.outlineVariant }}
      style={styles.task}
    >
      <AppText numberOfLines={2}>{task.title}</AppText>
      <AppText variant="bodySmall" color="onSurfaceVariant">
        {t('tasks.meta', { status, time })}
      </AppText>
    </Pressable>
  );
}

function Divider() {
  const { colors } = useSettings();
  return <View style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />;
}

function Footer() {
  const { t, colors } = useSettings();
  const { more, loadMore } = useLive();
  if (more === 'loading') return <ActivityIndicator style={styles.footer} color={colors.primary} accessibilityLabel={t('tasks.loadingMore')} />;
  if (more === 'error') return <StateView kind="error" title={t('tasks.moreError')} retryLabel={t('common.retry')} onRetry={loadMore} />;
  return null;
}

function Body() {
  const { t } = useSettings();
  const { tasks, online, status, snapshot, reload, reconnect, loadMore } = useLive();
  if (tasks.length > 0) {
    return (
      <>
        {snapshot === 'error' ? <StateView kind="error" title={t('tasks.error')} retryLabel={t('common.retry')} onRetry={reload} /> : null}
        <FlatList
          testID="tasks-list"
          accessibilityLabel={t('tasks.list')}
          data={tasks}
          keyExtractor={(task) => task.taskId}
          renderItem={({ item }) => <Row task={item} />}
          ItemSeparatorComponent={Divider}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={Footer}
          contentContainerStyle={styles.list}
        />
      </>
    );
  }
  if (snapshot === 'error') return <StateView kind="error" title={t('tasks.error')} retryLabel={t('common.retry')} onRetry={reload} />;
  if (!online && status === 'reconnecting') return <StateView kind="error" title={t('tasks.offline')} retryLabel={t('common.retry')} onRetry={reconnect} />;
  if (!online || snapshot === 'loading') return <StateView kind="loading" title={t('tasks.loading')} />;
  return <StateView kind="empty" title={t('tasks.empty')} hint={t('tasks.emptyHint')} />;
}

export default function Tasks() {
  const { t, language } = useSettings();
  const { online, updatedAt } = useLive();
  return (
    <Screen title={t('tabs.tasks')} start={<Menu current="/tasks" />}>
      <LiveBar />
      {!online && updatedAt !== null ? (
        <AppText variant="bodySmall" color="onSurfaceVariant" accessibilityLiveRegion="polite">
          {t('live.offline', { time: formatTime(language, updatedAt) })}
        </AppText>
      ) : null}
      <Body />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing.md },
  task: { gap: spacing.xs, paddingVertical: spacing.md, minHeight: touchTarget, justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth },
  footer: { padding: spacing.md },
});
