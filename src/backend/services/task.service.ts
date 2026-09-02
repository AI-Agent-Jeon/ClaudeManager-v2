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
}
