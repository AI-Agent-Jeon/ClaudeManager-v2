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
   * 행이면 `stage_id`·`title`·`notion_url`·`git_path`·`updated_at`을 갱신한다
   * — `status`는 SET 절에 없으므로 기존 값이 그대로 유지된다(승인 흐름이
   * 별도로 관리하는 값이라 upsert가 되돌리면 안 된다).
   *
   * R2-03 (2026-09-03, 대표 결정 A안) — `notion_url`·`git_path`는
   * `COALESCE(excluded.<col>, <col>)`로 갱신한다. 예전에는 `SET notion_url =
   * excluded.notion_url`로 무조건 덮어써, `cm artifacts add --code DES-001
   * --git-path p`처럼 `notionUrl`을 생략(NULL)하고 기존 `synced` 행을 갱신하면
   * `notion_url`이 NULL이 되어 `syncStatus`가 `synced → git_only`로 조용히
   * 퇴행했다(FR-031이 막으려던 사고 그 자체 — DES-003 §4-4 각주). `COALESCE`는
   * `excluded.<col>`이 NULL(=생략)일 때만 기존 값을 유지하고, 값이 명시되면
   * (빈 문자열 포함) 그 값으로 갱신한다 — "값을 생략하면 유지, 명시하면 반영"
   * 이 FindManyOpts §17-18 판단 기준(빈 문자열도 "없음")과 다른 이유는, 이건
   * "무엇을 없음으로 볼지"가 아니라 "무엇을 갱신 대상으로 볼지"의 문제이기
   * 때문이다 — CLI가 옵션을 아예 넘기지 않으면 서비스 계층이 `null`을 넘긴다.
   * `title`·`stage_id`·`updated_at`은 필수 입력이라 생략될 수 없으므로 그대로
   * `SET`한다 — COALESCE를 과잉 적용하지 않는다. 트레이드오프: 한 번 넣은
   * URL을 CLI로 지울 수 없다(대표 인지·승인, 드문 조작이라 수용).
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
             notion_url = COALESCE(excluded.notion_url, notion_url),
             git_path = COALESCE(excluded.git_path, git_path),
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
