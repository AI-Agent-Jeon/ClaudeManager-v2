import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApprovalTimeoutJob,
  type JobLogger,
} from '../../../../src/backend/jobs/approval-timeout.job.js';
import { AgentRepository } from '../../../../src/backend/repositories/agent.repository.js';
import { ApprovalRepository } from '../../../../src/backend/repositories/approval.repository.js';
import { ArtifactRepository } from '../../../../src/backend/repositories/artifact.repository.js';
import { ConversationRepository } from '../../../../src/backend/repositories/conversation.repository.js';
import { MessageRepository } from '../../../../src/backend/repositories/message.repository.js';
import { ProjectRepository } from '../../../../src/backend/repositories/project.repository.js';
import { StatusChangeRepository } from '../../../../src/backend/repositories/status-change.repository.js';
import { TaskRepository } from '../../../../src/backend/repositories/task.repository.js';
import { AgentService } from '../../../../src/backend/services/agent.service.js';
import { ApprovalService } from '../../../../src/backend/services/approval.service.js';
import { ConversationService } from '../../../../src/backend/services/conversation.service.js';
import { TaskService } from '../../../../src/backend/services/task.service.js';
import { WebSocketHub } from '../../../../src/backend/ws/hub.js';
import type { ApprovalSummary } from '../../../../src/shared/types.js';
import {
  createTestDb,
  seedAgent,
  seedAgentChannel,
  seedApproval,
  seedMessage,
  seedProject,
  type TestDb,
} from '../../../fixtures/test-db.js';

/**
 * ApprovalTimeoutJob (R-2, D-10)
 *
 * 정의 원본: DES-004 v2.4 §17 · DES-001 v3.2 ADR-012
 *
 * 60초 주기 대신 짧은 intervalMs를 생성자에 넘겨 vitest fake timer로 tick을
 * 직접 통제한다. `tick()`은 private이므로 `start()` + `vi.advanceTimersByTimeAsync`로만
 * 접근한다 — 실제 배치 경로(setInterval)를 그대로 검증한다.
 */

let testDb: TestDb;
let approvalRepo: ApprovalRepository;
let agentRepo: AgentRepository;
let approvalService: ApprovalService;
let logger: JobLogger & { error: ReturnType<typeof vi.fn> };

function buildApprovalService(db: TestDb['db']): ApprovalService {
  const conversationRepo = new ConversationRepository(db);
  const messageRepo = new MessageRepository(db);
  const statusChangeRepo = new StatusChangeRepository(db);
  const conversationService = new ConversationService(conversationRepo, messageRepo);
  const agentService = new AgentService(
    db,
    agentRepo,
    statusChangeRepo,
    new ProjectRepository(db),
    new TaskService(new TaskRepository(db), statusChangeRepo, agentRepo),
    conversationService,
    conversationRepo,
  );

  return new ApprovalService(
    db,
    approvalRepo,
    statusChangeRepo,
    messageRepo,
    conversationRepo,
    agentRepo,
    new ArtifactRepository(db),
    agentService,
    new WebSocketHub(),
  );
}

beforeEach(() => {
  testDb = createTestDb();
  approvalRepo = new ApprovalRepository(testDb.db);
  agentRepo = new AgentRepository(testDb.db);
  approvalService = buildApprovalService(testDb.db);
  logger = { error: vi.fn() };
});

afterEach(() => {
  vi.useRealTimers();
  testDb.close();
});

/** 대기 중(waiting) Agent 한 명 + 그 채널을 만든다. `approval.service.test.ts`의 helper와 동형 */
function seedWaitingAgent(): { agentId: string; conversationId: string } {
  const projectId = seedProject(testDb.db, { status: 'running' });
  const agentId = seedAgent(testDb.db, projectId, {
    status: 'waiting',
    waitingReason: 'ceo_approval',
  });
  const conversationId = seedAgentChannel(testDb.db, agentId);
  return { agentId, conversationId };
}

/**
 * DB CHECK 제약 `NOT (level = 'high' AND deadline_at IS NOT NULL)`이 `deadline_at`을
 * 강제로 채운 GATE 행 자체를 거부한다(마이그레이션 004 CHECK (2)·(4)) — 이중 방어 ①은
 * 쿼리 조건이 아니라 **DB 스키마 레벨**에서도 걸려 있다는 뜻이다. 그래서 "슬쩍 통과한
 * GATE"는 실제 DB로 재현할 수 없고, `findExpired()`의 반환 목록에 (있을 수 없는 방식으로)
 * 섞여 들어온 상황을 흉내내 이중 방어 ②(잡·`autoAdvance()` 내부의 유형 재검사)만 분리
 * 검증한다. `autoAdvance()`는 실제 `ApprovalService` 구현을 그대로 호출한다.
 */
