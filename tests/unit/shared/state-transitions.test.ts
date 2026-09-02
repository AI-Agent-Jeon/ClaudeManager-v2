import { describe, expect, it } from 'vitest';
import {
  AGENT_TRANSITIONS,
  APPROVAL_TRANSITIONS,
  CONVERSATION_TRANSITIONS,
  PROJECT_TRANSITIONS,
  STAGE_TRANSITIONS,
  TASK_TRANSITIONS,
  TRANSITION_MAP,
} from '../../../src/shared/state-transitions.js';

/**
 * 정의 원본: DES-007 v2.1 상태 흐름도 (상태 머신 6종)
 * 전이 맵은 데이터로 정의한다 — RISK-004(상태 전이 복잡성) 완화 방안.
 */
describe('Project 상태 머신 — DES-007 §2', () => {
  it('종료 상태는 전이가 없다', () => {
    expect(PROJECT_TRANSITIONS.completed).toEqual([]);
    expect(PROJECT_TRANSITIONS.cancelled).toEqual([]);
  });

  it('pending_completion은 completed 또는 running(반려)으로만 간다', () => {
    expect(PROJECT_TRANSITIONS.pending_completion).toEqual(['completed', 'running']);
  });

  it('running에서 5개 상태로 갈 수 있다', () => {
    expect(PROJECT_TRANSITIONS.running).toEqual([
      'waiting',
      'paused',
      'pending_completion',
      'failed',
      'cancelled',
    ]);
  });
});

describe('Agent 상태 머신 — DES-007 §3', () => {
  it('created에서 running·cancelled로만 간다', () => {
    expect(AGENT_TRANSITIONS.created).toEqual(['running', 'cancelled']);
  });

  it('Project와 달리 pending_completion이 없다', () => {
    expect(AGENT_TRANSITIONS).not.toHaveProperty('pending_completion');
    expect(AGENT_TRANSITIONS.running).not.toContain('pending_completion');
  });

  it('종료 상태는 전이가 없다', () => {
    expect(AGENT_TRANSITIONS.completed).toEqual([]);
    expect(AGENT_TRANSITIONS.cancelled).toEqual([]);
  });
});

describe('Task 상태 머신 — DES-007 §4', () => {
  it('in_progress는 in_review를 거쳐야 completed가 된다', () => {
    expect(AGENT_TRANSITIONS.running).toContain('completed');
    // Task는 직접 completed로 가지 않는다
    expect(TASK_TRANSITIONS.in_progress).not.toContain('completed');
    expect(TASK_TRANSITIONS.in_review).toContain('completed');
  });

  it('in_review에서 재작업으로 in_progress 복귀가 가능하다', () => {
    expect(TASK_TRANSITIONS.in_review).toContain('in_progress');
  });

  it('skipped는 종료 상태다', () => {
    expect(TASK_TRANSITIONS.skipped).toEqual([]);
  });
});

describe('대화 채널 상태 머신 — DES-007 §5 (D-27)', () => {
  it('active → readonly → archived 단방향이다', () => {
    expect(CONVERSATION_TRANSITIONS.active).toEqual(['readonly', 'archived']);
    expect(CONVERSATION_TRANSITIONS.readonly).toEqual(['archived']);
  });

  it('archived에서 되돌아가는 전이는 없다', () => {
    // Agent 행이 이미 삭제되었으므로 되살릴 대상이 없다
    expect(CONVERSATION_TRANSITIONS.archived).toEqual([]);
  });
});

describe('승인 상태 머신 — DES-007 §6', () => {
  it('pending에서 4개 종료 상태로 간다', () => {
    expect(APPROVAL_TRANSITIONS.pending).toEqual([
      'approved',
      'rejected',
      'conditional',
      'auto_advanced',
    ]);
  });

  it('conditional은 종료 상태다 — 재전이하지 않는다', () => {
    // R-05: 조건 충족 확인은 새 승인 사이클이지 같은 건의 재전이가 아니다
    expect(APPROVAL_TRANSITIONS.conditional).toEqual([]);
  });

  it('모든 비-pending 상태가 종료 상태다', () => {
    expect(APPROVAL_TRANSITIONS.approved).toEqual([]);
    expect(APPROVAL_TRANSITIONS.rejected).toEqual([]);
    expect(APPROVAL_TRANSITIONS.auto_advanced).toEqual([]);
  });
});

describe('단계 상태 머신 — DES-007 §7 (R-03)', () => {
  it('선형 3상태다 — 되돌아가는 전이가 없다', () => {
    expect(STAGE_TRANSITIONS.pending).toEqual(['in_progress']);
    expect(STAGE_TRANSITIONS.in_progress).toEqual(['completed']);
    expect(STAGE_TRANSITIONS.completed).toEqual([]);
  });

  it('in_progress → pending 복귀가 없다', () => {
    // 게이트를 통과 못하면 애초에 in_progress가 되지 못하므로
    // "게이트 반려로 복귀"는 도달 불가능한 전이였다
    expect(STAGE_TRANSITIONS.in_progress).not.toContain('pending');
  });
});

describe('TRANSITION_MAP — 엔티티별 조회', () => {
  it('6종 상태 머신을 전부 담는다', () => {
    expect(Object.keys(TRANSITION_MAP).sort()).toEqual([
      'agent',
      'approval',
      'conversation',
      'project',
      'stage',
      'task',
    ]);
  });

  it('EntityType으로 전이 맵을 조회할 수 있다', () => {
    expect(TRANSITION_MAP.project).toBe(PROJECT_TRANSITIONS);
    expect(TRANSITION_MAP.stage).toBe(STAGE_TRANSITIONS);
  });
});
