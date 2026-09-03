import type BetterSqlite3 from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { ErrorCode } from '../../shared/constants.js';
import { openDatabase } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { AppError } from '../utils/errors.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: BetterSqlite3.Database;
  }
}

/**
 * Database Plugin — SQLite 연결 + 마이그레이션 적용
 *
 * 정의 원본: DES-001 v3.2 §기동 순서 2~3단계
 *
 * fastify-plugin을 쓰지 않고 루트 스코프에서 직접 호출한다 —
 * 의존성을 하나 늘리는 대신 app.ts가 등록 순서를 눈으로 보여준다.
 */
export function registerDatabase(app: FastifyInstance, dbPath: string): void {
  let db: BetterSqlite3.Database;

  try {
    db = openDatabase({ path: dbPath });
  } catch (cause) {
    // FR-001 수용 기준: DB 연결에 실패하면 에러와 함께 시작이 중단된다.
    // 원문에는 파일 경로가 섞여 있으므로 감싼다.
    throw new AppError(500, ErrorCode.DB_CONNECTION_ERROR, `DB 연결에 실패했습니다: ${dbPath}`, {
      cause: String(cause),
    });
  }

  try {
    // DAT-002 수용 기준: 미적용 마이그레이션이 순서대로 실행된다.
    // 각 마이그레이션은 트랜잭션이므로 실패 시 그 건만 롤백된다.
    runMigrations(db);
  } catch (cause) {
    db.close();
    throw new AppError(500, ErrorCode.MIGRATION_ERROR, '마이그레이션 적용에 실패했습니다', {
      cause: String(cause),
    });
  }

  app.decorate('db', db);
  app.addHook('onClose', async () => {
    db.close();
  });
}
