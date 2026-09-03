import type { FastifyInstance } from 'fastify';
import { ApprovalStatus, ApprovalType, DecisionLevel } from '../../shared/constants.js';
import type {
  ApprovalDetail,
  ApprovalSummary,
  CreateApprovalInput,
  ResolveApprovalInput,
} from '../../shared/types.js';
import { AgentRepository } from '../repositories/agent.repository.js';
import { ApprovalRepository } from '../repositories/approval.repository.js';
import { ArtifactRepository } from '../repositories/artifact.repository.js';
import { ConversationRepository } from '../repositories/conversation.repository.js';
import { MessageRepository } from '../repositories/message.repository.js';
import { ProjectRepository } from '../repositories/project.repository.js';
import { StatusChangeRepository } from '../repositories/status-change.repository.js';
import { TaskRepository } from '../repositories/task.repository.js';
import { createApprovalBodySchema, resolveApprovalBodySchema } from '../schemas/approval.schema.js';
import { AgentService } from '../services/agent.service.js';
import { ApprovalService } from '../services/approval.service.js';
import { ConversationService } from '../services/conversation.service.js';
import { TaskService } from '../services/task.service.js';

/**
 * 승인 라우트 — FR-028 · FR-030 (R-07)
 *
 * 정의 원본: DES-002 v2.1 §3-3 · §5 · DES-004 v2.4 §15~17
 *
 * 레이어 규칙 2: Routes는 Service만 호출한다 (Repository 직접 접근 금지) —
 * 아래 Repository 임포트는 전부 DI 조립용이다.
 */

const APPROVAL_STATUS_VALUES = Object.values(ApprovalStatus);
/** `low`는 적재되지 않으므로 필터 값에서 제외한다 (DES-002 §5 GET /api/approvals) */
const APPROVAL_LEVEL_VALUES = [DecisionLevel.HIGH, DecisionLevel.MEDIUM];
const APPROVAL_TYPE_VALUES = Object.values(ApprovalType);

interface ListQuery {
  status?: string;
  level?: string;
  type?: string;
  sort?: 'deadline' | 'created';
}

interface IdParams {
  id: string;
}

/**
 * `ApprovalService`를 조립한다. `agents.routes.ts`도 같은 모양의 `ApprovalService`
 * 인스턴스를 별도로 조립해 쓴다(R-04 — DELETE 핸들러가 `db.transaction()` 안에서
 * `AgentService`와 같은 인스턴스를 공유해야 하므로, 여기서 만든 인스턴스를 그대로
 * 재사용하지 않는다). Job·Bootstrap 등 이후 계층에서 재사용할 수 있도록 export한다.
 */
export function buildApprovalService(app: FastifyInstance): ApprovalService {
  const agentRepo = new AgentRepository(app.db);
  const conversationRepo = new ConversationRepository(app.db);
  const messageRepo = new MessageRepository(app.db);
  const conversationService = new ConversationService(conversationRepo, messageRepo);
  // AgentService → ConversationService·TaskService는 "허용된 Service 간
  // 의존"이다(R2-02 · 대표 결정 b안으로 4건 → 5건).
  const agentService = new AgentService(
    app.db,
    agentRepo,
    new StatusChangeRepository(app.db),
    new ProjectRepository(app.db),
    new TaskService(new TaskRepository(app.db), new StatusChangeRepository(app.db), agentRepo),
    conversationService,
    conversationRepo,
  );

  // ApprovalService → AgentService는 "허용된 Service 간 의존 4건"이다 (v3.2 · R-02)
  // ArtifactRepository는 Service를 거치지 않고 직접 주입한다 — Layer 2-9
  // approval.service.ts 상단 "의존 설계 메모 5)" 참조.
  return new ApprovalService(
    app.db,
    new ApprovalRepository(app.db),
    new StatusChangeRepository(app.db),
    messageRepo,
    conversationRepo,
    agentRepo,
    new ArtifactRepository(app.db),
    agentService,
    app.hub,
  );
}

export function registerApprovalRoutes(app: FastifyInstance): void {
  const service = buildApprovalService(app);

  app.post<{ Body: CreateApprovalInput }>(
    '/api/approvals',
    {
      onRequest: [app.authenticate],
      schema: { body: createApprovalBodySchema },
    },
    async (request, reply): Promise<{ data: ApprovalDetail | null }> => {
      const detail = await service.request(request.body);
      reply.code(201);
      return { data: detail };
    },
  );

  app.get<{ Querystring: ListQuery }>(
    '/api/approvals',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: APPROVAL_STATUS_VALUES },
            level: { type: 'string', enum: APPROVAL_LEVEL_VALUES },
            type: { type: 'string', enum: APPROVAL_TYPE_VALUES },
            sort: { type: 'string', enum: ['deadline', 'created'] },
          },
        },
      },
    },
    async (request): Promise<{ data: ApprovalSummary[] }> => {
      const { status, level, type, sort } = request.query;
      const data = await service.list({
        status: status as ApprovalSummary['status'] | undefined,
        level: level as ApprovalSummary['level'] | undefined,
        type: type as ApprovalSummary['approvalType'] | undefined,
        sort,
      });
      return { data };
    },
  );

  app.get<{ Params: IdParams }>(
    '/api/approvals/:id',
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
    async (request): Promise<{ data: ApprovalDetail }> => {
      const data = await service.getById(request.params.id);
      return { data };
    },
  );

  app.post<{ Params: IdParams; Body: ResolveApprovalInput }>(
    '/api/approvals/:id/resolve',
    {
      onRequest: [app.authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          additionalProperties: false,
          properties: { id: { type: 'string' } },
        },
        body: resolveApprovalBodySchema,
      },
    },
    async (request): Promise<{ data: ApprovalDetail }> => {
      const data = await service.resolve(request.params.id, request.body);
      return { data };
    },
  );
}
