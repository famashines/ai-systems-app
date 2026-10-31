import type { TaskListItemV1 } from '@famashines/ai-systems-contracts';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { LiveBar } from '@/components/live-bar';
import { AppText, Screen, StateView } from '@/components/ui';
import { formatTime } from '@/i18n';
import { useLive } from '@/state/live';
import { useSettings } from '@/state/settings';
import { radius, spacing } from '@/theme';

function Row({ task }: { task: TaskListItemV1 }) {
  const { t, colors, language } = useSettings();
  const status = t(`taskStatus.${task.status}`);
  const time = formatTime(language, task.createdAt);
  return (
    <View
      testID={`task-${task.taskId}`}
      accessible
      accessibilityLabel={t('tasks.item', { title: task.title, status, time })}
      style={[styles.task, { backgroundColor: colors.surfaceContainer }]}
    >
      <AppText>{task.title}</AppText>
      <AppText variant="bodySmall" color="onSurfaceVariant">
        {t('tasks.meta', { status, time })}
      </AppText>
    </View>
  );
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
    <Screen title={t('tabs.tasks')}>
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
  list: { gap: spacing.sm, paddingBottom: spacing.md },
  task: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.lg },
  footer: { padding: spacing.md },
});
