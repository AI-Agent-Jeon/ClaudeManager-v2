import type BetterSqlite3 from 'better-sqlite3';
import {
  AgentStatus,
  EntityType,
  ErrorCode,
  ProjectStatus,
  TaskStatus,
  type WaitingReason,
} from '../../shared/constants.js';
import type {
  Agent,
  AgentDetail,
  DeleteAgentResult,
  EntitySnapshot,
  Pagination,
} from '../../shared/types.js';
import type {
  AgentInsertRow,
  AgentRepository,
  AgentRow,
} from '../repositories/agent.repository.js';
import type { ConversationRepository } from '../repositories/conversation.repository.js';
import type { ProjectRepository } from '../repositories/project.repository.js';
import type { StatusChangeRepository } from '../repositories/status-change.repository.js';
import type { TaskRepository, TaskRow } from '../repositories/task.repository.js';
import { AppError } from '../utils/errors.js';
import { getAllowedTransitions, validateTransition } from '../utils/state-machine.js';
import type { ConversationService } from './conversation.service.js';

/**
 * AgentService (FR-007)
 *
 * 정의 원본: DES-004 v2.2 §7~8·§13 · §전체 함수 시그니습 요약 (Services)
 * 상태 머신: DES-007 v2.1 §3·§8
 *
 * 레이어 규칙(src/CLAUDE.md §레이어 규칙): Service는 자신의 Repository를 직접
 * 호출하고, 다른 애그리거트와의 연동은 "허용된 Service 간 의존 4건"
 * (Stage → Approval → Agent → Conversation)을 따른다 — 그래서 여기서
 * ConversationService를 호출한다. Task 캐스케이드는 TaskService가 아니라
 * TaskRepository를 직접 쓴다(ProjectService가 StatusChangeRepository를 직접
 * 쓰는 것과 같은 원칙 — Service→Service 의존을 허용 목록 밖으로 늘리지 않는다).
 */

export interface CreateAgentInput {
  projectId: string;
  name: string;
  type?: string;
  skill?: string;
  config?: Record<string, unknown>;
}

export interface ListAgentsOpts {
  page: number;
  pageSize: number;
  projectId?: string;
  status?: AgentStatus;
}

