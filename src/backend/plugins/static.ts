import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * 정적 파일 서빙 — Phase 2A APV-2A-01(동일 오리진 SPA)
 *
 * `npm run build`가 만든 `dist/frontend`를 기존 Fastify가 그대로 서빙한다.
 * 별도 프로세스·CORS가 필요 없다. `/api/*`는 라우트 등록 순서와 무관하게
 * find-my-way가 정적 경로를 우선 매칭하므로 이 플러그인과 충돌하지 않는다
 * (`conversations.routes.ts`의 동일한 코멘트 참조).
 *
 * `dist/frontend`가 없으면(빌드 전) 서버 전체가 죽지 않도록 건너뛴다 —
 * API만 쓰는 개발 흐름(Vite dev 서버 별도 기동)까지 막을 이유가 없다.
 */
export async function registerStatic(app: FastifyInstance): Promise<void> {
  const distDir = path.resolve(process.cwd(), 'dist/frontend');

  if (!existsSync(distDir)) {
    app.log.warn(
      'dist/frontend가 없어 정적 서빙을 건너뜁니다. `npm run build`로 프론트엔드를 빌드하세요.',
    );
    return;
  }

  await app.register(fastifyStatic, {
    root: distDir,
    prefix: '/',
    index: ['index.html'],
  });
}
