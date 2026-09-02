import type BetterSqlite3 from 'better-sqlite3';
import { ErrorCode } from '../../shared/constants.js';
import { AppError } from '../utils/errors.js';

/**
 * ProjectRepository (FR-003 ~ FR-006)
 *
 * 정의 원본: DES-004 v2.2 §3~6 · §전체 함수 시그니처 요약 (Repositories)
 * DB 스키마: DES-003 v2.1 §2 (migrations/001_initial.sql — UNIQUE(name))
 */

/** DB 행 그대로 — snake_case */
export interface ProjectRow {
  id: string;
  name: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/** insert 입력 — camelCase (DES-004 ProjectInsert) */
export interface ProjectInsertRow {
  id: string;
  name: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface FindManyOpts {
  offset: number;
  limit: number;
  status?: string;
}

export interface CountOpts {
  status?: string;
}

/** better-sqlite3의 UNIQUE 위반 에러 코드 — SqliteError는 `.code`로 구분한다 */
function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

export class ProjectRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  /**
   * 이름 중복은 DB의 UNIQUE 인덱스(`projects_name_unique`)가 막는다.
   * 그 위반을 도메인 에러로 번역하는 것은 시스템 경계 처리이지 비즈니스
   * 로직이 아니다 — Agent 생성(DES-004 §7)도 같은 원칙을 쓴다.
   */
  insert(row: ProjectInsertRow): ProjectRow {
    try {
      this.db
        .prepare(
          `INSERT INTO projects (id, name, description, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(row.id, row.name, row.description, row.status, row.createdAt, row.updatedAt);
    } catch (cause) {
      if (isUniqueConstraintError(cause)) {
        throw new AppError(
          409,
          ErrorCode.PROJECT_NAME_CONFLICT,
          `이미 존재하는 프로젝트 이름입니다: ${row.name}`,
        );
      }
      throw cause;
    }

    // insert 직후 재조회 — better-sqlite3는 RETURNING 없이도 곧바로 읽을 수 있다
    return this.findById(row.id) as ProjectRow;
  }

  findById(id: string): ProjectRow | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      | ProjectRow
      | undefined;
    return row ?? null;
  }

  /** 정렬: created_at DESC (DES-004 §4) */
  findMany(opts: FindManyOpts): ProjectRow[] {
    const clause = opts.status ? 'WHERE status = ?' : '';
    const params = opts.status ? [opts.status] : [];
    return this.db
      .prepare(`SELECT * FROM projects ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, opts.limit, opts.offset) as ProjectRow[];
  }

  count(opts: CountOpts): number {
    const clause = opts.status ? 'WHERE status = ?' : '';
    const params = opts.status ? [opts.status] : [];
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM projects ${clause}`).get(...params) as {
      n: number;
    };
    return row.n;
  }

  updateStatus(id: string, status: string, updatedAt: string): ProjectRow {
    this.db
      .prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, updatedAt, id);
    return this.findById(id) as ProjectRow;
  }
}
