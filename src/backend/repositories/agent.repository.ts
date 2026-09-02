import type BetterSqlite3 from 'better-sqlite3';
import { ErrorCode } from '../../shared/constants.js';
import { AppError } from '../utils/errors.js';

/**
 * AgentRepository (FR-007)
 *
 * 정의 원본: DES-004 v2.2 §7~8·§13 · §전체 함수 시그니처 요약 (Repositories)
 * DB 스키마: DES-003 v2.1 §2 (migrations/001_initial.sql — UNIQUE(project_id, name))
 */

/** DB 행 그대로 — snake_case */
export interface AgentRow {
  id: string;
  project_id: string;
  name: string;
  type: string;
  status: string;
  waiting_reason: string | null;
  skill: string;
  config: string;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

/** insert 입력 — camelCase */
export interface AgentInsertRow {
  id: string;
  projectId: string;
  name: string;
  type: string;
  status: string;
  waitingReason: string | null;
  skill: string;
  /** JSON.stringify()된 값 — DB는 TEXT다 */
  config: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FindManyOpts {
  offset: number;
  limit: number;
  projectId?: string;
  status?: string;
}

export interface CountOpts {
  projectId?: string;
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

function buildWhere(opts: CountOpts): { clause: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (opts.projectId) {
    where.push('project_id = ?');
    params.push(opts.projectId);
  }
  if (opts.status) {
    where.push('status = ?');
    params.push(opts.status);
  }

  return { clause: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '', params };
}

export class AgentRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  /**
   * 이름 중복은 DB의 UNIQUE 인덱스(`agents_project_name_unique`, 프로젝트 내 유니크)가
   * 막는다. ProjectRepository.insert와 같은 원칙(시스템 경계 처리)이다.
   */
  insert(row: AgentInsertRow): AgentRow {
    try {
      this.db
        .prepare(
          `INSERT INTO agents (id, project_id, name, type, status, waiting_reason, skill,
             config, retry_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.id,
          row.projectId,
          row.name,
          row.type,
          row.status,
          row.waitingReason,
          row.skill,
          row.config,
          row.retryCount,
          row.createdAt,
          row.updatedAt,
        );
    } catch (cause) {
      if (isUniqueConstraintError(cause)) {
        throw new AppError(
          409,
          ErrorCode.AGENT_NAME_CONFLICT,
          `이미 존재하는 Agent 이름입니다: ${row.name}`,
        );
      }
      throw cause;
    }

    return this.findById(row.id) as AgentRow;
  }

  findById(id: string): AgentRow | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as
      | AgentRow
      | undefined;
    return row ?? null;
  }

  /** ProjectDetail.agents 전용 — 페이지네이션 없이 전체를 돌려준다 (DES-004 §5) */
  findByProjectId(projectId: string): AgentRow[] {
    return this.db
      .prepare('SELECT * FROM agents WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as AgentRow[];
  }

  /**
   * 캐스케이드 후보 조회 — `running`·`waiting`(Agent의 "실행 중/대기 중")만 대상이다
   * (DES-007 v2 §8). 어느 상태로 캐스케이드하든 최종 유효성은 State Machine이
   * 다시 판정하므로(`validateTransition`), 여기서는 넓게 가져온다.
   */
  findActiveByProjectId(projectId: string): AgentRow[] {
    return this.db
      .prepare("SELECT * FROM agents WHERE project_id = ? AND status IN ('running', 'waiting')")
      .all(projectId) as AgentRow[];
  }

  /** 정렬: created_at DESC (DES-004 §전체 함수 시그니처 요약) */
  findMany(opts: FindManyOpts): AgentRow[] {
    const { clause, params } = buildWhere(opts);
    return this.db
      .prepare(`SELECT * FROM agents ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, opts.limit, opts.offset) as AgentRow[];
  }

  count(opts: CountOpts): number {
    const { clause, params } = buildWhere(opts);
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM agents ${clause}`).get(...params) as {
      n: number;
    };
    return row.n;
  }

  /**
   * `waiting_reason`은 항상 NULL로 초기화한다. 사유 부여는 승인·의사결정 요청
   * 발행 시점(Layer 2-6 ApprovalService)의 몫이며, 이 계층은 그 입력을 받지 않는다
   * (DES-007 v2 §3-2). CHECK 제약(`status='waiting' OR waiting_reason IS NULL`)은
   * 이 값으로 항상 만족된다.
   */
  updateStatus(id: string, status: string, updatedAt: string): AgentRow {
    this.db
      .prepare('UPDATE agents SET status = ?, waiting_reason = NULL, updated_at = ? WHERE id = ?')
      .run(status, updatedAt, id);
    return this.findById(id) as AgentRow;
  }

  /** CASCADE: tasks 삭제. status_changes·conversations·approvals는 FK가 없어 유지된다 (D-27) */
  deleteById(id: string): void {
    this.db.prepare('DELETE FROM agents WHERE id = ?').run(id);
  }
}
