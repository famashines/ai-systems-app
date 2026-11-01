import type { PlanSubtask, SubtaskStatus, TaskDetailV1, TaskStatus } from '@famashines/ai-systems-contracts';
import * as Crypto from 'expo-crypto';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import type { Key } from '@/i18n';
import * as api from '@/lib/api';
import { formatUsd } from '@/lib/money';
import { addSubtask, changeSubtask, checkDraft, draftOf, levels, moveSubtask, removeSubtask, taskControls, toggleDependency, type Draft, type DraftProblem } from '@/lib/task';
import { useLive } from '@/state/live';
import { useSettings } from '@/state/settings';
import { radius, spacing, touchTarget, type, type Colors } from '@/theme';

export type Outcome = 'conflict' | 'rejected' | 'unavailable' | 'network';

const outcomeKeys: Record<Outcome, Key> = {
  conflict: 'control.conflict',
  rejected: 'control.rejected',
  unavailable: 'control.unavailable',
  network: 'control.network',
};

export function useControl(taskId: string) {
  const { reloadTask, online } = useLive();
  const [busy, setBusy] = useState<api.ControlName | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const last = useRef<{ id: string; key: string } | null>(null);
  const run = async <N extends api.ControlName>(name: N, body: api.ControlBody<N>): Promise<boolean> => {
    if (busy || !online) return false;
    const id = `${name} ${JSON.stringify(body)}`;
    const key = last.current?.id === id ? last.current.key : Crypto.randomUUID();
    last.current = { id, key };
    setBusy(name);
    setOutcome(null);
    try {
      await api.control(taskId, name, body, key);
      last.current = null;
      return true;
    } catch (error) {
      const kind = error instanceof api.ApiError ? error.kind : 'network';
      const next: Outcome = kind === 'network' ? 'network' : kind === 'unavailable' || kind === 'rateLimited' ? 'unavailable' : error instanceof api.ApiError && error.status === 409 ? 'conflict' : 'rejected';
      if (next === 'conflict' || next === 'rejected') last.current = null;
      if (next === 'conflict') reloadTask(taskId);
      setOutcome(next);
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { run, busy, outcome, online };
}

export function OutcomeText({ outcome }: { outcome: Outcome | null }) {
  const { t } = useSettings();
  if (!outcome) return null;
  return (
    <AppText variant="bodySmall" color="error" accessibilityRole="alert" accessibilityLiveRegion="polite">
      {t(outcomeKeys[outcome])}
    </AppText>
  );
}

type Tone = 'error' | 'active' | 'quiet';
const tones: Record<Tone, [keyof Colors, keyof Colors]> = {
  error: ['errorContainer', 'onErrorContainer'],
  active: ['primaryContainer', 'onPrimaryContainer'],
  quiet: ['surfaceContainerHigh', 'onSurface'],
};
const glyphs: Record<SubtaskStatus | TaskStatus | 'none', string> = {
  none: '○',
  waiting: '◷',
  queued: '…',
  awaiting_approval: '?',
  running: '▶',
  retrying: '↻',
  blocked: '■',
  failed: '✕',
  done: '✓',
  cancelled: '–',
  skipped: '»',
  submitted: '…',
  clarifying: '?',
  planning: '◷',
  paused: '॥',
  completed: '✓',
  rejected: '✕',
};

function toneOf(status: SubtaskStatus | TaskStatus | 'none'): Tone {
  if (status === 'failed' || status === 'blocked' || status === 'rejected') return 'error';
  if (status === 'running' || status === 'retrying' || status === 'awaiting_approval' || status === 'planning' || status === 'clarifying') return 'active';
  return 'quiet';
}

export function statusLabel(t: (key: Key) => string, status: SubtaskStatus | TaskStatus | 'none', subtask: boolean): string {
  return t((subtask ? `subtaskStatus.${status}` : `taskStatus.${status}`) as Key);
}

export function StatusChip({ status, subtask = false }: { status: SubtaskStatus | TaskStatus | 'none'; subtask?: boolean }) {
  const { t, colors } = useSettings();
  const [fill, ink] = tones[toneOf(status)];
  return (
    <View style={[styles.chip, { backgroundColor: colors[fill] }]} accessible accessibilityLabel={statusLabel(t, status, subtask)}>
      <AppText variant="label" color={ink} importantForAccessibility="no">
        {glyphs[status]}
      </AppText>
      <AppText variant="label" color={ink} importantForAccessibility="no">
        {statusLabel(t, status, subtask)}
      </AppText>
    </View>
  );
}

export function Field({ label, value, onChange, multiline = false, max }: { label: string; value: string; onChange: (text: string) => void; multiline?: boolean; max: number }) {
  const { colors } = useSettings();
  return (
    <View style={styles.field}>
      <AppText variant="label">{label}</AppText>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        maxLength={max}
        accessibilityLabel={label}
        style={[styles.input, type.body, { color: colors.onSurface, borderColor: colors.outline, backgroundColor: colors.surfaceContainer }]}
      />
    </View>
  );
}

export function Choice({ label, selected, onPress, role = 'radio', disabled = false }: { label: string; selected: boolean; onPress: () => void; role?: 'radio' | 'checkbox' | 'switch'; disabled?: boolean }) {
  const { colors } = useSettings();
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: colors.outlineVariant }}
      style={[styles.choice, { borderColor: colors.outline, backgroundColor: selected ? colors.primaryContainer : 'transparent', opacity: disabled ? 0.38 : 1 }]}
    >
      <AppText variant="label" color={selected ? 'onPrimaryContainer' : 'onSurface'}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function AgentChoice({ value, onChange }: { value: string; onChange: (agentId: string) => void }) {
  const { t } = useSettings();
  const { agents } = useLive();
  const enabled = agents.filter((agent) => agent.enabled || agent.agentId === value);
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel={t('plan.agent')}>
      {enabled.map((agent) => (
        <Choice key={agent.agentId} label={agent.name} selected={agent.agentId === value} onPress={() => onChange(agent.agentId)} />
      ))}
    </View>
  );
}