function forceGateIntoExpiredList(
  real: ApprovalService,
  gateId: string,
): {
  findExpired: (now: string) => Promise<ApprovalSummary[]>;
  autoAdvance: typeof real.autoAdvance;
} {
  const forcedGateSummary: ApprovalSummary = {
    id: gateId,
    approvalType: 'APV-GATE',
    level: 'high',
    subject: '강제 주입 GATE',
    requestedBy: 'main',
    status: 'pending',
    deadlineAt: null,
    elapsedSeconds: 0,
    remainingSeconds: null,
    createdAt: new Date().toISOString(),
  };

  return {
    findExpired: async (now: string) => [forcedGateSummary, ...(await real.findExpired(now))],
    autoAdvance: real.autoAdvance.bind(real),
  };
}

describe('ApprovalTimeoutJob.tick — 만료된 medium 승인 자동 진행', () => {
  it('auto_advanced로 바뀌고 MSG-05가 기록되며 Agent가 running으로 돌아온다', async () => {
    vi.useFakeTimers();
    const { agentId, conversationId } = seedWaitingAgent();
    const requestMessageId = seedMessage(testDb.db, conversationId, {
      msgType: 'MSG-04',
      senderRole: 'agent',
    });
    const approvalId = seedApproval(testDb.db, {
      requestedBy: agentId,
      level: 'medium',
      status: 'pending',
      messageId: requestMessageId,
      deadlineAt: '2020-01-01T00:00:00.000Z',
    });

    const job = new ApprovalTimeoutJob(approvalService, logger, 1000);
    job.start();
    await vi.advanceTimersByTimeAsync(1000);
    job.stop();

    expect(approvalRepo.findById(approvalId)?.status).toBe('auto_advanced');
    expect(agentRepo.findById(agentId)?.status).toBe('running');

    const messages = testDb.db
      .prepare('SELECT msg_type FROM messages WHERE conversation_id = ?')
      .all(conversationId) as { msg_type: string }[];
    expect(messages.some((m) => m.msg_type === 'MSG-05')).toBe(true);
  });
});

describe('ApprovalTimeoutJob.tick — high 등급 제외', () => {
  it('deadline_at이 NULL인 high 승인은 대상에서 제외되어 pending으로 남는다', async () => {
    vi.useFakeTimers();
    const approvalId = seedApproval(testDb.db, {
      level: 'high',
      status: 'pending',
      deadlineAt: null,
    });

    const job = new ApprovalTimeoutJob(approvalService, logger, 1000);
    job.start();
    await vi.advanceTimersByTimeAsync(1000);
    job.stop();

    expect(approvalRepo.findById(approvalId)?.status).toBe('pending');
  });
});

