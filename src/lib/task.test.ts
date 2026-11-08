import type { SubtaskStateV1, TaskStatus } from '@famashines/ai-systems-contracts';

import {
  addSubtask,
  canReply,
  changeSubtask,
  checkDraft,
  detailFromNotice,
  draftOf,
  levels,
  mergeDetail,
  moveSubtask,
  openCheckpoint,
  removeSubtask,
  subtaskControls,
  taskControls,
  timeline,
  toggleDependency,
} from '@/lib/task';
import { detail, ids, subtaskIds } from '@/test-fakes';

const [s1, s2, s3] = subtaskIds;
const state = (subtaskId: string, status: SubtaskStateV1['status'], extra: Partial<SubtaskStateV1> = {}): SubtaskStateV1 => ({
  subtaskId,
  status,
  tries: 1,
  inputTokens: 0,
  outputTokens: 0,
  costMicroUsd: 0,
  ...extra,
});

describe('taskControls', () => {
  const table: [TaskStatus, string[]][] = [
    ['submitted', ['cancelTask', 'mode']],
    ['clarifying', ['cancelTask', 'mode']],
    ['planning', ['cancelTask', 'mode']],
    ['awaiting_approval', ['approve', 'mode']],
    ['running', ['pause', 'cancelRun', 'mode']],
    ['paused', ['resume', 'cancelRun', 'mode']],
    ['blocked', ['cancelRun', 'mode']],
    ['completed', []],
    ['failed', []],
    ['cancelled', []],
    ['rejected', []],
  ];
  it.each(table)('a %s task allows %j', (status, allowed) => {
    const controls = taskControls(detail({ status }));
    expect(Object.entries(controls).filter(([, on]) => on).map(([name]) => name)).toEqual(allowed);
  });

  it('resumes a blocked run only when a subtask is blocked, not when one failed', () => {
    expect(taskControls(detail({ status: 'blocked', subtasks: [state(s1!, 'blocked')] })).resume).toBe(true);
    expect(taskControls(detail({ status: 'blocked', subtasks: [state(s1!, 'failed')] })).resume).toBe(false);
  });

  it('approves only with a plan', () => {
    const { plan: _plan, ...noPlan } = detail({ status: 'awaiting_approval' });
    expect(taskControls(noPlan).approve).toBe(false);
  });
});

it.each([
  ['clarifying', true],
  ['running', true],
  ['paused', true],
  ['submitted', false],
  ['planning', false],
  ['awaiting_approval', false],
  ['blocked', false],
  ['completed', false],
  ['failed', false],
  ['cancelled', false],
  ['rejected', false],
  [undefined, false],
] as const)('a reply to a %s task is %s', (status, allowed) => {
  expect(canReply(status)).toBe(allowed);
});

describe('subtaskControls', () => {
  it('retries a failed or blocked subtask during a run, and reassigns a subtask that is not running or ended', () => {
    const doc = detail({
      status: 'blocked',
      runId: ids.taskC,
      subtasks: [state(s1!, 'failed'), state(s2!, 'running'), state(s3!, 'done')],
    });
    expect(subtaskControls(doc, s1!)).toEqual({ retry: true, reassign: true });
    expect(subtaskControls(doc, s2!)).toEqual({ retry: false, reassign: false });
    expect(subtaskControls(doc, s3!)).toEqual({ retry: false, reassign: false });
    expect(subtaskControls({ ...doc, subtasks: [] }, s1!)).toEqual({ retry: false, reassign: true });
  });

  it('allows nothing before the run or after the end', () => {
    expect(subtaskControls(detail({ status: 'awaiting_approval' }), s1!)).toEqual({ retry: false, reassign: false });
    expect(subtaskControls(detail({ status: 'failed', runId: ids.taskC, subtasks: [state(s1!, 'failed')] }), s1!)).toEqual({ retry: false, reassign: false });
  });
});

describe('openCheckpoint', () => {
  const checkpoint = { checkpointId: ids.taskC, subtaskId: s1!, reason: 'Approval needed for Facts', status: 'open' as const, openedAt: '2026-11-01T10:00:00.000Z' };

  it('is actionable only while the subtask is awaiting_approval and the checkpoint is open', () => {
    const doc = detail({ status: 'running', runId: ids.taskC, checkpoints: [checkpoint], subtasks: [state(s1!, 'awaiting_approval')] });
    expect(openCheckpoint(doc, s1!)).toEqual(checkpoint);
    expect(openCheckpoint({ ...doc, subtasks: [state(s1!, 'queued')] }, s1!)).toBeUndefined();
    expect(openCheckpoint({ ...doc, checkpoints: [{ ...checkpoint, status: 'approved' }] }, s1!)).toBeUndefined();
    expect(openCheckpoint(doc, s2!)).toBeUndefined();
  });
});