/** AgentDetail.tasks 조회 시 사용 — Phase 1 범위에서 Agent당 이 개수를 넘지 않는다 */
const AGENT_TASKS_LIMIT = 10_000;

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    type: row.type,
    status: row.status as AgentStatus,
    skill: row.skill,
    config: JSON.parse(row.config) as Record<string, unknown>,
    retryCount: row.retry_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTaskSummary(row: TaskRow) {
  return {
    id: row.id,
    agentId: row.agent_id,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AgentService {
  constructor(
    /** 트랜잭션 경계 전용. 쿼리는 Repository가 한다 (DES-004 §7) */
    private readonly db: BetterSqlite3.Database,
    private readonly agentRepo: AgentRepository,
    private readonly statusChangeRepo: StatusChangeRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly taskRepo: TaskRepository,
    private readonly conversationService: ConversationService,
    private readonly conversationRepo: ConversationRepository,
  ) {}

  /** FR-007 — Agent 생성은 채널 개설을 동반한다 (D-09 · DES-004 §7) */
  async create(input: CreateAgentInput): Promise<Agent> {
    const project = this.projectRepo.findById(input.projectId);
    if (!project) {
      throw new AppError(
        404,
        ErrorCode.PROJECT_NOT_FOUND,
        `프로젝트를 찾을 수 없습니다: ${input.projectId}`,
      );
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const insertRow: AgentInsertRow = {
      id,
      projectId: input.projectId,
      name: input.name,
      type: input.type ?? '',
      status: AgentStatus.CREATED,
      waitingReason: null,
      skill: input.skill ?? '',
      config: JSON.stringify(input.config ?? {}),
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    // DES-004 v2.4 §7 — 아래 3단계는 하나의 트랜잭션이다.
    // Agent만 만들어지고 채널이 없으면 `cm chat agent <id>`가 빈 채널을 만나 실패한다.
    //
    // 동기 코어(`ConversationService.createForAgentSync`)를 트랜잭션 콜백 안에서
    // 직접 호출한다 — `async`가 아니므로 내부에 `await`를 쓰면 컴파일이 실패해
    // "트랜잭션 콜백 안에서 안전하다"는 전제를 타입 체커가 강제한다(R-04와 같은
    // 패턴 · Layer 2-6). fire-and-forget(`void`)이 필요 없어졌다.
    const row = this.db.transaction((): AgentRow => {
      const inserted = this.agentRepo.insert(insertRow);

      this.statusChangeRepo.insert({
        entityType: EntityType.AGENT,
        entityId: id,
        fromStatus: null,
        toStatus: AgentStatus.CREATED,
        changedBy: 'system',
        changedAt: now,
      });

      this.conversationService.createForAgentSync(id);

      return inserted;
    })();

    return toAgent(row);
  }

  /** FR-007 */
  async list(opts: ListAgentsOpts): Promise<{ items: Agent[]; pagination: Pagination }> {
    const offset = (opts.page - 1) * opts.pageSize;
    const filter = { projectId: opts.projectId, status: opts.status };

    const rows = this.agentRepo.findMany({ offset, limit: opts.pageSize, ...filter });
    const total = this.agentRepo.count(filter);

    return {
      items: rows.map(toAgent),
      pagination: {
        page: opts.page,
        pageSize: opts.pageSize,
        total,
        totalPages: Math.ceil(total / opts.pageSize),
      },
    };
  }

  /** FR-007 — tasks·waitingReason·conversationId를 채운다 */
  async getById(id: string): Promise<AgentDetail> {
    const row = this.agentRepo.findById(id);
    if (!row) {
      throw new AppError(404, ErrorCode.AGENT_NOT_FOUND, `Agent를 찾을 수 없습니다: ${id}`);
    }

    const taskRows = this.taskRepo.findMany({ agentId: id, offset: 0, limit: AGENT_TASKS_LIMIT });
    const conversation = this.conversationRepo.findByEntityId(id);

    return {
      ...toAgent(row),
      tasks: taskRows.map(toTaskSummary),
      // status가 waiting일 때만 값을 가진다 (D-11)
      waitingReason:
        row.status === AgentStatus.WAITING ? (row.waiting_reason as WaitingReason | null) : null,
      conversationId: conversation?.id ?? null,
    };
  }

  /**
   * FR-007 — `waitingReason`은 3번째 인자다(v2.6 · Layer 2-6).
   * `newStatus !== 'waiting'`이면 값을 넘겨도 Repository가 NULL로 강제한다.
   * ApprovalService가 승인·의사결정 요청 발행 시 `waiting` 전이에 사유를 실어
   * 보내는 유일한 호출자다 — 이 라우트(PATCH /api/agents/:id/status)는 사유를
   * 받지 않으므로 기본값 null로 호출한다.
   */
  async updateStatus(
    id: string,
    newStatus: AgentStatus,
    waitingReason: WaitingReason | null = null,
  ): Promise<Agent> {
    const row = this.agentRepo.findById(id);
    if (!row) {
      throw new AppError(404, ErrorCode.AGENT_NOT_FOUND, `Agent를 찾을 수 없습니다: ${id}`);
    }

    const fromStatus = row.status;
    if (!validateTransition('agent', fromStatus, newStatus)) {
      const allowed = getAllowedTransitions('agent', fromStatus);
      throw new AppError(
        422,
        ErrorCode.INVALID_TRANSITION,
        `허용되지 않는 상태 전이입니다: ${fromStatus} → ${newStatus}`,
        { allowedTransitions: allowed },
      );
    }

    // 가드: created → running은 프로젝트가 running/waiting일 때만 (DES-007 v2 §8-1)
    if (fromStatus === AgentStatus.CREATED && newStatus === AgentStatus.RUNNING) {
      const project = this.projectRepo.findById(row.project_id);
      const activeStatuses: string[] = [ProjectStatus.RUNNING, ProjectStatus.WAITING];
      if (!project || !activeStatuses.includes(project.status)) {
        throw new AppError(
          422,
          ErrorCode.PARENT_NOT_ACTIVE,
          `프로젝트가 활성 상태가 아닙니다 (현재: ${project?.status ?? '알 수 없음'})`,
        );
      }
    }

    const now = new Date().toISOString();
    const updated = this.agentRepo.updateStatus(id, newStatus, waitingReason, now);

    this.statusChangeRepo.insert({
      entityType: EntityType.AGENT,
      entityId: id,
      fromStatus,
      toStatus: newStatus,
      changedBy: 'user',
      changedAt: now,
    });

    // 캐스케이드: Agent → cancelled/paused ⇒ 소속 활성 Task 일괄 전이 (DES-007 v2 §8)
    if (newStatus === AgentStatus.CANCELLED || newStatus === AgentStatus.PAUSED) {
      this.cascadeToTasks(id, newStatus, now);
    }

    // 채널 전이: Agent 종료(completed/cancelled) ⇒ CH-AGENT readonly (DES-007 v2 §8)
    if (newStatus === AgentStatus.COMPLETED || newStatus === AgentStatus.CANCELLED) {
      await this.conversationService.markReadonly(id);
    }

    return toAgent(updated);
  }

  /**
   * 동기 코어 — Agent 삭제(D-27 · DES-004 §13). 순서: ① 스냅샷(행이 살아있을
   * 때) ② 대화 아카이브 ③ Agent 삭제.
   *
   * `closedApprovalCount`는 이 메서드 안에서는 항상 0이다 — 실제 마감(R-04)은
   * `ApprovalService.closeByRequesterSync()`(Layer 2-6)의 몫이다. AgentService가
   * ApprovalService를 부르면 `ApprovalService → AgentService`(기존, 승인 처리 시
   * Agent 전이)와 양방향 순환이 된다. 그래서 `agents.routes.ts`의 DELETE
   * 핸들러가 `db.transaction()` 콜백 **안에서 두 동기 코어를 직접** 호출하고
   * (`closeByRequesterSync(id)` → `deleteSync(id)` 순), 실제 건수로 이 필드를
   * 덮어써 응답을 구성한다 (DES-004 §13 · 레이어 규칙 9).
   *
   * `async`가 아닌 이유가 곧 원자성 근거다 — better-sqlite3의 `db.transaction()`
   * 은 동기 콜백만 지원한다. 이 메서드에 `async`를 붙이면 본문에 `await`를 넣는
   * 실수가 컴파일을 통과해버리고, 그 순간 뒤따르는 쓰기(`agentRepo.deleteById`)가
   * 트랜잭션 밖(커밋 이후)으로 밀려 원자성이 조용히 깨진다. 동기로 남겨두면
   * `await`를 쓰는 순간 타입 에러가 나 컴파일이 실패한다 — 그래서
   * `conversationService.archiveByEntity`(await 필요)를 거치지 않고
   * `conversationRepo`를 직접(동기) 쓴다. `agent-atomicity.test.ts`·
   * `agent-delete-atomicity.test.ts`가 이 전제를 회귀 테스트로 지킨다.
   */
  deleteSync(id: string): DeleteAgentResult {
    const row = this.agentRepo.findById(id);
    if (!row) {
      throw new AppError(404, ErrorCode.AGENT_NOT_FOUND, `Agent를 찾을 수 없습니다: ${id}`);
    }

    // agents 행이 사라지면 이름을 얻을 수 없다 — 삭제 전에 만든다
    const project = this.projectRepo.findById(row.project_id);
    const snapshot: EntitySnapshot = {
      agentName: row.name,
      projectName: project?.name ?? '',
      // 필터링용 — 없으면 아카이브 채널이 ?project= 필터에서 사라진다 (D-27)
      projectId: row.project_id,
      agentType: row.type,
    };

    const conv = this.conversationRepo.findByEntityId(id);
    if (!conv) {
      throw new AppError(
        404,
        ErrorCode.CONVERSATION_NOT_FOUND,
        `Agent의 대화 채널을 찾을 수 없습니다: ${id}`,
      );
    }
    this.conversationRepo.archiveWithSnapshot(
      conv.id,
      JSON.stringify({
        agent_name: snapshot.agentName,
        project_name: snapshot.projectName,
        project_id: snapshot.projectId,
        agent_type: snapshot.agentType,
      }),
      new Date().toISOString(),
    );
    this.agentRepo.deleteById(id);

    return { archivedConversationId: conv.id, closedApprovalCount: 0 };
  }

  /**
   * 공개 API — DES-004 §전체 함수 시그니처 요약의 `Promise<DeleteAgentResult>`
   * 그대로다. 동기 코어(`deleteSync`)를 감싸는 얇은 래퍼이며, 단독 호출(트랜잭션
   * 조율이 필요 없는 경우)에 쓴다. R-04 트랜잭션 조율에는 동기 코어를 쓴다.
   */
  async delete(id: string): Promise<DeleteAgentResult> {
    return this.deleteSync(id);
  }

  /**
   * FIND-01 수정 — Project → Agent → Task 캐스케이드 진입점(대표 결정 B안).
   *
   * `projects.routes.ts`의 PATCH `.../status` 핸들러가 `ProjectService
   * .updateStatusSync()` 직후, 같은 `db.transaction()` 콜백 **안에서** 호출한다
   * (DES-001 v3.2 §레이어 규칙 9 — 교차 애그리거트 트랜잭션은 Route가 조율한다.
   * `agents.routes.ts`의 DELETE 핸들러(R-04)와 같은 패턴).
   *
   * Agent 상태 전이 쓰기를 이 Service(소유 Service)가 맡는다 — 이전
   * `ProjectService.cascadeToAgents()`는 `agentRepo.updateStatus`를 직접 불러
   * DES-001 v3.3 §레이어 규칙 10("상태 전이·검증이 붙은 쓰기는 Repository
   * 직접 접근 예외 대상이 아니다")을 어겼다(REV-M-01). 후보 조회
   * (`agentRepo.findActiveByProjectId`)는 AgentService 자신의 Repository이므로
   * 크로스 애그리거트 문제가 없다.
   *
   * Task로의 전파는 새로 만들지 않고 기존 `cascadeToTasks()`를 그대로
   * 재사용한다(중첩 캐스케이드) — DES-004 §6 "각 Agent 캐스케이드는 다시
   * 해당 Agent의 Task로 전파".
   *
   * `async`가 아니다 — better-sqlite3의 `db.transaction()`은 동기 콜백만
   * 지원한다. 여기 `await`를 쓰면 컴파일이 실패해 "트랜잭션 콜백 안에서
   * 안전하다"는 전제를 타입 체커가 강제한다(R-04·Layer 2-6과 같은 패턴).
   */
  cascadeFromProjectSync(
    projectId: string,
    projectNewStatus: typeof ProjectStatus.CANCELLED | typeof ProjectStatus.PAUSED,
    now: string,
  ): void {
    const targetStatus =
      projectNewStatus === ProjectStatus.CANCELLED ? AgentStatus.CANCELLED : AgentStatus.PAUSED;
    const candidates = this.agentRepo.findActiveByProjectId(projectId);

    for (const agent of candidates) {
      // 상태 머신이 허용하지 않는 전이는 건너뛴다(예: waiting은 paused로 갈 수 없다)
      if (!validateTransition('agent', agent.status, targetStatus)) continue;

      // 캐스케이드 대상은 cancelled/paused다 — waiting이 아니므로 waitingReason은 null이다
      this.agentRepo.updateStatus(agent.id, targetStatus, null, now);
      this.statusChangeRepo.insert({
        entityType: EntityType.AGENT,
        entityId: agent.id,
        fromStatus: agent.status,
        toStatus: targetStatus,
        changedBy: 'system',
        changedAt: now,
      });

      // 중첩 캐스케이드: Agent → Task (DES-004 §6, 기존 cascadeToTasks 재사용)
      this.cascadeToTasks(agent.id, targetStatus, now);
    }
  }

  private cascadeToTasks(agentId: string, agentNewStatus: AgentStatus, now: string): void {
    const targetStatus =
      agentNewStatus === AgentStatus.CANCELLED ? TaskStatus.CANCELLED : TaskStatus.PAUSED;
    const candidates = this.taskRepo.findActiveByAgentId(agentId);

    for (const task of candidates) {
      // 상태 머신이 허용하지 않는 전이는 건너뛴다(예: in_review는 cancelled로 갈 수 없다)
      if (!validateTransition('task', task.status, targetStatus)) continue;

      this.taskRepo.updateStatus(task.id, targetStatus, now);
      this.statusChangeRepo.insert({
        entityType: EntityType.TASK,
        entityId: task.id,
        fromStatus: task.status,
        toStatus: targetStatus,
        changedBy: 'system',
        changedAt: now,
      });
    }
  }
}
