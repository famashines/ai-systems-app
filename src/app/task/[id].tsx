import { Id, type PlanSubtask, type TaskDetailV1 } from '@famashines/ai-systems-contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { LiveBar } from '@/components/live-bar';
import { AgentChoice, Choice, Confirm, Field, OutcomeText, PlanActions, PlanEditor, StatusChip, statusLabel, useAgentName, useControl } from '@/components/task';
import { AppText, Button, Screen, StateView } from '@/components/ui';
import { formatTime } from '@/i18n';
import * as api from '@/lib/api';
import { formatUsd } from '@/lib/money';
import { levels, openCheckpoint, stateOf, subtaskControls, taskControls, timeline } from '@/lib/task';
import { useLive } from '@/state/live';
import { useSettings } from '@/state/settings';
import { radius, spacing } from '@/theme';

type Outputs = Record<string, string | null | 'error'>;

function useOutputs(detail: TaskDetailV1 | undefined): Outputs {
  const [outputs, setOutputs] = useState<Outputs>({});
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (!detail?.runId) return;
    const wanted = detail.subtasks.filter((subtask) => subtask.status === 'done').map((subtask) => subtask.subtaskId);
    if (detail.status === 'completed') wanted.push('');
    for (const key of wanted) {
      const id = `${detail.runId} ${key}`;
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      api
        .getOutput(detail.taskId, key || undefined)
        .then((text) => setOutputs((current) => ({ ...current, [key]: text })))
        .catch(() => {
          asked.current.delete(id);
          setOutputs((current) => ({ ...current, [key]: 'error' }));
        });
    }
  }, [detail]);
  return outputs;
}

function Output({ label, text }: { label: string; text: string | null | 'error' | undefined }) {
  const { t } = useSettings();
  if (text === undefined || text === null) return null;
  const shown = text === 'error' ? t('task.outputError') : text;
  return (
    <View accessible accessibilityLabel={t('task.labelled', { label, text: shown })} style={styles.block}>
      <AppText variant="label">{label}</AppText>
      <AppText color={text === 'error' ? 'error' : 'onSurface'} selectable>
        {shown}
      </AppText>
    </View>
  );
}

function LiveOutput({ taskId, callId, label }: { taskId: string; callId: string; label: string }) {
  const { t } = useSettings();
  const { liveText } = useLive();
  const text = liveText(taskId, callId);
  return (
    <View style={styles.block} accessible accessibilityLabel={t('task.labelled', { label, text: text || t('task.liveEmpty') })}>
      <AppText variant="label">{label}</AppText>
      <AppText color={text ? 'onSurface' : 'onSurfaceVariant'}>{text || t('task.liveEmpty')}</AppText>
    </View>
  );
}

function Controls({ detail }: { detail: TaskDetailV1 }) {
  const { t } = useSettings();
  const { run, busy, outcome, online } = useControl(detail.taskId);
  const allowed = taskControls(detail);
  const off = !online || busy !== null;
  return (
    <View style={styles.block}>
      <View style={styles.row}>
        {allowed.pause ? <Button label={t('control.pause')} variant="tonal" busy={busy === 'pause-run'} disabled={off} onPress={() => void run('pause-run', {})} /> : null}
        {allowed.resume ? <Button label={t('control.resume')} variant="tonal" busy={busy === 'resume-run'} disabled={off} onPress={() => void run('resume-run', {})} /> : null}
        {allowed.cancelRun ? <Confirm label={t('control.cancelRun')} confirmLabel={t('control.cancelRunConfirm')} busy={busy === 'cancel-run'} disabled={off} onConfirm={() => void run('cancel-run', {})} /> : null}
        {allowed.cancelTask ? <Confirm label={t('control.cancelTask')} confirmLabel={t('control.cancelTaskConfirm')} busy={busy === 'cancel-task'} disabled={off} onConfirm={() => void run('cancel-task', {})} /> : null}
      </View>
      {allowed.mode ? (
        <Choice role="switch" label={t('control.autoRun')} selected={detail.mode === 'auto'} disabled={off} onPress={() => void run('set-task-mode', { mode: detail.mode === 'auto' ? 'approval' : 'auto' })} />
      ) : null}
      <OutcomeText outcome={outcome} />
    </View>
  );
}

