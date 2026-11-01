import { PlanSubtasks, TaskDetailV1, type CheckpointV1, type PlanSubtask, type SubtaskStateV1, type TaskStatus } from '@famashines/ai-systems-contracts';

import type { Notice } from '@/lib/live';

export type Details = Record<string, TaskDetailV1>;

export const endedStatuses = new Set<TaskStatus>(['completed', 'failed', 'cancelled', 'rejected']);
const runStatuses = new Set<TaskStatus>(['running', 'paused', 'blocked']);
const fixedSubtasks = new Set<SubtaskStateV1['status']>(['running', 'done', 'cancelled', 'skipped']);

export function mergeDetail(details: Details, doc: TaskDetailV1): Details {
  const current = details[doc.taskId];
  if (current && doc.rev < current.rev) return details;
  return { ...details, [doc.taskId]: doc };
}

export function detailFromNotice(details: Details, notice: Notice): Details {
  if (notice.topic !== `task:${notice.docId}`) return details;
  const doc = TaskDetailV1.safeParse(notice.data);
  if (!doc.success || doc.data.taskId !== notice.docId) return details;
  const current = details[notice.docId];
  if (current && notice.rev <= current.rev) return details;
  return { ...details, [notice.docId]: { ...doc.data, rev: notice.rev } };
}

export type TaskControls = { approve: boolean; pause: boolean; resume: boolean; cancelRun: boolean; cancelTask: boolean; mode: boolean };

export function taskControls({ status, plan, subtasks }: TaskDetailV1): TaskControls {
  return {
    approve: status === 'awaiting_approval' && plan !== undefined,
    pause: status === 'running',
    resume: status === 'paused' || (status === 'blocked' && subtasks.some((subtask) => subtask.status === 'blocked')),
    cancelRun: runStatuses.has(status),
    cancelTask: status === 'submitted' || status === 'clarifying' || status === 'planning',
    mode: !endedStatuses.has(status),
  };
}

export function stateOf(detail: TaskDetailV1, subtaskId: string): SubtaskStateV1 | undefined {
  return detail.subtasks.find((subtask) => subtask.subtaskId === subtaskId);
}

export function subtaskControls(detail: TaskDetailV1, subtaskId: string): { retry: boolean; reassign: boolean } {
  const state = stateOf(detail, subtaskId);
  const inRun = runStatuses.has(detail.status) && detail.runId !== undefined;
  return {
    retry: inRun && (state?.status === 'failed' || state?.status === 'blocked'),
    reassign: inRun && (state === undefined || !fixedSubtasks.has(state.status)),
  };
}

export function openCheckpoint(detail: TaskDetailV1, subtaskId: string): CheckpointV1 | undefined {
  if (stateOf(detail, subtaskId)?.status !== 'awaiting_approval') return undefined;
  return detail.checkpoints.find((checkpoint) => checkpoint.subtaskId === subtaskId && checkpoint.status === 'open');
}

export function levels<T extends { subtaskId: string; dependsOn: string[] }>(subtasks: T[]): T[][] {
  const depth = new Map<string, number>();
  const byId = new Map(subtasks.map((subtask) => [subtask.subtaskId, subtask]));
  const visit = (subtask: T, path: Set<string>): number => {
    const known = depth.get(subtask.subtaskId);
    if (known !== undefined) return known;
    if (path.has(subtask.subtaskId)) return 0;
    path.add(subtask.subtaskId);
    const parents = subtask.dependsOn.map((id) => byId.get(id)).filter((parent): parent is T => parent !== undefined);
    const value = parents.length === 0 ? 0 : Math.max(...parents.map((parent) => visit(parent, path))) + 1;
    path.delete(subtask.subtaskId);
    depth.set(subtask.subtaskId, value);
    return value;
  };
  const rows: T[][] = [];
  for (const subtask of subtasks) (rows[visit(subtask, new Set())] ??= []).push(subtask);
  return rows.filter(Boolean);
}

export function timeline(detail: TaskDetailV1): (SubtaskStateV1 & { startedAt: string })[] {
  return detail.subtasks
    .filter((subtask): subtask is SubtaskStateV1 & { startedAt: string } => subtask.startedAt !== undefined)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

export type Draft = Omit<PlanSubtask, 'estimatedCostMicroUsd' | 'estimatedDurationMs'>;

export function draftOf(subtasks: PlanSubtask[]): Draft[] {
  return subtasks.map(({ estimatedCostMicroUsd: _cost, estimatedDurationMs: _time, ...rest }) => ({ ...rest, dependsOn: [...rest.dependsOn] }));
}

export function addSubtask(draft: Draft[], subtaskId: string, agentId: string): Draft[] {
  return [...draft, { subtaskId, title: '', instructions: '', agentId, dependsOn: [], needsApproval: false }];
}

export function removeSubtask(draft: Draft[], subtaskId: string): Draft[] {
  return draft.filter((item) => item.subtaskId !== subtaskId).map((item) => ({ ...item, dependsOn: item.dependsOn.filter((id) => id !== subtaskId) }));
}

export function moveSubtask(draft: Draft[], subtaskId: string, by: -1 | 1): Draft[] {
  const from = draft.findIndex((item) => item.subtaskId === subtaskId);
  const to = from + by;
  if (from < 0 || to < 0 || to >= draft.length) return draft;
  const next = [...draft];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

export function changeSubtask(draft: Draft[], subtaskId: string, change: Partial<Omit<Draft, 'subtaskId'>>): Draft[] {
  return draft.map((item) => (item.subtaskId === subtaskId ? { ...item, ...change } : item));
}

export function toggleDependency(draft: Draft[], subtaskId: string, on: string): Draft[] {
  return draft.map((item) => {
    if (item.subtaskId !== subtaskId) return item;
    const has = item.dependsOn.includes(on);
    return { ...item, dependsOn: has ? item.dependsOn.filter((id) => id !== on) : [...item.dependsOn, on] };
  });
}

export type DraftProblem = 'count' | 'text' | 'cycle';

export function checkDraft(draft: Draft[]): { ok: true; subtasks: PlanSubtask[] } | { ok: false; problem: DraftProblem } {
  if (draft.length < 1 || draft.length > 20) return { ok: false, problem: 'count' };
  const parsed = PlanSubtasks.safeParse(draft.map((item) => ({ ...item, title: item.title.trim(), instructions: item.instructions.trim() })));
  if (parsed.success) return { ok: true, subtasks: parsed.data };
  return { ok: false, problem: parsed.error.issues.some((issue) => issue.message === 'The dependencies have no cycle') ? 'cycle' : 'text' };
}
