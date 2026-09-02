import { AgentStatus, EntityType, ErrorCode, type ProjectStatus } from '../../shared/constants.js';
import type { Agent, Pagination, Project, ProjectDetail } from '../../shared/types.js';
import type { AgentRepository, AgentRow } from '../repositories/agent.repository.js';
import type { ProjectRepository, ProjectRow } from '../repositories/project.repository.js';
import type { StatusChangeRepository } from '../repositories/status-change.repository.js';
import { AppError } from '../utils/errors.js';
import { getAllowedTransitions, validateTransition } from '../utils/state-machine.js';

/**
 * ProjectService (FR-003 ~ FR-006)
 *
 * 정의 원본: DES-004 v2.2 §3~6 · §전체 함수 시그니처 요약 (Services)
 * 상태 머신: DES-007 v2.1 §2
 *
 * 레이어 규칙(src/CLAUDE.md §레이어 규칙): Service는 Repository만 호출한다.
 * 상태 변경 이력 기록은 StatusChangeRepository를 직접 호출한다
 * (StatusChangeService를 거치지 않는다 — DES-004 §3·§6 시퀀스 다이어그램이
 * `S->>SCR: statusChangeRepo.insert(...)`로 명시한다. Service→Service 호출로
 * 두면 "허용된 Service 간 의존 4건"(Stage→Approval→Agent→Conversation)에
 * 없는 의존이 하나 늘어난다).
 */

export interface CreateProjectInput {
  name: string;
  description?: string;
}

export interface ListProjectsOpts {
  page: number;
  pageSize: number;
  status?: ProjectStatus;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status as ProjectStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * AgentService의 toAgent와 같은 변환이다. Service 간 매핑 함수를 공유하지
 * 않는 것은 project.service.ts가 StatusChangeRepository를 직접 쓰는 것과
 * 같은 원칙이다 — "허용된 Service 간 의존 4건" 밖의 결합을 늘리지 않는다.
 */
function toAgentDto(row: AgentRow): Agent {
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

export class ProjectService {
  constructor(
    private readonly projectRepo: ProjectRepository,
    private readonly statusChangeRepo: StatusChangeRepository,
    // 2-4 AgentService 도입 — ProjectDetail.agents · 캐스케이드에 쓴다 (DES-004 §5 · DES-007 §8)
    private readonly agentRepo: AgentRepository,
  ) {}

  /** FR-003 — 신규 프로젝트는 항상 'ready'로 시작한다 (DES-004 §3) */
  async create(input: CreateProjectInput): Promise<Project> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const row = this.projectRepo.insert({
      id,
      name: input.name,
      description: input.description ?? '',
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    });

    // 최초 생성 — fromStatus는 null이다 (이전 상태가 없다, DES-003 §3-5)
    this.statusChangeRepo.insert({
      entityType: EntityType.PROJECT,
      entityId: id,
      fromStatus: null,
      toStatus: 'ready',
      changedBy: 'system',
      changedAt: now,
    });

    return toProject(row);
  }

  /** FR-004 */
  async list(opts: ListProjectsOpts): Promise<{ items: Project[]; pagination: Pagination }> {
    const offset = (opts.page - 1) * opts.pageSize;
    const filter = { status: opts.status };

    const rows = this.projectRepo.findMany({ offset, limit: opts.pageSize, ...filter });
    const total = this.projectRepo.count(filter);

    return {
      items: rows.map(toProject),
      pagination: {
        page: opts.page,
        pageSize: opts.pageSize,
        total,
        totalPages: Math.ceil(total / opts.pageSize),
      },
    };
  }

  /** FR-005 — 소속 Agent 목록을 붙인다 (DES-004 §5) */
  async getById(id: string): Promise<ProjectDetail> {
    const row = this.projectRepo.findById(id);
    if (!row) {
      throw new AppError(404, ErrorCode.PROJECT_NOT_FOUND, `프로젝트를 찾을 수 없습니다: ${id}`);
    }

    const agents = this.agentRepo.findByProjectId(id).map(toAgentDto);
    return { ...toProject(row), agents };
  }

  /** FR-006 */
  async updateStatus(id: string, newStatus: ProjectStatus): Promise<Project> {
    const row = this.projectRepo.findById(id);
    if (!row) {
      throw new AppError(404, ErrorCode.PROJECT_NOT_FOUND, `프로젝트를 찾을 수 없습니다: ${id}`);
    }

    const fromStatus = row.status;
    if (!validateTransition('project', fromStatus, newStatus)) {
      const allowed = getAllowedTransitions('project', fromStatus);
      throw new AppError(
        422,
        ErrorCode.INVALID_TRANSITION,
        // 허용 목록은 details로 나간다. 메시지에 넣으면 클라이언트가
        // 한국어 문장을 파싱해야 하고, 문구를 다듬는 순간 깨진다.
        `허용되지 않는 상태 전이입니다: ${fromStatus} → ${newStatus}`,
        { allowedTransitions: allowed },
      );
    }

    const now = new Date().toISOString();
    const updated = this.projectRepo.updateStatus(id, newStatus, now);

    // API를 통한 전이는 대표(사용자)가 발생시킨 것이다 — 최초 생성의 'system'과 구분한다 (DES-004 §12 changedBy)
    this.statusChangeRepo.insert({
      entityType: EntityType.PROJECT,
      entityId: id,
      fromStatus,
      toStatus: newStatus,
      changedBy: 'user',
      changedAt: now,
    });

    // 캐스케이드: Project → cancelled/paused ⇒ 소속 활성(running/waiting) Agent 일괄 전이 (DES-007 v2 §8)
    if (newStatus === 'cancelled' || newStatus === 'paused') {
      this.cascadeToAgents(id, newStatus, now);
    }

    return toProject(updated);
  }

  private cascadeToAgents(projectId: string, projectNewStatus: string, now: string): void {
    const targetStatus =
      projectNewStatus === 'cancelled' ? AgentStatus.CANCELLED : AgentStatus.PAUSED;
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
    }
  }
}