function Checkpoint({ detail, subtaskId }: { detail: TaskDetailV1; subtaskId: string }) {
  const { t, language } = useSettings();
  const { run, busy, outcome, online } = useControl(detail.taskId);
  const [comment, setComment] = useState('');
  const open = openCheckpoint(detail, subtaskId);
  const latest = detail.checkpoints.find((checkpoint) => checkpoint.subtaskId === subtaskId);
  if (!latest) return null;
  if (!open) {
    return (
      <AppText variant="bodySmall" color="onSurfaceVariant">
        {t('checkpoint.closed', { status: t(`checkpoint.${latest.status}`) })}
      </AppText>
    );
  }
  const decide = (decision: 'approved' | 'refused') => void run('resolve-checkpoint', { checkpointId: open.checkpointId, decision, ...(comment.trim() ? { comment: comment.trim() } : {}) });
  return (
    <View style={styles.block} accessibilityLiveRegion="polite">
      <AppText variant="label">{t('checkpoint.title')}</AppText>
      <AppText>{open.reason}</AppText>
      {open.deadline ? (
        <AppText variant="bodySmall" color="onSurfaceVariant">
          {t('checkpoint.deadline', { time: formatTime(language, open.deadline) })}
        </AppText>
      ) : null}
      <Field label={t('checkpoint.comment')} value={comment} onChange={setComment} max={1000} />
      <View style={styles.row}>
        <Button label={t('checkpoint.approve')} busy={busy === 'resolve-checkpoint'} disabled={!online || busy !== null} onPress={() => decide('approved')} />
        <Button label={t('checkpoint.refuse')} variant="tonal" disabled={!online || busy !== null} onPress={() => decide('refused')} />
      </View>
      <OutcomeText outcome={outcome} />
    </View>
  );
}

function Subtask({ detail, subtask, titles, output }: { detail: TaskDetailV1; subtask: PlanSubtask; titles: Map<string, string>; output: string | null | 'error' | undefined }) {
  const { t, language, colors } = useSettings();
  const agentName = useAgentName();
  const { run, busy, outcome, online } = useControl(detail.taskId);
  const [reassigning, setReassigning] = useState(false);
  const [agentId, setAgentId] = useState(subtask.agentId);
  const state = stateOf(detail, subtask.subtaskId);
  const allowed = subtaskControls(detail, subtask.subtaskId);
  const facts = [t('plan.byAgent', { agent: agentName(subtask.agentId) })];
  if (subtask.dependsOn.length > 0) facts.push(t('plan.after', { titles: subtask.dependsOn.map((id) => titles.get(id) ?? '').join(', ') }));
  if (state && state.tries > 0) facts.push(t('task.tries', { n: String(state.tries) }));
  if (state && (state.inputTokens > 0 || state.outputTokens > 0)) facts.push(t('task.tokens', { input: String(state.inputTokens), output: String(state.outputTokens) }));
  if (state && state.costMicroUsd > 0) facts.push(t('chat.cost', { cost: formatUsd(language, state.costMicroUsd) }));
  if (state?.retryAt) facts.push(t('task.retryAt', { time: formatTime(language, state.retryAt) }));
  return (
    <View testID={`subtask-${subtask.subtaskId}`} style={[styles.card, { backgroundColor: colors.surfaceContainer }]}>
      <View accessible accessibilityLabel={t('task.subtaskLabel', { title: subtask.title, status: statusLabel(t, state?.status ?? 'none', true), facts: facts.join('. ') })} style={styles.block}>
        <AppText>{subtask.title}</AppText>
        <StatusChip status={state?.status ?? 'none'} subtask />
        <AppText variant="bodySmall" color="onSurfaceVariant">
          {facts.join(' · ')}
        </AppText>
        {state?.reason ? (
          <AppText variant="bodySmall" color="error">
            {state.reason}
          </AppText>
        ) : null}
      </View>
      <Checkpoint detail={detail} subtaskId={subtask.subtaskId} />
      {state?.status === 'running' && state.callId ? <LiveOutput taskId={detail.taskId} callId={state.callId} label={t('task.live')} /> : null}
      {state?.status === 'done' ? <Output label={t('task.output')} text={output} /> : null}
      <View style={styles.row}>
        {allowed.retry ? <Button label={t('control.retry')} variant="tonal" busy={busy === 'retry-subtask'} disabled={!online || busy !== null} onPress={() => void run('retry-subtask', { subtaskId: subtask.subtaskId })} /> : null}
        {allowed.reassign ? <Button label={t('control.reassign')} variant="tonal" disabled={!online || busy !== null} onPress={() => setReassigning((on) => !on)} /> : null}
      </View>
      {allowed.reassign && reassigning ? (
        <View style={styles.block}>
          <AgentChoice value={agentId} onChange={setAgentId} />
          <Button
            label={t('control.reassignSave')}
            busy={busy === 'reassign-subtask'}
            disabled={!online || busy !== null || agentId === subtask.agentId}
            onPress={() => void run('reassign-subtask', { subtaskId: subtask.subtaskId, agentId }).then((done) => done && setReassigning(false))}
          />
        </View>
      ) : null}
      <OutcomeText outcome={outcome} />
    </View>
  );
}

