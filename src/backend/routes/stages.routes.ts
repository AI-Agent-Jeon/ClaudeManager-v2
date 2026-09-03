import type { FastifyInstance } from 'fastify';
import type { StageSummary } from '../../shared/types.js';
import { PhaseRepository } from '../repositories/phase.repository.js';
import { StatusChangeRepository } from '../repositories/status-change.repository.js';
import { StageService } from '../services/stage.service.js';
import { buildApprovalService } from './approvals.routes.js';

/**
 * 단계(Stage) 라우트 — FR-030
 *
 * 정의 원본: DES-002 v2.1 §3-3 · §5 `POST /api/stages/:id/start` ·
 * DES-004 v2.4 §16 · DES-007 v2.1 §7-1
 *
 * **CLAUDE.md 스킬 전환 게이트의 유일한 강제 지점은 `start`다.** `complete`는
 * Layer 2-8에서 서비스 메서드로만 존재하고 라우트가 없어 `plan` 착수 이후
 * 어떤 후속 단계도 착수할 수 없는 단절이 있었다(설계 누락, DES-002 §3-3
 * 엔드포인트 10종에 `complete`가 빠져 있었다). 이번 Layer 2-8 보완에서
 * `POST /api/stages/:id/complete`를 열어 단절을 해소한다(대표 승인 A안).
 * `complete`는 선행 조건(산출물 개수·승인 상태)을 검사하지 않는다 —
 * 그 판단은 대표의 몫이며, 여기에 검사를 걸면 게이트 강제 지점이 `start`
 * 하나가 아니게 되어 R-03("게이트 강제는 start 한 곳에서만")이 흐려진다.
 *
 * 레이어 규칙 2: Routes는 Service만 호출한다 (Repository 직접 접근 금지) —
 * 아래 Repository 임포트는 DI 조립용이다.
 */

interface IdParams {
  id: string;
}

/**
 * `StageService`를 조립한다. `StageService → ApprovalService`는 "허용된
 * Service 간 의존 5건" 중 하나다(DES-001 v3.2). `approvals.routes.ts`가
 * export하는 `buildApprovalService`를 그대로 재사용한다 — `agents.routes.ts`가
 * 이미 같은 패턴을 쓴다(별도 인스턴스를 조립해 쓰되 빌더 함수는 공유).
 */
export function buildStageService(app: FastifyInstance): StageService {
  return new StageService(
    app.db,
    new PhaseRepository(app.db),
    buildApprovalService(app),
    new StatusChangeRepository(app.db),
    app.hub,
  );
}

export function registerStageRoutes(app: FastifyInstance): void {
  const service = buildStageService(app);

  app.post<{ Params: IdParams }>(
    '/api/stages/:id/start',
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
    async (request): Promise<{ data: StageSummary }> => {
      const data = await service.start(request.params.id);
      return { data };
    },
  );

  app.post<{ Params: IdParams }>(
    '/api/stages/:id/complete',
    {
      onRequest: [app.authenticate],
      // 요청 본문 없음(§1 계약). 클라이언트가 아예 본문을 보내지 않으면
      // `request.body`가 `undefined`로 남는데, `body` 스키마의 `type: 'object'`가
      // 이를 그대로 거부해 버린다 — 그래서 스키마 검증(preValidation) 전에
      // `undefined`를 `{}`로 정규화한다. 본문을 보냈다면 그대로 스키마를
      // 통과시켜 `additionalProperties: false`가 알 수 없는 필드를 걸러낸다.
      preValidation: (request, _reply, done) => {
        if (request.body === undefined) {
          request.body = {};
        }
        done();
      },
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          additionalProperties: false,
          properties: { id: { type: 'string' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
      },
    },
    async (request): Promise<{ data: StageSummary }> => {
      const data = await service.complete(request.params.id);
      return { data };
    },
  );
}
