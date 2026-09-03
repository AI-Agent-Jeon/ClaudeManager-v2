import Fastify, { type FastifyInstance } from 'fastify';
import { ErrorCode } from '../shared/constants.js';
import { type AppConfig, loadConfig } from './config.js';
import { registerAuth } from './plugins/auth.js';
import { registerDatabase } from './plugins/database.js';
import { registerStatic } from './plugins/static.js';
import { registerAgentRoutes } from './routes/agents.routes.js';
import { registerApprovalRoutes } from './routes/approvals.routes.js';
import { registerArtifactRoutes } from './routes/artifacts.routes.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerConversationRoutes } from './routes/conversations.routes.js';
import { registerHealthRoutes } from './routes/health.routes.js';
import { registerPhaseRoutes } from './routes/phases.routes.js';
import { registerProjectRoutes } from './routes/projects.routes.js';
import { registerStageRoutes } from './routes/stages.routes.js';
import { registerStatusChangeRoutes } from './routes/status-changes.routes.js';
import { registerTaskRoutes } from './routes/tasks.routes.js';
import { commonSchemas } from './schemas/common.schema.js';
import { AppError, toErrorResponse } from './utils/errors.js';
import { WebSocketHub } from './ws/hub.js';

declare module 'fastify' {
  interface FastifyInstance {
    hub: WebSocketHub;
    config: AppConfig;
  }
}

export interface BuildAppOptions {
  config?: Partial<AppConfig>;
  logger?: boolean;
}

/**
 * Fastify 앱 구성
 *
 * 정의 원본: DES-001 v3.2 §기동 순서 1~4단계
 *
 * 등록 순서가 곧 기동 순서다. DB → 인증 → 라우트 순으로 읽힌다.
 * `listen`은 여기서 하지 않는다 — 테스트는 `inject`로 포트 없이 돌린다.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config: AppConfig = { ...loadConfig(), ...options.config };

  const app = Fastify({
    logger: options.logger ?? false,
    // 잘못된 JSON은 라우트에 닿기 전에 400으로 떨어진다
    ajv: { customOptions: { removeAdditional: false, allErrors: false } },
  });

  app.decorate('config', config);
  app.addSchema(commonSchemas);

  // 2~3단계: DB 연결 + 마이그레이션. 실패하면 여기서 던져 기동을 멈춘다 (FR-001)
  registerDatabase(app, config.dbPath);

  // 4단계: 플러그인·라우트
  await registerAuth(app, config.authSecret);
  app.decorate('hub', new WebSocketHub());

  registerHealthRoutes(app, config.version);
  registerAuthRoutes(app, config);
  registerProjectRoutes(app);
  registerAgentRoutes(app);
  registerTaskRoutes(app);
  registerStatusChangeRoutes(app);
  registerConversationRoutes(app);
  registerApprovalRoutes(app);
  registerPhaseRoutes(app);
  registerStageRoutes(app);
  registerArtifactRoutes(app);

  // Phase 2A — 빌드된 웹 UI 정적 서빙 (동일 오리진, APV-2A-01). API 라우트
  // 등록 뒤에 둔다 — find-my-way가 정적 경로(/api/*)를 와일드카드보다
  // 우선 매칭하므로 순서 자체는 무해하지만, "API가 먼저"라는 가독성을 둔다.
  await registerStatic(app);

  // 에러 응답은 4필드 고정이다 (DES-009 §HTTP 에러 응답 형식)
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof AppError) {
      const body = toErrorResponse(err);
      return reply.code(body.statusCode).send(body);
    }

    // Fastify JSON Schema 검증 실패
    const fastifyErr = err as { validation?: unknown; message?: string; statusCode?: number };
    if (fastifyErr.validation) {
      const body = toErrorResponse(
        new AppError(
          400,
          ErrorCode.VALIDATION_ERROR,
          fastifyErr.message ?? '요청 형식이 올바르지 않습니다',
        ),
      );
      return reply.code(400).send(body);
    }

    // SEC-07/REV-M-04 — Fastify가 라우트 핸들러에 닿기 전에 자체적으로 던지는
    // 오류(파손 JSON 본문 FST_ERR_CTP_* 400, 본문 크기 초과 413, 미디어 타입
    // 불일치 415 등)는 AppError도 아니고 `.validation`도 없어 이전에는
    // 무조건 아래 500 분기로 떨어졌다(46행 주석 "잘못된 JSON은 라우트에
    // 닿기 전에 400으로 떨어진다"와 실제 동작이 어긋났던 지점). `statusCode`가
    // 4xx면 그 값을 존중한다 — 에러 원문·스택·내부 경로는 여전히 노출하지
    // 않는다. Fastify가 내려주는 이 메시지들은 "Body cannot be empty..." 같은
    // 표준 안내문이라 위 검증 실패 분기와 같은 방식으로 그대로 전달해도 된다.
    if (
      typeof fastifyErr.statusCode === 'number' &&
      fastifyErr.statusCode >= 400 &&
      fastifyErr.statusCode < 500
    ) {
      // 클라이언트 요청 문제이지 서버 결함이 아니다 — error가 아니라 warn으로
      // 남겨 로그를 오염시키지 않는다.
      request.log.warn({ err }, 'client error');
      const body = toErrorResponse(
        new AppError(
          fastifyErr.statusCode,
          ErrorCode.VALIDATION_ERROR,
          fastifyErr.message ?? '요청이 올바르지 않습니다',
        ),
      );
      return reply.code(body.statusCode).send(body);
    }

    request.log.error({ err }, 'unhandled error');
    const body = toErrorResponse(err);
    return reply.code(body.statusCode).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    const body = toErrorResponse(
      new AppError(404, ErrorCode.NOT_FOUND, '요청한 경로를 찾을 수 없습니다'),
    );
    return reply.code(404).send(body);
  });

  // WS Hub는 소켓 정리를 DB 종료보다 먼저 해야 한다 (Graceful Shutdown 3단계).
  // onClose는 등록의 역순으로 실행되므로 DB보다 나중에 등록한다.
  app.addHook('onClose', async () => {
    app.hub.closeAll();
  });

  await app.ready();
  return app;
}
