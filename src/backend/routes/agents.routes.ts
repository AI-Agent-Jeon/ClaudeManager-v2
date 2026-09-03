import type { FastifyInstance } from 'fastify';
import { AgentStatus } from '../../shared/constants.js';
import type {
  Agent,
  AgentDetail,
  CreateAgentInput,
  DeleteAgentResult,
} from '../../shared/types.js';
import { AgentRepository } from '../repositories/agent.repository.js';
import { ApprovalRepository } from '../repositories/approval.repository.js';
import { ArtifactRepository } from '../repositories/artifact.repository.js';
import { ConversationRepository } from '../repositories/conversation.repository.js';
import { MessageRepository } from '../repositories/message.repository.js';
import { ProjectRepository } from '../repositories/project.repository.js';
import { StatusChangeRepository } from '../repositories/status-change.repository.js';
import { TaskRepository } from '../repositories/task.repository.js';
import { paginationQuery } from '../schemas/common.schema.js';
import { AgentService } from '../services/agent.service.js';
import { ApprovalService } from '../services/approval.service.js';
import { ConversationService } from '../services/conversation.service.js';
import { TaskService } from '../services/task.service.js';

/**
 * Agent 라우트 — FR-007
 *
 * 정의 원본: DES-002 v2.1 §3-1 · §7-2 · DES-004 v2.2 §7~8·§13
 *
 * 레이어 규칙 2: Routes는 Service만 호출한다 (Repository 직접 접근 금지).
 */

const AGENT_STATUS_VALUES = Object.values(AgentStatus);

interface ListQuery {
  page?: number;
  pageSize?: number;
  projectId?: string;
  status?: string;
}

interface IdParams {
  id: string;
}

interface StatusBody {
  status: string;
}

export function registerAgentRoutes(app: FastifyInstance): void {
  const agentRepo = new AgentRepository(app.db);
  const conversationRepo = new ConversationRepository(app.db);
  const messageRepo = new MessageRepository(app.db);
  const statusChangeRepo = new StatusChangeRepository(app.db);

  // AgentService → ConversationService·TaskService는 "허용된 Service 간
  // 의존"이다 (src/CLAUDE.md §레이어 규칙: Stage → Approval → Agent →
  // {Conversation, Task} — R2-02 · 대표 결정 b안으로 4건 → 5건).
  const conversationService = new ConversationService(conversationRepo, messageRepo);
  const taskService = new TaskService(new TaskRepository(app.db), statusChangeRepo, agentRepo);
  const service = new AgentService(
    app.db,
    agentRepo,
    statusChangeRepo,
    new ProjectRepository(app.db),
    taskService,
    conversationService,
    conversationRepo,
  );

  // ApprovalService → AgentService는 "허용된 Service 간 의존 5건"이다 (v3.2 · R-02).
  // DELETE 핸들러(R-04)가 이 인스턴스로 승인 마감을 조율한다 — 같은 app.db
  // 커넥션을 쓰는 같은 프로세스 안이라 트랜잭션 경계를 공유할 수 있다.
  const approvalService = new ApprovalService(
    app.db,
    new ApprovalRepository(app.db),
    statusChangeRepo,
    messageRepo,
    conversationRepo,
    agentRepo,
    new ArtifactRepository(app.db),
    service,
    app.hub,
  );

  app.post<{ Body: CreateAgentInput }>(
    '/api/agents',
    {
      onRequest: [app.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['projectId', 'name'],
          additionalProperties: false,
          properties: {
            projectId: { type: 'string' },
            name: { type: 'string', minLength: 1, maxLength: 100 },
            type: { type: 'string' },
            skill: { type: 'string' },
            config: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
    async (request, reply): Promise<{ data: Agent }> => {
      const agent = await service.create(request.body);
      reply.code(201);
      return { data: agent };
    },
  );

  app.get<{ Querystring: ListQuery }>(
    '/api/agents',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            projectId: { type: 'string' },
            status: { type: 'string', enum: AGENT_STATUS_VALUES },
            ...paginationQuery,
          },
        },
      },
    },
    async (request) => {
      const { page = 1, pageSize = 20, projectId, status } = request.query;
      const { items, pagination } = await service.list({
        page,
        pageSize,
        projectId,
        status: status as AgentStatus | undefined,
      });
      return { data: items, pagination };
    },
  );

  app.get<{ Params: IdParams }>(
    '/api/agents/:id',
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
    async (request): Promise<{ data: AgentDetail }> => {
      const agent = await service.getById(request.params.id);
      return { data: agent };
    },
  );

  app.patch<{ Params: IdParams; Body: StatusBody }>(
    '/api/agents/:id/status',
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
            status: { type: 'string', enum: AGENT_STATUS_VALUES },
          },
        },
      },
    },
    async (request): Promise<{ data: Agent }> => {
      const agent = await service.updateStatus(
        request.params.id,
        request.body.status as AgentStatus,
      );
      return { data: agent };
    },
  );

  app.delete<{ Params: IdParams }>(
    '/api/agents/:id',
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
    // R-04 — 승인 마감(ApprovalService.closeByRequesterSync)과 Agent 삭제
    // (AgentService.deleteSync)를 한 트랜잭션으로 조율한다. `ApprovalService →
    // AgentService`(기존)와 `AgentService → ApprovalService`를 둘 다 두면
    // 양방향 순환이 되므로, Service끼리 부르지 않고 Route가 db.transaction()
    // 으로 순서를 강제한다 (DES-004 §13 · 레이어 규칙 9).
    //
    // 동기 코어(`~Sync` 메서드)를 트랜잭션 콜백 안에서 직접 호출한다 — 둘 다
    // `async`가 아니므로 내부에 `await`를 쓰면 컴파일이 실패한다("트랜잭션 콜백
    // 안에서 안전하다"는 불변조건을 타입 체커가 강제한다). 그래서 fire-and-forget
    // (`void`)도, 응답 값을 미리 조회하는 것도 필요 없다 — 콜백이 반환한 값을
    // 그대로 쓴다. 둘 중 하나가 실패하면(예: 존재하지 않는 Agent) 그 예외가
    // 동기적으로 전파되어 better-sqlite3가 트랜잭션 전체를 롤백한다
    // (agent-delete-atomicity.test.ts가 두 실패 순서를 모두 검증한다).
    async (request): Promise<{ data: DeleteAgentResult }> => {
      const id = request.params.id;

      const result = app.db.transaction(() => {
        const closedApprovalCount = approvalService.closeByRequesterSync(id);
        const deleted = service.deleteSync(id);
        return { archivedConversationId: deleted.archivedConversationId, closedApprovalCount };
      })();

      return { data: result };
    },
  );
}