export function useAgentName(): (agentId: string) => string {
  const { t } = useSettings();
  const { agents } = useLive();
  return (agentId) => agents.find((agent) => agent.agentId === agentId)?.name ?? t('plan.unknownAgent');
}

function duration(t: (key: Key, params?: Record<string, string>) => string, ms: number): string {
  return ms < 60_000 ? t('plan.seconds', { n: String(Math.max(1, Math.round(ms / 1000))) }) : t('plan.minutes', { n: String(Math.round(ms / 60_000)) });
}

export function PlanSummary({ subtasks }: { subtasks: PlanSubtask[] }) {
  const { t, language } = useSettings();
  const agentName = useAgentName();
  const titles = new Map(subtasks.map((subtask) => [subtask.subtaskId, subtask.title]));
  return (
    <View style={styles.list}>
      {levels(subtasks).map((row, index) => (
        <View key={index} style={styles.list}>
          <AppText variant="label" accessibilityRole="header">
            {t('plan.step', { n: String(index + 1) })}
          </AppText>
          {row.map((subtask) => {
            const parts = [t('plan.byAgent', { agent: agentName(subtask.agentId) })];
            if (subtask.dependsOn.length > 0) parts.push(t('plan.after', { titles: subtask.dependsOn.map((id) => titles.get(id) ?? '').join(', ') }));
            if (subtask.estimatedCostMicroUsd !== undefined) parts.push(t('plan.cost', { cost: formatUsd(language, subtask.estimatedCostMicroUsd) }));
            if (subtask.estimatedDurationMs !== undefined) parts.push(t('plan.time', { time: duration(t, subtask.estimatedDurationMs) }));
            if (subtask.needsApproval) parts.push(t('plan.needsApproval'));
            return (
              <View key={subtask.subtaskId} accessible accessibilityLabel={t('plan.itemLabel', { title: subtask.title, facts: parts.join('. ') })} style={styles.item}>
                <AppText>{subtask.title}</AppText>
                <AppText variant="bodySmall" color="onSurfaceVariant">
                  {parts.join(' · ')}
                </AppText>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export function Confirm({ label, confirmLabel, onConfirm, busy, disabled }: { label: string; confirmLabel: string; onConfirm: () => void; busy: boolean; disabled: boolean }) {
  const { t } = useSettings();
  const [asking, setAsking] = useState(false);
  if (!asking) return <Button label={label} variant="outline" busy={busy} disabled={disabled} onPress={() => setAsking(true)} />;
  return (
    <View style={styles.row}>
      <Button
        label={confirmLabel}
        disabled={disabled}
        onPress={() => {
          setAsking(false);
          onConfirm();
        }}
      />
      <Button label={t('control.keep')} variant="outline" onPress={() => setAsking(false)} />
    </View>
  );
}

export function PlanActions({ detail, onEdit }: { detail: TaskDetailV1; onEdit: () => void }) {
  const { t } = useSettings();
  const { run, busy, outcome, online } = useControl(detail.taskId);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  if (!taskControls(detail).approve || !detail.plan) return null;
  const planVersion = detail.plan.planVersion;
  return (
    <View style={styles.list}>
      <View style={styles.row}>
        <Button label={t('plan.approve')} busy={busy === 'approve-plan'} disabled={!online || busy !== null} onPress={() => void run('approve-plan', { planVersion })} />
        <Button label={t('plan.edit')} variant="outline" disabled={!online || busy !== null} onPress={onEdit} />
        <Button label={t('plan.reject')} variant="outline" disabled={!online || busy !== null} onPress={() => setRejecting((on) => !on)} />
      </View>
      {rejecting ? (
        <View style={styles.list}>
          <Field label={t('plan.rejectReason')} value={reason} onChange={setReason} max={1000} />
          <Button
            label={t('plan.rejectConfirm')}
            busy={busy === 'reject-plan'}
            disabled={!online || !reason.trim() || busy !== null}
            onPress={() => void run('reject-plan', { planVersion, reason: reason.trim() }).then((done) => done && setRejecting(false))}
          />
        </View>
      ) : null}
      <OutcomeText outcome={outcome} />
    </View>
  );
}

const problemKeys: Record<DraftProblem, Key> = { count: 'plan.problemCount', text: 'plan.problemText', cycle: 'plan.problemCycle' };

export function PlanEditor({ detail, onClose }: { detail: TaskDetailV1; onClose: () => void }) {
  const { t } = useSettings();
  const { agents } = useLive();
  const { run, busy, outcome, online } = useControl(detail.taskId);
  const [draft, setDraft] = useState<Draft[]>(() => draftOf(detail.plan?.subtasks ?? []));
  const [problem, setProblem] = useState<DraftProblem | null>(null);
  const [base, setBase] = useState(detail.plan?.planVersion);
  const plan = detail.plan;
  if (!plan) return null;
  if (plan.planVersion !== base) {
    return (
      <View style={styles.list}>
        <AppText variant="bodySmall" color="error" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {t('plan.changed')}
        </AppText>
        <View style={styles.row}>
          <Button
            label={t('plan.loadNew')}
            onPress={() => {
              setDraft(draftOf(plan.subtasks));
              setBase(plan.planVersion);
            }}
          />
          <Button label={t('plan.cancelEdit')} variant="outline" onPress={onClose} />
        </View>
      </View>
    );
  }
  const firstAgent = agents.find((agent) => agent.enabled)?.agentId;
  const change = (next: Draft[]) => {
    setDraft(next);
    setProblem(null);
  };
  const save = async () => {
    const checked = checkDraft(draft);
    if (!checked.ok) {
      setProblem(checked.problem);
      return;
    }
    if (await run('edit-plan', { planVersion: plan.planVersion, subtasks: checked.subtasks })) onClose();
  };
  return (
    <View style={styles.list} testID="plan-editor">
      <AppText variant="label" accessibilityRole="header">
        {t('plan.editTitle', { version: String(plan.planVersion) })}
      </AppText>
      <AppText variant="bodySmall" color="onSurfaceVariant">
        {t('plan.editHint')}
      </AppText>
      {draft.map((item, index) => {
        const name = item.title.trim() || t('plan.untitled', { n: String(index + 1) });
        return (
          <View key={item.subtaskId} style={[styles.list, styles.item]} accessibilityLabel={t('plan.subtaskN', { n: String(index + 1), title: name })}>
            <Field label={t('plan.title', { n: String(index + 1) })} value={item.title} onChange={(title) => change(changeSubtask(draft, item.subtaskId, { title }))} max={200} />
            <Field
              label={t('plan.instructions', { n: String(index + 1) })}
              value={item.instructions}
              multiline
              onChange={(instructions) => change(changeSubtask(draft, item.subtaskId, { instructions }))}
              max={4000}
            />
            <AppText variant="label">{t('plan.agent')}</AppText>
            <AgentChoice value={item.agentId} onChange={(agentId) => change(changeSubtask(draft, item.subtaskId, { agentId }))} />
            {draft.length > 1 ? <AppText variant="label">{t('plan.dependsOn')}</AppText> : null}
            <View style={styles.wrap}>
              {draft
                .filter((other) => other.subtaskId !== item.subtaskId)
                .map((other) => (
                  <Choice
                    key={other.subtaskId}
                    role="checkbox"
                    label={t('plan.afterOne', { title: other.title.trim() || t('plan.untitled', { n: String(draft.indexOf(other) + 1) }) })}
                    selected={item.dependsOn.includes(other.subtaskId)}
                    onPress={() => change(toggleDependency(draft, item.subtaskId, other.subtaskId))}
                  />
                ))}
            </View>
            <Choice role="switch" label={t('plan.needsApprovalSwitch')} selected={item.needsApproval} onPress={() => change(changeSubtask(draft, item.subtaskId, { needsApproval: !item.needsApproval }))} />
            <View style={styles.row}>
              <Button label={t('plan.up', { title: name })} variant="outline" disabled={index === 0} onPress={() => change(moveSubtask(draft, item.subtaskId, -1))} />
              <Button label={t('plan.down', { title: name })} variant="outline" disabled={index === draft.length - 1} onPress={() => change(moveSubtask(draft, item.subtaskId, 1))} />
              <Button label={t('plan.remove', { title: name })} variant="outline" disabled={draft.length === 1} onPress={() => change(removeSubtask(draft, item.subtaskId))} />
            </View>
          </View>
        );
      })}
      <Button label={t('plan.add')} variant="outline" disabled={!firstAgent || draft.length >= 20} onPress={() => firstAgent && change(addSubtask(draft, Crypto.randomUUID(), firstAgent))} />
      {problem ? (
        <AppText variant="bodySmall" color="error" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {t(problemKeys[problem])}
        </AppText>
      ) : null}
      <OutcomeText outcome={outcome} />
      <View style={styles.row}>
        <Button label={t('plan.save')} busy={busy === 'edit-plan'} disabled={!online || busy !== null} onPress={() => void save()} />
        <Button label={t('plan.cancelEdit')} variant="outline" onPress={onClose} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.full },
  field: { gap: spacing.xs },
  input: { minHeight: touchTarget, borderWidth: 1, borderRadius: radius.md, borderCurve: 'continuous', paddingHorizontal: spacing.md, textAlign: 'auto' },
  choice: { minHeight: touchTarget, minWidth: touchTarget, justifyContent: 'center', paddingHorizontal: spacing.md, borderWidth: 1, borderRadius: radius.full, overflow: 'hidden' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  list: { gap: spacing.sm },
  item: { gap: spacing.xs, paddingVertical: spacing.xs },
});
