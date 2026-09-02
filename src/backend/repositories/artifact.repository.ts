import type BetterSqlite3 from 'better-sqlite3';
import { ErrorCode, type SyncStatus } from '../../shared/constants.js';
import { AppError } from '../utils/errors.js';

/**
 * ArtifactRepository — 산출물 CRUD + 동기화 상태 필터 (FR-031)
 *
 * 정의 원본: DES-004 v2.4 §전체 함수 시그니처 요약(ArtifactService) ·
 * DES-002 v2.1 §5(GET /api/artifacts · GET /api/artifacts/:id/content)
 * DB 스키마: DES-003 v2.1 §4-4 (migrations/005_artifacts.sql)
 *
 * ── syncStatus는 저장하지 않는다 ──────────────────────────────
 * `notion_url`·`git_path` 유무에서 파생한다(3NF, migrations/005_artifacts.sql
 * 상단 주석). `findMany`의 `syncStatus` 필터는 전건을 메모리로 읽어와
 * 거르지 않고, SQL WHERE 절에서 NULL 유무로 직접 구성한다 — 개발 지시 §2가
 * 명시한 요구사항이다.
 *
 * ── 빈 문자열도 "없음"으로 취급한다 (판단 근거) ────────────────
 * DB 컬럼은 `TEXT NULL`이라 애플리케이션이 빈 문자열(`''`)을 저장하는 것을
 * 막지 않는다. `notion_url=''`은 "URL이 있다"는 신호가 아니므로 NULL과
 * 동일하게 "없음"으로 판정해야 `notion_only`·`missing`의 구분이 실제 상태와
 * 어긋나지 않는다. `deriveSyncStatus`(artifact.service.ts)와 이 파일의 SQL
 * 조건이 같은 기준(빈 문자열=없음)을 써야 필터 결과와 개별 조회의 파생값이
 * 일치한다 — 기준이 갈리면 필터에서는 안 보이는데 상세에서는 다른 상태로
 * 보이는 모순이 생긴다.
 *
 * 레이어 규칙(src/CLAUDE.md §레이어 규칙 3): Repository는 쿼리만 수행한다.
 */

/** DB 행 그대로 — snake_case */
export interface ArtifactRow {
  id: string;
  stage_id: string;
  code: string;
  title: string;
  status: string;
  notion_url: string | null;
  git_path: string | null;
  updated_at: string;
}

export interface ArtifactUpsertRow {
  id: string;
  stageId: string;
  code: string;
  title: string;
  notionUrl: string | null;
  gitPath: string | null;
  updatedAt: string;
}

export interface FindManyOpts {
  stageId?: string;
  syncStatus?: SyncStatus;
}

/** 컬럼이 "있음"인 조건 — NULL도 빈 문자열도 아니어야 한다 */
function presentClause(column: string): string {
  return `(${column} IS NOT NULL AND ${column} != '')`;
}

/** 컬럼이 "없음"인 조건 — presentClause의 부정 */
function absentClause(column: string): string {
  return `(${column} IS NULL OR ${column} = '')`;
}

/** SyncStatus 4분기를 SQL WHERE 조건으로 번역한다 (DES-003 §4-4 표와 1:1) */
const SYNC_STATUS_CLAUSE: Record<SyncStatus, string> = {
  synced: `${presentClause('notion_url')} AND ${presentClause('git_path')}`,
  notion_only: `${presentClause('notion_url')} AND ${absentClause('git_path')}`,
  git_only: `${absentClause('notion_url')} AND ${presentClause('git_path')}`,
  missing: `${absentClause('notion_url')} AND ${absentClause('git_path')}`,
};

/** better-sqlite3의 FK 위반 에러 코드 — 다른 Repository와 같은 판별 패턴 */
function isForeignKeyConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
  );
}

export class ArtifactRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  findById(id: string): ArtifactRow | null {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as
      | ArtifactRow
      | undefined;
    return row ?? null;
  }

  findByCode(code: string): ArtifactRow | null {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE code = ?').get(code) as
      | ArtifactRow
      | undefined;
    return row ?? null;
  }

  /**
   * 코드 배열로 일괄 조회 (ApprovalService.toDetail 전용, §3 스텁 교체).
   * 존재하지 않는 코드는 결과에서 조용히 빠진다 — 호출부가 원본 코드
   * 배열과 대조해 "없는 코드"를 채워 넣는다(개발 지시 §3).
   */
  findByCodes(codes: string[]): ArtifactRow[] {
    if (codes.length === 0) return [];
    const placeholders = codes.map(() => '?').join(', ');
    return this.db
      .prepare(`SELECT * FROM artifacts WHERE code IN (${placeholders})`)
      .all(...codes) as ArtifactRow[];
  }

  /**
   * `stage`·`syncStatus` 필터를 SQL WHERE로 구성한다 (GET /api/artifacts).
   * `syncStatus`는 저장 컬럼이 아니라 `SYNC_STATUS_CLAUSE`로 번역된 파생
   * 조건이다 — 전건을 읽어와 애플리케이션에서 거르지 않는다.
   */
  findMany(opts: FindManyOpts): ArtifactRow[] {
    const where: string[] = [];
    const params: unknown[] = [];

    if (opts.stageId) {
      where.push('stage_id = ?');
      params.push(opts.stageId);
    }
    if (opts.syncStatus) {
      where.push(SYNC_STATUS_CLAUSE[opts.syncStatus]);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    return this.db
      .prepare(`SELECT * FROM artifacts ${clause} ORDER BY updated_at DESC`)
      .all(...params) as ArtifactRow[];
  }

  /**
   * `code` UNIQUE 기준 upsert. 신규면 `status='draft'`로 삽입하고, 기존
   * 행이면 `stage_id`·`title`·`notion_url`·`git_path`·`updated_at`만 갱신한다
   * — `status`는 SET 절에 없으므로 기존 값이 그대로 유지된다(승인 흐름이
   * 별도로 관리하는 값이라 upsert가 되돌리면 안 된다).
   *
   * `stage_id` FK 위반은 404 STAGE_NOT_FOUND로 변환한다 — ApprovalRepository·
   * PhaseRepository와 같은 판단 기준이다.
   */
  upsert(row: ArtifactUpsertRow): ArtifactRow {
    try {
      this.db
        .prepare(
          `INSERT INTO artifacts (id, stage_id, code, title, status, notion_url, git_path, updated_at)
           VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)
           ON CONFLICT(code) DO UPDATE SET
             stage_id = excluded.stage_id,
             title = excluded.title,
             notion_url = excluded.notion_url,
             git_path = excluded.git_path,
             updated_at = excluded.updated_at`,
        )
        .run(row.id, row.stageId, row.code, row.title, row.notionUrl, row.gitPath, row.updatedAt);
    } catch (cause) {
      if (isForeignKeyConstraintError(cause)) {
        throw new AppError(
          404,
          ErrorCode.STAGE_NOT_FOUND,
          `단계를 찾을 수 없습니다: ${row.stageId}`,
        );
      }
      throw cause;
    }
    return this.findByCode(row.code) as ArtifactRow;
  }
}
