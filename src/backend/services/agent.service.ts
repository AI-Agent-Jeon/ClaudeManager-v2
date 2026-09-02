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
    // ⚠ 트랜잭션 안에서 `createForAgent`를 await하지 않는다. better-sqlite3의
    //   트랜잭션은 동기 함수만 감싸며, await를 걸면 그 뒤 코드가 커밋 이후로
    //   밀려 채널이 트랜잭션 밖에서 만들어진다.
    //   `ConversationService.createForAgent`의 본문은 전부 동기 호출이라
    //   안전하다 — **이 전제가 깨지면 안 된다.** rollback 테스트가 지킨다.
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

      void this.conversationService.createForAgent(id);

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

  /** FR-007 */
  async updateStatus(id: string, newStatus: AgentStatus): Promise<Agent> {
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
    const updated = this.agentRepo.updateStatus(id, newStatus, now);

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
   * FR-007 — Agent 삭제는 대화를 보존한다 (D-27 · DES-004 §13).
   * 순서: ① 스냅샷(행이 살아있을 때) ② 대화 아카이브 ③ Agent 삭제.
   *
   * `closedApprovalCount`는 지금 항상 0이다 — 승인 마감(R-04)은 ApprovalService
   * (Layer 2-6)의 몫이다. AgentService가 ApprovalService를 부르면
   * `ApprovalService → AgentService`(기존, 승인 처리 시 Agent 전이)와 양방향
   * 순환이 된다. 2-6에서 Route가 `db.transaction()`으로 두 Service를 조율한다
   * (DES-004 §13 · 레이어 규칙 9).
   */
  async delete(id: string): Promise<DeleteAgentResult> {
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

    const archivedConversationId = await this.conversationService.archiveByEntity(id, snapshot);
    this.agentRepo.deleteById(id);

    return { archivedConversationId, closedApprovalCount: 0 };
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