describe('detail documents', () => {
  it('keeps the newer rev from a snapshot and from a notice', () => {
    const first = detail({ rev: 3 });
    const details = mergeDetail({}, first);
    expect(mergeDetail(details, { ...first, rev: 2, title: 'Old' })).toBe(details);
    expect(mergeDetail(details, { ...first, rev: 3, title: 'Same' })[first.taskId]!.title).toBe('Same');
    const notice = (rev: number, data: unknown, docId = first.taskId, topic = `task:${first.taskId}`) =>
      ({ type: 'notice', seq: 20, topic, docId, rev, data }) as Parameters<typeof detailFromNotice>[1];
    expect(detailFromNotice(details, notice(3, { ...first, title: 'Same rev' }))).toBe(details);
    expect(detailFromNotice(details, notice(4, { ...first, title: 'New' }))[first.taskId]).toMatchObject({ title: 'New', rev: 4 });
    expect(detailFromNotice(details, notice(5, { title: 'Bad' }))).toBe(details);
    expect(detailFromNotice(details, notice(5, first, ids.taskB, `task:${ids.taskB}`))).toBe(details);
    expect(detailFromNotice(details, notice(5, first, first.taskId, 'tasks'))).toBe(details);
  });
});

describe('levels and timeline', () => {
  it('groups the DAG by depth and keeps the plan order in a level', () => {
    const subtasks = [
      { subtaskId: 'c', dependsOn: ['a', 'b'] },
      { subtaskId: 'a', dependsOn: [] },
      { subtaskId: 'b', dependsOn: ['a'] },
      { subtaskId: 'd', dependsOn: [] },
    ];
    expect(levels(subtasks).map((row) => row.map((item) => item.subtaskId))).toEqual([['a', 'd'], ['b'], ['c']]);
  });

  it('orders the timeline by start and leaves out subtasks that did not start', () => {
    const doc = detail({
      subtasks: [
        state(s1!, 'done', { startedAt: '2026-11-01T10:05:00.000Z', endedAt: '2026-11-01T10:06:00.000Z' }),
        state(s2!, 'running', { startedAt: '2026-11-01T10:01:00.000Z' }),
        state(s3!, 'waiting'),
      ],
    });
    expect(timeline(doc).map((row) => row.subtaskId)).toEqual([s2, s1]);
  });
});

describe('plan draft', () => {
  const base = detail({ status: 'awaiting_approval' }).plan!.subtasks;

  it('drops the estimates, which the server makes again', () => {
    expect(base[0]!.estimatedCostMicroUsd).toBeDefined();
    const draft = draftOf(base);
    expect(draft.every((item) => !('estimatedCostMicroUsd' in item) && !('estimatedDurationMs' in item))).toBe(true);
    const checked = checkDraft(draft);
    expect(checked.ok && checked.subtasks.map((item) => item.subtaskId)).toEqual([s1, s2]);
  });

  it('adds, changes, orders and removes subtasks, and removes the dependencies on a removed one', () => {
    let draft = addSubtask(draftOf(base), ids.taskC, ids.taskA);
    draft = changeSubtask(draft, ids.taskC, { title: 'Check', instructions: 'Check the facts.', needsApproval: true });
    draft = toggleDependency(draft, ids.taskC, s2!);
    draft = moveSubtask(draft, ids.taskC, -1);
    expect(draft.map((item) => item.subtaskId)).toEqual([s1, ids.taskC, s2]);
    expect(moveSubtask(draft, s1!, -1)).toBe(draft);
    expect(checkDraft(draft).ok).toBe(true);
    draft = removeSubtask(draft, s2!);
    expect(draft.find((item) => item.subtaskId === ids.taskC)!.dependsOn).toEqual([]);
    expect(toggleDependency(toggleDependency(draft, ids.taskC, s1!), ids.taskC, s1!)).toEqual(draft);
  });

  it('drops the model of a subtask when its agent changes, and keeps it for other changes', () => {
    const draft = draftOf(base.map((item, index) => (index === 0 ? { ...item, model: 'openai/gpt-4.1-nano' } : item)));
    expect(changeSubtask(draft, s1!, { title: 'Facts 2' })[0]!.model).toBe('openai/gpt-4.1-nano');
    expect(changeSubtask(draft, s1!, { agentId: draft[0]!.agentId })[0]!.model).toBe('openai/gpt-4.1-nano');
    const changed = changeSubtask(draft, s1!, { agentId: ids.taskC });
    expect('model' in changed[0]!).toBe(false);
    const checked = checkDraft(changed);
    expect(checked.ok && 'model' in checked.subtasks[0]!).toBe(false);
    expect(checked.ok && checked.subtasks[0]!.agentId).toBe(ids.taskC);
  });

  it('names the problem of a bad draft', () => {
    const draft = draftOf(base);
    expect(checkDraft([])).toEqual({ ok: false, problem: 'count' });
    expect(checkDraft(changeSubtask(draft, s1!, { title: '   ' }))).toEqual({ ok: false, problem: 'text' });
    expect(checkDraft(toggleDependency(draft, s1!, s2!))).toEqual({ ok: false, problem: 'cycle' });
  });
});
