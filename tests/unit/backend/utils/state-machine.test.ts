import { describe, expect, it } from 'vitest';
import {
  getAllowedTransitions,
  validateTransition,
} from '../../../../src/backend/utils/state-machine.js';

/**
 * State Machine — 순수 함수
 *
 * 정의 원본: DES-004 v2.2 §6 (StateMachine) · DES-007 v2.1 §2 프로젝트 상태 머신
 *
 * `TRANSITION_MAP`(src/shared/state-transitions.ts)을 조회하기만 한다.
 * 전이 규칙 자체(어떤 상태에서 어떤 상태로 갈 수 있는가)는
 * tests/unit/shared/state-transitions.test.ts가 이미 검증한다 — 여기서는
 * 이 함수가 그 맵을 올바르게 조회하는지만 본다.
 */
describe('validateTransition — DES-004 §6', () => {
  it('Given ready 상태 When running으로 조회하면 Then true (DES-007 §2)', () => {
    expect(validateTransition('project', 'ready', 'running')).toBe(true);
  });

  it('Given ready 상태 When completed로 조회하면 Then false — 허용 목록에 없다', () => {
    expect(validateTransition('project', 'ready', 'completed')).toBe(false);
  });

  it('Given 종료 상태(completed) When 어떤 전이든 조회하면 Then false', () => {
    expect(validateTransition('project', 'completed', 'running')).toBe(false);
  });

  it('정의되지 않은 fromStatus는 false를 돌려준다 (throw하지 않는다)', () => {
    expect(validateTransition('project', 'no-such-status', 'running')).toBe(false);
  });

  it('다른 엔티티 유형(task)의 전이도 같은 방식으로 조회한다 — DES-007 §4', () => {
    expect(validateTransition('task', 'in_progress', 'completed')).toBe(false);
    expect(validateTransition('task', 'in_review', 'completed')).toBe(true);
  });
});

describe('getAllowedTransitions — DES-004 §6', () => {
  it('Given running 상태 When 조회하면 Then 5개 허용 전이를 돌려준다 (DES-007 §2)', () => {
    expect(getAllowedTransitions('project', 'running')).toEqual([
      'waiting',
      'paused',
      'pending_completion',
      'failed',
      'cancelled',
    ]);
  });

  it('Given 종료 상태 When 조회하면 Then 빈 배열', () => {
    expect(getAllowedTransitions('project', 'completed')).toEqual([]);
  });

  it('정의되지 않은 fromStatus는 빈 배열을 돌려준다', () => {
    expect(getAllowedTransitions('project', 'no-such-status')).toEqual([]);
  });
});