describe('ApprovalTimeoutJob.tick — APV-GATE 이중 방어', () => {
  it('①조회 조건에서 제외 — GATE는 deadline_at이 NULL이라 findExpired에 잡히지 않는다', async () => {
    vi.useFakeTimers();
    seedApproval(testDb.db, { approvalType: 'APV-GATE', level: 'high', status: 'pending' });

    const now = new Date().toISOString();
    const expired = await approvalService.findExpired(now);
    expect(expired).toEqual([]);
  });

  it('②잡 내부 검사에서도 거부 — findExpired에 GATE가 (있을 수 없는 방식으로) 섞여도 처리되지 않고 로깅 후 넘어간다', async () => {
    vi.useFakeTimers();
    const gateId = seedApproval(testDb.db, {
      approvalType: 'APV-GATE',
      level: 'high',
      status: 'pending',
      deadlineAt: null,
    });
    const forcedService = forceGateIntoExpiredList(
      approvalService,
      gateId,
    ) as unknown as ApprovalService;

    const job = new ApprovalTimeoutJob(forcedService, logger, 1000);
    job.start();
    await vi.advanceTimersByTimeAsync(1000);
    job.stop();

    expect(approvalRepo.findById(gateId)?.status).toBe('pending');
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('ApprovalTimeoutJob.tick — 한 건 실패해도 나머지는 처리된다', () => {
  it('GATE(실패) 옆의 정상 medium 건은 그대로 auto_advanced된다', async () => {
    vi.useFakeTimers();
    const gateId = seedApproval(testDb.db, {
      approvalType: 'APV-GATE',
      level: 'high',
      status: 'pending',
      deadlineAt: null,
    });
    const { agentId, conversationId } = seedWaitingAgent();
    const requestMessageId = seedMessage(testDb.db, conversationId, { msgType: 'MSG-04' });
    const okId = seedApproval(testDb.db, {
      requestedBy: agentId,
      level: 'medium',
      status: 'pending',
      messageId: requestMessageId,
      deadlineAt: '2020-01-01T00:00:00.000Z',
    });
    const forcedService = forceGateIntoExpiredList(
      approvalService,
      gateId,
    ) as unknown as ApprovalService;

    const job = new ApprovalTimeoutJob(forcedService, logger, 1000);
    job.start();
    await vi.advanceTimersByTimeAsync(1000);
    job.stop();

    expect(approvalRepo.findById(gateId)?.status).toBe('pending');
    expect(approvalRepo.findById(okId)?.status).toBe('auto_advanced');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe('ApprovalTimeoutJob — 재진입 방지 (이전 tick 실행 중이면 건너뛴다)', () => {
  it('첫 tick이 끝나지 않은 채 다음 주기가 와도 findExpired를 다시 호출하지 않는다', async () => {
    vi.useFakeTimers();

    let releaseFirst: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const findExpired = vi.fn().mockImplementationOnce(async () => {
      await gate;
      return [];
    });
    findExpired.mockImplementation(async () => []);
    const autoAdvance = vi.fn();
    const stubApprovalService = { findExpired, autoAdvance } as unknown as ApprovalService;

    const job = new ApprovalTimeoutJob(stubApprovalService, logger, 1000);
    job.start();

    // 1주기 — findExpired 호출, gate에 걸려 tick이 아직 끝나지 않는다
    await vi.advanceTimersByTimeAsync(1000);
    expect(findExpired).toHaveBeenCalledTimes(1);

    // 2주기 — 이전 tick이 아직 실행 중이므로 건너뛴다
    await vi.advanceTimersByTimeAsync(1000);
    expect(findExpired).toHaveBeenCalledTimes(1);

    // 1주기의 tick을 풀어준다 — ticking 플래그가 해제된다
    releaseFirst();
    await gate;
    await Promise.resolve();
    await Promise.resolve();

    // 3주기 — 이제는 정상적으로 다시 호출된다
    await vi.advanceTimersByTimeAsync(1000);
    expect(findExpired).toHaveBeenCalledTimes(2);

    job.stop();
  });
});

describe('ApprovalTimeoutJob.tick — findExpired 자체가 실패해도 서버를 죽이지 않는다', () => {
  it('tick 내부 예외를 로깅 후 삼키고, 다음 주기는 정상 진행된다', async () => {
    vi.useFakeTimers();
    const findExpired = vi
      .fn()
      .mockRejectedValueOnce(new Error('DB 일시 장애'))
      .mockResolvedValue([]);
    const stubApprovalService = {
      findExpired,
      autoAdvance: vi.fn(),
    } as unknown as ApprovalService;

    const job = new ApprovalTimeoutJob(stubApprovalService, logger, 1000);
    job.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(logger.error).toHaveBeenCalledTimes(1);

    // 다음 주기가 재진입 방지 플래그에 막히지 않고 정상적으로 다시 호출된다
    await vi.advanceTimersByTimeAsync(1000);
    expect(findExpired).toHaveBeenCalledTimes(2);

    job.stop();
  });
});

describe('ApprovalTimeoutJob.stop', () => {
  it('stop() 후에는 타이머가 더 이상 돌지 않는다', async () => {
    vi.useFakeTimers();
    const findExpired = vi.fn().mockResolvedValue([]);
    const stubApprovalService = {
      findExpired,
      autoAdvance: vi.fn(),
    } as unknown as ApprovalService;

    const job = new ApprovalTimeoutJob(stubApprovalService, logger, 1000);
    job.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(findExpired).toHaveBeenCalledTimes(1);

    job.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(findExpired).toHaveBeenCalledTimes(1);
  });

  it('start()를 두 번 호출해도 타이머는 하나만 돈다', async () => {
    vi.useFakeTimers();
    const findExpired = vi.fn().mockResolvedValue([]);
    const stubApprovalService = {
      findExpired,
      autoAdvance: vi.fn(),
    } as unknown as ApprovalService;

    const job = new ApprovalTimeoutJob(stubApprovalService, logger, 1000);
    job.start();
    job.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(findExpired).toHaveBeenCalledTimes(1);

    job.stop();
  });
});
