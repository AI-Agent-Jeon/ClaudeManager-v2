import type { FastifyInstance } from 'fastify';
import type { CreatePhaseInput, CreateWipWaiverInput, PhaseCurrent } from '../../shared/types.js';
import { PhaseRepository } from '../repositories/phase.repository.js';
import { createPhaseBodySchema, createWipWaiverBodySchema } from '../schemas/phase.schema.js';
import { PhaseService } from '../services/phase.service.js';

/**
 * 진행(Phase) 라우트 — FR-029
 *
 * 정의 원본: DES-002 v2.1 §3-3 · §5 · DES-004 v2.2 §18 · §전체 함수 시그니처 요약
 *
 * 레이어 규칙 2: Routes는 Service만 호출한다 (Repository 직접 접근 금지) —
 * 아래 Repository 임포트는 DI 조립용이다.
 */

/**
 * `PhaseService`를 조립한다. `BootstrapService`(R-1, 이후 계층)가 `ensurePhase()`를
 * 재사용할 수 있도록 export한다 — `approvals.routes.ts`의 `buildApprovalService`와
 * 같은 패턴이다.
 */
export function buildPhaseService(app: FastifyInstance): PhaseService {
  return new PhaseService(app.db, new PhaseRepository(app.db));
}

export function registerPhaseRoutes(app: FastifyInstance): void {
  const service = buildPhaseService(app);

  app.get(
    '/api/phases/current',
    { onRequest: [app.authenticate] },
    async (): Promise<{ data: PhaseCurrent }> => {
      const data = await service.getCurrent();
      return { data };
    },
  );

  app.post<{ Body: CreatePhaseInput }>(
    '/api/phases',
    {
      onRequest: [app.authenticate],
      schema: { body: createPhaseBodySchema },
    },
    async (request, reply): Promise<{ data: PhaseCurrent }> => {
      const data = await service.create(request.body);
      reply.code(201);
      return { data };
    },
  );

  app.post<{ Body: CreateWipWaiverInput }>(
    '/api/wip-waivers',
    {
      onRequest: [app.authenticate],
      schema: { body: createWipWaiverBodySchema },
    },
    async (request, reply): Promise<{ data: null }> => {
      await service.createWaiver(request.body);
      reply.code(201);
      return { data: null };
    },
  );
}
