import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ErrorCode } from '../../shared/constants.js';
import { AppError } from '../utils/errors.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** 보호된 라우트의 onRequest 훅으로 건다 */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Auth Plugin — JWT 발급/검증
 *
 * 정의 원본: DES-001 v3.2 ADR-005 · §Cross-Cutting Concerns
 *
 * 사용자 테이블이 없다. 1인 사용자이므로 JWT에 사용자 정보를 넣지 않고,
 * 서명 자체가 인증의 증거다.
 */
export async function registerAuth(app: FastifyInstance, secret: string): Promise<void> {
  await app.register(fastifyJwt, { secret });

  app.decorate('authenticate', async (request: FastifyRequest, _reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch (cause) {
      // 만료와 무효를 구분한다 — FR-002 수용 기준이 "만료 시 재로그인 안내"를
      // 요구하므로 CLI가 두 경우를 다르게 안내할 수 있어야 한다.
      const expired =
        typeof cause === 'object' &&
        cause !== null &&
        'code' in cause &&
        (cause as { code: unknown }).code === 'FAST_JWT_EXPIRED';

      if (expired) {
        throw new AppError(
          401,
          ErrorCode.AUTH_TOKEN_EXPIRED,
          '토큰이 만료되었습니다. 다시 로그인해 주세요',
        );
      }
      throw new AppError(401, ErrorCode.UNAUTHORIZED, '인증이 필요합니다');
    }
  });
}
