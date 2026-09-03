import type { FastifyInstance } from 'fastify';
import { ProjectStatus } from '../../shared/constants.js';
import type { CreateProjectInput, Project, ProjectDetail } from '../../shared/types.js';
import { AgentRepository } from '../repositories/agent.repository.js';
import { ConversationRepository } from '../repositories/conversation.repository.js';
import { MessageRepository } from '../repositories/message.repository.js';
import { ProjectRepository } from '../repositories/project.repository.js';
import { StatusChangeRepository } from '../repositories/status-change.repository.js';
import { TaskRepository } from '../repositories/task.repository.js';
import { paginationQuery } from '../schemas/common.schema.js';
import { AgentService } from '../services/agent.service.js';
import { ConversationService } from '../services/conversation.service.js';
import { ProjectService } from '../services/project.service.js';

/**
 * Project 라우트 — FR-003 ~ FR-006
 *
 * 정의 원본: DES-002 v2.1 §3-1 · §7-2 · DES-004 v2.2 §3~6
 *
 * 레이어 규칙 2: Routes는 Service만 호출한다 (Repository 직접 접근 금지) —
 * 아래 Repository 임포트는 전부 DI 조립용이다.
 */

const PROJECT_STATUS_VALUES = Object.values(ProjectStatus);

interface ListQuery {
  page?: number;
  pageSize?: number;
  status?: string;
}

interface StatusParams {
  id: string;
}

interface StatusBody {
  status: string;
}

export function registerProjectRoutes(app: FastifyInstance): void {
  const agentRepo = new AgentRepository(app.db);
  const statusChangeRepo = new StatusChangeRepository(app.db);
  const projectRepo = new ProjectRepository(app.db);

  const service = new ProjectService(projectRepo, statusChangeRepo, agentRepo);

  // FIND-01 캐스케이드(B안) — PATCH .../status 핸들러가 db.transaction() 안에서
  // ProjectService.updateStatusSync() 다음에 이 인스턴스의
  // cascadeFromProjectSync()를 호출한다(DES-001 §레이어 규칙 9 · R-04와 같은
  // 패턴). AgentService → ConversationService는 "허용된 Service 간 의존 4건"이다.
  const conversationRepo = new ConversationRepository(app.db);
  const conversationService = new ConversationService(
    conversationRepo,
    new MessageRepository(app.db),
  );
  const agentService = new AgentService(
    app.db,
    agentRepo,
    statusChangeRepo,
    projectRepo,
    new TaskRepository(app.db),
    conversationService,
    conversationRepo,
  );

  app.post<{ Body: CreateProjectInput }>(
    '/api/projects',
    {
      onRequest: [app.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string' },
          },
        },
      },
    },
    async (request, reply): Promise<{ data: Project }> => {
      const project = await service.create(request.body);
      reply.code(201);
      return { data: project };
    },
  );

  app.get<{ Querystring: ListQuery }>(
    '/api/projects',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: PROJECT_STATUS_VALUES },
            ...paginationQuery,
          },
        },
      },
    },
    async (request) => {
      const { page = 1, pageSize = 20, status } = request.query;
      const { items, pagination } = await service.list({
        page,
        pageSize,
        status: status as ProjectStatus | undefined,
      });
      return { data: items, pagination };
    },
  );

  app.get<{ Params: StatusParams }>(
    '/api/projects/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          additionalProperties: false,
          properties: { id: { type: 'string' } },
        },
      },
    },
    async (request): Promise<{ data: ProjectDetail }> => {
      const project = await service.getById(request.params.id);
      return { data: project };
    },
  );

  app.patch<{ Params: StatusParams; Body: StatusBody }>(
    '/api/projects/:id/status',
    {
      onRequest: [app.authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          additionalProperties: false,
          properties: { id: { type: 'string' } },
        },
        body: {
          type: 'object',
          required: ['status'],
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: PROJECT_STATUS_VALUES },
          },
        },
      },
    },
    // FIND-01 — Project → Agent → Task 캐스케이드(대표 결정 B안). Project 자신의
    // 전이(`service.updateStatusSync`)와 Agent 캐스케이드
    // (`agentService.cascadeFromProjectSync`, 내부에서 기존 `cascadeToTasks`를
    // 재사용해 Task까지 전파)를 하나의 `db.transaction()`으로 묶는다 — 둘 다
    // `async`가 아니므로 내부에 `await`를 쓰면 컴파일이 실패한다("트랜잭션
    // 콜백 안에서 안전하다"는 불변조건을 타입 체커가 강제한다). 중간에 실패하면
    // (예: 존재하지 않는 프로젝트, 허용되지 않는 전이) 그 예외가 동기적으로
    // 전파되어 better-sqlite3가 트랜잭션 전체를 롤백한다 — Project·Agent·Task
    // 어느 것도 부분 반영되지 않는다(DES-001 §레이어 규칙 9).
    async (request): Promise<{ data: Project }> => {
      const id = request.params.id;
      const newStatus = request.body.status as ProjectStatus;
      const now = new Date().toISOString();

      const project = app.db.transaction((): Project => {
        const updated = service.updateStatusSync(id, newStatus, now);

        // 캐스케이드: Project → cancelled/paused ⇒ 소속 Agent(및 그 Task) 일괄 전이 (DES-007 v2 §8 · DES-004 §6)
        if (newStatus === ProjectStatus.CANCELLED || newStatus === ProjectStatus.PAUSED) {
          agentService.cascadeFromProjectSync(id, newStatus, now);
        }

        return updated;
      })();

      return { data: project };
    },
  );
}
