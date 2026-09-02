import { describe, expect, it } from 'vitest';
import {
  AgentStatus,
  ApprovalStatus,
  ApprovalType,
  ArtifactStatus,
  ChannelType,
  ConversationStatus,
  DecisionLevel,
  EntityType,
  ErrorCode,
  MessageType,
  ProjectStatus,
  SenderRole,
  SkillName,
  StageStatus,
  SyncStatus,
  TaskStatus,
  WaitingReason,
  WsCloseCode,
} from '../../../src/shared/constants.js';

/**
 * 정의 원본: DES-009 v3.1 §상태 코드 · §대화·승인·진행 코드
 * 이 테스트는 "설계서의 Enum 값이 코드에 그대로 있는가"를 강제한다.
 * 값이 하나라도 다르면 DB CHECK 제약(DES-003 v2.1)과 어긋난다.
 */
describe('상태 Enum — DES-009 v3.1', () => {
  it('ProjectStatus는 8종이다', () => {
    expect(Object.values(ProjectStatus)).toEqual([
      'ready',
      'running',
      'waiting',
      'paused',
      'pending_completion',
      'completed',
      'failed',
      'cancelled',
    ]);
  });

  it('AgentStatus는 7종이다 — pending_completion이 없다', () => {
    expect(Object.values(AgentStatus)).toEqual([
      'created',
      'running',
      'waiting',
      'paused',
      'completed',
      'failed',
      'cancelled',
    ]);
    // Agent는 작업 완료 시 자동으로 completed 전이한다 (DES-007 §10)
    expect(Object.values(AgentStatus)).not.toContain('pending_completion');
  });

  it('TaskStatus는 8종이다', () => {
    expect(Object.values(TaskStatus)).toEqual([
      'ready',
      'in_progress',
      'in_review',
      'paused',
      'completed',
      'failed',
      'cancelled',
      'skipped',
    ]);
  });

  it('EntityType은 6종이다 — status_changes CHECK 제약과 일치해야 한다', () => {
    // DES-003 v2.1 §3-5: 상태 머신이 6개이므로 기록 대상도 6종이다
    expect(Object.values(EntityType)).toEqual([
      'project',
      'agent',
      'task',
      'conversation',
      'approval',
      'stage',
    ]);
  });
});

describe('대화 Enum — DES-009 v3.1', () => {
  it('MessageType은 MSG-01~06 코드 문자열이다', () => {
    expect(Object.values(MessageType)).toEqual([
      'MSG-01',
      'MSG-02',
      'MSG-03',
      'MSG-04',
      'MSG-05',
      'MSG-06',
    ]);
  });

  it('ChannelType은 main·agent 2종이다', () => {
    expect(Object.values(ChannelType)).toEqual(['main', 'agent']);
  });

  it('ConversationStatus는 3종이다 — archived 포함 (D-27)', () => {
    expect(Object.values(ConversationStatus)).toEqual(['active', 'readonly', 'archived']);
  });

  it('SenderRole은 4종이다', () => {
    expect(Object.values(SenderRole)).toEqual(['ceo', 'main', 'agent', 'system']);
  });
});

describe('승인 Enum — DES-009 v3.1', () => {
  it('ApprovalType은 APV-* 6종이다', () => {
    expect(Object.values(ApprovalType)).toEqual([
      'APV-GATE',
      'APV-ARCH',
      'APV-DEPLOY',
      'APV-EXT',
      'APV-CHOICE',
      'APV-RETRY',
    ]);
  });

  it("ApprovalStatus는 5종이며 'expired'가 없다", () => {
    // 만료는 별도 상태가 아니라 auto_advanced로 귀결된다 (DES-007 v2 §6)
    expect(Object.values(ApprovalStatus)).toEqual([
      'pending',
      'approved',
      'rejected',
      'conditional',
      'auto_advanced',
    ]);
    expect(Object.values(ApprovalStatus)).not.toContain('expired');
  });

  it("DecisionLevel은 판정용 3종이지만 'low'는 적재 대상이 아니다", () => {
    expect(Object.values(DecisionLevel)).toEqual(['high', 'medium', 'low']);
  });

  it('WaitingReason은 3종이다 (D-11)', () => {
    // 무기한 대기(높음)와 30분 타임아웃(보통)을 구분해야 한다
    expect(Object.values(WaitingReason)).toEqual([
      'ceo_approval',
      'ceo_decision',
      'external_input',
    ]);
  });
});

describe('진행 Enum — DES-009 v3.1', () => {
  it('SkillName은 SDLC 7단계다', () => {
    expect(Object.values(SkillName)).toEqual([
      'plan',
      'analyze',
      'design',
      'develop',
      'test',
      'deploy',
      'operate',
    ]);
  });

  it('StageStatus는 3종이다', () => {
    expect(Object.values(StageStatus)).toEqual(['pending', 'in_progress', 'completed']);
  });

  it('ArtifactStatus는 3종이다', () => {
    expect(Object.values(ArtifactStatus)).toEqual(['draft', 'review', 'approved']);
  });

  it('SyncStatus는 4종이다 — notion_only와 missing을 구분한다', () => {
    // 2026-09-01 "analyze 건너뜀" 오진단이 이 둘을 혼동한 사고였다
    expect(Object.values(SyncStatus)).toEqual(['synced', 'notion_only', 'git_only', 'missing']);
  });
});

describe('에러 코드 — DES-009 v3.1', () => {
  it('대화·승인·진행 신규 9종을 포함한다', () => {
    const 신규 = [
      'CONVERSATION_NOT_FOUND',
      'CONVERSATION_ARCHIVED',
      'APPROVAL_NOT_FOUND',
      'APPROVAL_ALREADY_RESOLVED',
      'APPROVAL_REASON_REQUIRED',
      'GATE_AUTO_ADVANCE_FORBIDDEN',
      'GATE_NOT_PASSED',
      'WIP_VIOLATION',
      'STAGE_NOT_FOUND',
    ];
    for (const code of 신규) {
      expect(Object.values(ErrorCode)).toContain(code);
    }
  });

  it('기존 공통·도메인 코드를 유지한다', () => {
    expect(ErrorCode.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    expect(ErrorCode.INVALID_TRANSITION).toBe('INVALID_TRANSITION');
    expect(ErrorCode.PARENT_NOT_ACTIVE).toBe('PARENT_NOT_ACTIVE');
  });

  it('모든 에러 코드의 키와 값이 동일하다', () => {
    for (const [key, value] of Object.entries(ErrorCode)) {
      expect(value).toBe(key);
    }
  });

  it('PUSH_SUBSCRIPTION_INVALID는 Phase 2라 없다', () => {
    expect(Object.values(ErrorCode)).not.toContain('PUSH_SUBSCRIPTION_INVALID');
  });
});

describe('WebSocket close code — DES-009 v3.1', () => {
  it('3종을 정의한다', () => {
    expect(WsCloseCode.GOING_AWAY).toBe(1001);
    expect(WsCloseCode.UNAUTHORIZED).toBe(4001);
    expect(WsCloseCode.NOT_FOUND).toBe(4004);
  });
});
