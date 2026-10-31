import { Screen, StateView } from '@/components/ui';
import { useSettings } from '@/state/settings';

export default function Tasks() {
  const { t } = useSettings();
  return (
    <Screen title={t('tabs.tasks')}>
      <StateView kind="empty" title={t('tasks.empty')} hint={t('tasks.emptyHint')} />
    </Screen>
  );
}
