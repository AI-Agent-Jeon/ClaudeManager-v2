import { AgentStatus, EntityType, ErrorCode, TaskStatus } from '../../shared/constants.js';
import type { Pagination, Task } from '../../shared/types.js';
import type { AgentRepository } from '../repositories/agent.repository.js';
import type { StatusChangeRepository } from '../repositories/status-change.repository.js';
import type { TaskInsertRow, TaskRepository, TaskRow } from '../repositories/task.repository.js';
import { AppError } from '../utils/errors.js';
import { getAllowedTransitions, validateTransition } from '../utils/state-machine.js';

/**
 * TaskService (FR-008)
 *
 * 정의 원본: DES-004 v2.2 §9~11 · §전체 함수 시그니처 요약 (Services)
 * 상태 머신: DES-007 v2.1 §4·§8
 *
 * 레이어 규칙(src/CLAUDE.md §레이어 규칙): Service는 Repository만 호출한다.
 * PARENT_NOT_ACTIVE 가드는 AgentService를 부르지 않고 AgentRepository를
 * 직접 조회한다 — Task→Agent는 "허용된 Service 간 의존 4건"에 없다.
 *
 * R2-02 (2026-09-03, 대표 결정 b안) — `cascadeStatusSync()`가 Agent →
 * Task 상태 캐스케이드를 소유한다. 이전에는 `AgentService.cascadeToTasks()`가
 * `taskRepo.updateStatus()`로 Task 애그리거트에 직접 썼다 — DES-001 §레이어
 * 규칙 10 "상태 전이·검증이 붙은 쓰기는 Repository 직접 접근 예외 대상이
 * 아니다" 위반이었다. `AgentService`가 이제 `TaskRepository` 대신
 * `TaskService`를 주입받아 이 메서드를 호출한다 — "허용된 Service 간 의존"이
 * 4건에서 5건(`Agent → Task` 추가)으로 늘었다(대표 승인). `TaskService`는
 * `AgentService`를 부르지 않는다 — 위상 정렬 무순환(`Stage → Approval →
 * Agent → {Conversation, Task}`)을 유지한다.
 */

export interface CreateTaskInput {
  agentId: string;
  title: string;
  description?: string;
}

export interface ListTasksOpts {
  page: number;
  pageSize: number;
  agentId?: string;
  status?: TaskStatus;
}

function toTask(row: TaskRow): Task {
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

export class TaskService {
  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly statusChangeRepo: StatusChangeRepository,
    private readonly agentRepo: AgentRepository,
  ) {}

  /** FR-008 */
  async create(input: CreateTaskInput): Promise<Task> {
    const agent = this.agentRepo.findById(input.agentId);
    if (!agent) {
      throw new AppError(
        404,
        ErrorCode.AGENT_NOT_FOUND,
        `Agent를 찾을 수 없습니다: ${input.agentId}`,
      );
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const insertRow: TaskInsertRow = {
      id,
      agentId: input.agentId,
      title: input.title,
      description: input.description ?? '',
      status: TaskStatus.READY,
      createdAt: now,
      updatedAt: now,
    };

    const row = this.taskRepo.insert(insertRow);

    this.statusChangeRepo.insert({
      entityType: EntityType.TASK,
      entityId: id,
      fromStatus: null,
      toStatus: TaskStatus.READY,
      changedBy: 'system',
      changedAt: now,
    });

    return toTask(row);
  }

  /** FR-008 */
  async list(opts: ListTasksOpts): Promise<{ items: Task[]; pagination: Pagination }> {
    const offset = (opts.page - 1) * opts.pageSize;
    const filter = { agentId: opts.agentId, status: opts.status };

    const rows = this.taskRepo.findMany({ offset, limit: opts.pageSize, ...filter });
    const total = this.taskRepo.count(filter);

    return {
      items: rows.map(toTask),
      pagination: {
        page: opts.page,
        pageSize: opts.pageSize,
        total,
        totalPages: Math.ceil(total / opts.pageSize),
      },
    };
  }

  /** FR-008 */
  async getById(id: string): Promise<Task> {
    const row = this.taskRepo.findById(id);
    if (!row) {
      throw new AppError(404, ErrorCode.TASK_NOT_FOUND, `Task를 찾을 수 없습니다: ${id}`);
    }
    return toTask(row);
  }

  /**
   * FR-008 — `in_review`를 거쳐야 `completed`가 된다. 직접 전이가 없는 것은
   * `TASK_TRANSITIONS`(DES-007 v2 §4)가 이미 강제한다 — `validateTransition`이
   * `ready`·`in_progress` → `completed`를 거부한다.
   */
  async updateStatus(id: string, newStatus: TaskStatus): Promise<Task> {
    const row = this.taskRepo.findById(id);
    if (!row) {
      throw new AppError(404, ErrorCode.TASK_NOT_FOUND, `Task를 찾을 수 없습니다: ${id}`);
    }

    const fromStatus = row.status;
    if (!validateTransition('task', fromStatus, newStatus)) {
      const allowed = getAllowedTransitions('task', fromStatus);
      throw new AppError(
        422,
        ErrorCode.INVALID_TRANSITION,
        `허용되지 않는 상태 전이입니다: ${fromStatus} → ${newStatus}`,
        { allowedTransitions: allowed },
      );
    }

    // 가드: ready → in_progress는 Agent가 running일 때만 (DES-007 v2 §8-1)
    if (fromStatus === TaskStatus.READY && newStatus === TaskStatus.IN_PROGRESS) {
      const agent = this.agentRepo.findById(row.agent_id);
      if (!agent || agent.status !== AgentStatus.RUNNING) {
        throw new AppError(
          422,
          ErrorCode.PARENT_NOT_ACTIVE,
          `Agent가 활성 상태가 아닙니다 (현재: ${agent?.status ?? '알 수 없음'})`,
        );
      }
    }

    const now = new Date().toISOString();
    const updated = this.taskRepo.updateStatus(id, newStatus, now);

    this.statusChangeRepo.insert({
      entityType: EntityType.TASK,
      entityId: id,
      fromStatus,
      toStatus: newStatus,
      changedBy: 'user',
      changedAt: now,
    });

    return toTask(updated);
  }

  /**
   * 동기 코어 — Agent → Task 상태 캐스케이드 (R2-02 · DES-004 §6 · DES-007 v2 §8).
   * `AgentService`가 자신의 cancelled/paused 전이 직후(`updateStatus()`) 또는
   * Project 캐스케이드의 중첩 호출(`cascadeFromProjectSync()`)로 호출한다.
   *
   * 동작은 이전 `AgentService.cascadeToTasks()`(private)와 완전히 동일하다 —
   * 후보는 `taskRepo.findActiveByAgentId`(in_progress·ready)로 조회하고,
   * 상태 머신이 허용하지 않는 전이는 건너뛰며, `changedBy: 'system'`으로
   * 이력을 남긴다. 옮기면서 로직을 바꾸지 않았다.
   *
   * `async`가 아니다 — `markReadonlySync`·`cascadeFromProjectSync`와 같은
   * 패턴이다. `AgentService.cascadeFromProjectSync()`는 `db.transaction()`의
   * 동기 콜백 안에서 호출되므로, 여기 `await`를 쓰면 컴파일이 실패해
   * "트랜잭션 콜백 안에서 안전하다"는 전제를 타입 체커가 강제한다.
   */
  cascadeStatusSync(
    agentId: string,
    agentNewStatus: typeof AgentStatus.CANCELLED | typeof AgentStatus.PAUSED,
    now: string,
  ): void {
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
