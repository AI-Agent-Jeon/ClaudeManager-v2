import type BetterSqlite3 from 'better-sqlite3';

/**
 * TaskRepository (FR-008)
 *
 * 정의 원본: DES-004 v2.2 §9~11 · §전체 함수 시그니처 요약 (Repositories)
 * DB 스키마: DES-003 v2.1 §2 (migrations/001_initial.sql)
 *
 * 이름 유니크 제약이 없다 — Task 제목은 프로젝트/Agent 이름과 달리 중복을 허용한다.
 */

/** DB 행 그대로 — snake_case */
export interface TaskRow {
  id: string;
  agent_id: string;
  title: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/** insert 입력 — camelCase */
export interface TaskInsertRow {
  id: string;
  agentId: string;
  title: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface FindManyOpts {
  offset: number;
  limit: number;
  agentId?: string;
  status?: string;
}

export interface CountOpts {
  agentId?: string;
  status?: string;
}

function buildWhere(opts: CountOpts): { clause: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (opts.agentId) {
    where.push('agent_id = ?');
    params.push(opts.agentId);
  }
  if (opts.status) {
    where.push('status = ?');
    params.push(opts.status);
  }

  return { clause: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '', params };
}

export class TaskRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  insert(row: TaskInsertRow): TaskRow {
    this.db
      .prepare(
        `INSERT INTO tasks (id, agent_id, title, description, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.agentId,
        row.title,
        row.description,
        row.status,
        row.createdAt,
        row.updatedAt,
      );
    return this.findById(row.id) as TaskRow;
  }

  findById(id: string): TaskRow | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row ?? null;
  }

  /**
   * 캐스케이드 후보 조회 — Task의 "실행 중/대기 중"에 대응한다 (DES-007 v2 §8).
   * `in_progress`(실행 중)·`ready`(착수 전 대기 중)만 대상이다. `in_review`는
   * `TASK_TRANSITIONS`에 `cancelled`로 가는 경로가 없어 캐스케이드 후보에서 뺀다 —
   * 최종 유효성은 어차피 `validateTransition`이 다시 판정한다.
   */
  findActiveByAgentId(agentId: string): TaskRow[] {
    return this.db
      .prepare("SELECT * FROM tasks WHERE agent_id = ? AND status IN ('in_progress', 'ready')")
      .all(agentId) as TaskRow[];
  }

  /** 정렬: created_at DESC (ProjectRepository·AgentRepository와 동일 관례) */
  findMany(opts: FindManyOpts): TaskRow[] {
    const { clause, params } = buildWhere(opts);
    return this.db
      .prepare(`SELECT * FROM tasks ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, opts.limit, opts.offset) as TaskRow[];
  }

  count(opts: CountOpts): number {
    const { clause, params } = buildWhere(opts);
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM tasks ${clause}`).get(...params) as {
      n: number;
    };
    return row.n;
  }

  updateStatus(id: string, status: string, updatedAt: string): TaskRow {
    this.db
      .prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, updatedAt, id);
    return this.findById(id) as TaskRow;
  }
}
