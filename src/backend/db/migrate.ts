import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';

/**
 * 마이그레이션 러너
 *
 * 정의 원본: DES-003 v2.1 §9 마이그레이션 전략
 *
 * 왜 손으로 쓴 SQL인가: CHECK 제약 5건, 부분 유니크 인덱스, FTS5 가상 테이블과
 * 트리거 3종은 Drizzle 스키마로 표현되지 않는다. 설계가 "CHECK 제약은
 * 마이그레이션에 포함한다 — 애플리케이션 검증에만 의존하지 않는다"고 규정하므로
 * SQL이 스키마의 원본이고, `schema.ts`는 쿼리 타입을 위한 거울이다.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** 적용 순서. FK 의존을 따르므로 재배열하면 깨진다 (DES-003 §9-2) */
export const MIGRATION_FILES = [
  '001_initial.sql',
  '002_conversations.sql',
  '003_phases.sql',
  // 004는 002·003 이후여야 한다 — message_id가 messages를, stage_id가 stages를 참조한다
  '004_approvals.sql',
  '005_artifacts.sql',
  '006_status_ext.sql',
] as const;

export type MigrationName = (typeof MIGRATION_FILES)[number];

export interface MigrationResult {
  /** 이번 호출에서 실제로 적용한 것 */
  applied: string[];
  /** 이미 적용되어 건너뛴 것 */
  skipped: string[];
}

function ensureLedger(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);
}

function appliedNames(db: Database): Set<string> {
  const rows = db.prepare('SELECT name FROM _migrations').all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

/**
 * 미적용 마이그레이션을 순서대로 적용한다.
 *
 * 멱등하다 — `_migrations` 원장을 보고 이미 적용된 것은 건너뛴다.
 * 006이 테이블을 재작성하므로 원장 없이 두 번 돌리면 데이터가 한 번 더
 * 복사·삭제된다. 원장이 그것을 막는다.
 */
export function runMigrations(db: Database): MigrationResult {
  ensureLedger(db);

  const done = appliedNames(db);
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const name of MIGRATION_FILES) {
    if (done.has(name)) {
      skipped.push(name);
      continue;
    }

    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');

    // 마이그레이션 하나가 통째로 적용되거나 통째로 취소되어야 한다.
    // 006처럼 여러 단계를 거치는 것이 중간에 끊기면 테이블이 사라진 채 남는다.
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(
        name,
        new Date().toISOString(),
      );
    })();

    applied.push(name);
  }

  return { applied, skipped };
}