function Timeline({ detail }: { detail: TaskDetailV1 }) {
  const { t, language } = useSettings();
  const rows = timeline(detail);
  if (rows.length === 0) return null;
  const titles = new Map(detail.plan?.subtasks.map((subtask) => [subtask.subtaskId, subtask.title]));
  return (
    <View style={styles.block}>
      <AppText variant="label" accessibilityRole="header">
        {t('task.timeline')}
      </AppText>
      {rows.map((row) => {
        const start = formatTime(language, row.startedAt);
        const text = row.endedAt
          ? t('task.span', { title: titles.get(row.subtaskId) ?? '', start, end: formatTime(language, row.endedAt) })
          : t('task.since', { title: titles.get(row.subtaskId) ?? '', start });
        return (
          <AppText key={row.subtaskId} variant="bodySmall" accessibilityLabel={text}>
            {text}
          </AppText>
        );
      })}
    </View>
  );
}

function Detail({ detail, editing, setEditing }: { detail: TaskDetailV1; editing: boolean; setEditing: (on: boolean) => void }) {
  const { t, language } = useSettings();
  const outputs = useOutputs(detail);
  const subtasks = detail.plan?.subtasks ?? [];
  const titles = new Map(subtasks.map((subtask) => [subtask.subtaskId, subtask.title]));
  const facts = [t(detail.mode === 'auto' ? 'task.modeAuto' : 'task.modeApproval'), t('task.cost', { cost: formatUsd(language, detail.costMicroUsd) })];
  return (
    <ScrollView testID="task-detail" contentContainerStyle={styles.scroll}>
      <View accessible accessibilityLabel={t('task.statusLabel', { status: statusLabel(t, detail.status, false), facts: facts.join('. ') })} style={styles.block}>
        <StatusChip status={detail.status} />
        <AppText variant="bodySmall" color="onSurfaceVariant">
          {facts.join(' · ')}
        </AppText>
        {detail.reason ? <AppText color="error">{detail.reason}</AppText> : null}
      </View>
      <Controls detail={detail} />
      {detail.currentCall ? <LiveOutput taskId={detail.taskId} callId={detail.currentCall.callId} label={t(`call.${detail.currentCall.kind}`)} /> : null}
      {detail.plan ? (
        <View style={styles.block}>
          <AppText variant="label" accessibilityRole="header">
            {t('plan.heading', { version: String(detail.plan.planVersion), n: String(subtasks.length) })}
          </AppText>
          {editing ? <PlanEditor detail={detail} onClose={() => setEditing(false)} /> : <PlanActions detail={detail} onEdit={() => setEditing(true)} />}
          {levels(subtasks).map((row, index) => (
            <View key={index} style={styles.block}>
              <AppText variant="label" accessibilityRole="header">
                {t('plan.step', { n: String(index + 1) })}
              </AppText>
              {row.map((subtask) => (
                <Subtask key={subtask.subtaskId} detail={detail} subtask={subtask} titles={titles} output={outputs[subtask.subtaskId]} />
              ))}
            </View>
          ))}
        </View>
      ) : null}
      <Timeline detail={detail} />
      <Output label={t('task.result')} text={outputs['']} />
    </ScrollView>
  );
}

export default function TaskScreen() {
  const { t } = useSettings();
  const params = useLocalSearchParams<{ id: string; edit?: string }>();
  const taskId = Id.safeParse(params.id).success ? params.id : null;
  const { details, detailLoad, watch, reloadTask, tasks } = useLive();
  const [editing, setEditing] = useState(params.edit === '1');
  useEffect(() => (taskId ? watch(taskId) : undefined), [taskId, watch]);
  const detail = taskId ? details[taskId] : undefined;
  const title = detail?.title ?? tasks.find((item) => item.taskId === taskId)?.title ?? t('task.title');
  const load = taskId ? detailLoad[taskId] : 'error';
  return (
    <Screen title={title}>
      <View style={styles.row}>
        <Button label={t('task.back')} variant="tonal" onPress={() => (router.canGoBack() ? router.back() : router.replace('/tasks'))} />
      </View>
      <LiveBar />
      {detail ? (
        <Detail detail={detail} editing={editing} setEditing={setEditing} />
      ) : load === 'error' ? (
        <StateView kind="error" title={t('task.error')} retryLabel={t('common.retry')} onRetry={() => taskId && reloadTask(taskId)} />
      ) : (
        <StateView kind="loading" title={t('task.loading')} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: spacing.md, paddingBottom: spacing.xl },
  block: { gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg },
});
