import type BetterSqlite3 from 'better-sqlite3';

/**
 * StatusChangeRepository — 상태 변경 이력 (FR-009)
 *
 * 정의 원본: DES-004 v2.2 §12 · §전체 함수 시그니처 요약 (Repositories)
 * DB 스키마: DES-003 v2.1 §3-5 (entity_type CHECK 6종 · migrations/001_initial.sql + 006_status_ext.sql)
 *
 * 레이어 규칙(src/CLAUDE.md §레이어 규칙 3): Repository는 쿼리만 수행한다.
 * 비즈니스 로직(허용 전이 판단 등)은 두지 않는다.
 */

/** DB 행 그대로 — snake_case */
export interface StatusChangeRow {
  id: number;
  entity_type: string;
  entity_id: string;
  from_status: string | null;
  to_status: string;
  changed_by: string;
  changed_at: string;
}

/** insert 입력 — camelCase (DES-004 StatusChangeInsert) */
export interface StatusChangeInsertRow {
  entityType: string;
  entityId: string;
  fromStatus: string | null;
  toStatus: string;
  changedBy: string;
  changedAt: string;
}

export interface FindManyOpts {
  offset: number;
  limit: number;
  entityType?: string;
  entityId?: string;
}

export interface CountOpts {
  entityType?: string;
  entityId?: string;
}

/** 공통 WHERE 절 조립 — findMany·count가 같은 필터를 쓴다 */
function buildWhere(opts: CountOpts): { clause: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (opts.entityType) {
    where.push('entity_type = ?');
    params.push(opts.entityType);
  }
  if (opts.entityId) {
    where.push('entity_id = ?');
    params.push(opts.entityId);
  }

  return { clause: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '', params };
}

export class StatusChangeRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  insert(row: StatusChangeInsertRow): void {
    this.db
      .prepare(
        `INSERT INTO status_changes (entity_type, entity_id, from_status, to_status, changed_by, changed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.entityType,
        row.entityId,
        row.fromStatus,
        row.toStatus,
        row.changedBy,
        row.changedAt,
      );
  }

  /** 정렬: changed_at ASC — 시간순 (DES-004 §12). id ASC는 동시각 동점 처리용 */
  findMany(opts: FindManyOpts): StatusChangeRow[] {
    const { clause, params } = buildWhere(opts);
    return this.db
      .prepare(
        `SELECT * FROM status_changes ${clause} ORDER BY changed_at ASC, id ASC LIMIT ? OFFSET ?`,
      )
      .all(...params, opts.limit, opts.offset) as StatusChangeRow[];
  }

  count(opts: CountOpts): number {
    const { clause, params } = buildWhere(opts);
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM status_changes ${clause}`)
      .get(...params) as {
      n: number;
    };
    return row.n;
  }
}
