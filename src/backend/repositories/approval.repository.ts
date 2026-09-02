import type BetterSqlite3 from 'better-sqlite3';
import { ErrorCode } from '../../shared/constants.js';
import { AppError } from '../utils/errors.js';

/**
 * ApprovalRepository — 승인 요청 CRUD (FR-028 · FR-030)
 *
 * 정의 원본: DES-004 v2.4 §15~17 · §전체 함수 시그니처 요약 (Repositories 시그니처는
 * 미작성 상태 — ApprovalService 계약에서 기계적으로 도출했다. ConversationRepository·
 * MessageRepository와 같은 처지다)
 * DB 스키마: DES-003 v2.1 §4-1 (migrations/004_approvals.sql — CHECK 제약 5건)
 *
 * 레이어 규칙(src/CLAUDE.md §레이어 규칙 3): Repository는 쿼리만 수행한다.
 * 비즈니스 로직(등급별 검증, Agent 전이 등)은 두지 않는다 — Service의 몫이다.
 */

/** DB 행 그대로 — snake_case */
export interface ApprovalRow {
  id: string;
  message_id: string | null;
  stage_id: string | null;
  approval_type: string;
  level: string;
  subject: string;
  /** JSON 문자열. ApprovalOption[] */
  options: string | null;
  /** JSON 문자열. 산출물 코드 배열 */
  artifacts: string | null;
  rationale: string | null;
  /** JSON 문자열. ApprovalImpact */
  impact: string | null;
  requested_by: string;
  deadline_at: string | null;
  status: string;
  resolution: string | null;
  reason: string | null;
  resolved_at: string | null;
  created_at: string;
}

/** insert 입력 — camelCase. 저장 형식(JSON 문자열)은 Service가 만든다 */
export interface ApprovalInsertRow {
  id: string;
  messageId: string | null;
  stageId: string | null;
  approvalType: string;
  level: string;
  subject: string;
  options: string | null;
  artifacts: string | null;
  rationale: string | null;
  impact: string | null;
  requestedBy: string;
  deadlineAt: string | null;
  createdAt: string;
}

export interface ResolvePatch {
  status: string;
  resolution: string | null;
  reason: string | null;
  resolvedAt: string;
}

export interface ClosePendingPatch {
  resolution: string;
  reason: string;
  resolvedAt: string;
}

export interface FindManyOpts {
  status?: string;
  level?: string;
  type?: string;
  sort?: 'deadline' | 'created';
}

/** better-sqlite3의 FK 위반 에러 코드 — AgentRepository의 UNIQUE 판별과 같은 패턴 */
function isForeignKeyConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
  );
}

export class ApprovalRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  /**
   * `stage_id`만 클라이언트가 제공하는 FK다 — `message_id`는 같은 트랜잭션에서
   * 방금 삽입한 메시지의 id라 실패하지 않는다. FK 위반은 곧 존재하지 않는
   * 단계를 뜻하므로 404 STAGE_NOT_FOUND로 변환한다 (DES-002 §5 POST /api/approvals).
   */
  insert(row: ApprovalInsertRow): ApprovalRow {
    try {
      this.db
        .prepare(
          `INSERT INTO approvals (id, message_id, stage_id, approval_type, level, subject,
             options, artifacts, rationale, impact, requested_by, deadline_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.id,
          row.messageId,
          row.stageId,
          row.approvalType,
          row.level,
          row.subject,
          row.options,
          row.artifacts,
          row.rationale,
          row.impact,
          row.requestedBy,
          row.deadlineAt,
          row.createdAt,
        );
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
    return this.findById(row.id) as ApprovalRow;
  }

  findById(id: string): ApprovalRow | null {
    const row = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as
      | ApprovalRow
      | undefined;
    return row ?? null;
  }

  /**
   * 정렬: `sort='deadline'`(기본, DES-002 §5)은 기한이 임박한 순 — 마감이 없는
   * 건(high 등급)은 뒤로 보낸다. `sort='created'`는 최신순.
   */
  findMany(opts: FindManyOpts): ApprovalRow[] {
    const where: string[] = [];
    const params: unknown[] = [];

    if (opts.status) {
      where.push('status = ?');
      params.push(opts.status);
    }
    if (opts.level) {
      where.push('level = ?');
      params.push(opts.level);
    }
    if (opts.type) {
      where.push('approval_type = ?');
      params.push(opts.type);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const order =
      opts.sort === 'created'
        ? 'ORDER BY created_at DESC'
        : 'ORDER BY (deadline_at IS NULL) ASC, deadline_at ASC, created_at DESC';

    return this.db
      .prepare(`SELECT * FROM approvals ${clause} ${order}`)
      .all(...params) as ApprovalRow[];
  }

  /** 특정 요청자의 처리 대기 건수 (R-04 응답 구성용) */
  countPendingByRequester(requestedBy: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM approvals WHERE requested_by = ? AND status = 'pending'")
      .get(requestedBy) as { n: number };
    return row.n;
  }

  /** 단계의 최신 APV-GATE 승인 1건 (DES-004 §16 — StageService.start의 게이트 검증) */
  findLatestGateByStage(stageId: string): ApprovalRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM approvals WHERE stage_id = ? AND approval_type = 'APV-GATE'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(stageId) as ApprovalRow | undefined;
    return row ?? null;
  }

  /** 스케줄러 전용 — pending이고 기한이 지난 건 (DES-004 §17, approvals_deadline_idx 사용) */
  findExpired(now: string): ApprovalRow[] {
    return this.db
      .prepare(
        `SELECT * FROM approvals WHERE status = 'pending'
           AND deadline_at IS NOT NULL AND deadline_at <= ?`,
      )
      .all(now) as ApprovalRow[];
  }

  resolve(id: string, patch: ResolvePatch): ApprovalRow {
    this.db
      .prepare(
        'UPDATE approvals SET status = ?, resolution = ?, reason = ?, resolved_at = ? WHERE id = ?',
      )
      .run(patch.status, patch.resolution, patch.reason, patch.resolvedAt, id);
    return this.findById(id) as ApprovalRow;
  }

  /**
   * Agent 삭제 시 미처리 승인 일괄 마감 (R-04). 한 문장의 UPDATE…RETURNING이라
   * 그 자체로 원자적이다 — `conversation.repository.ts`의 `markRead`와 같은 패턴.
   * 마감된 승인 id 배열을 돌려준다(Service가 status_changes를 건별로 남긴다).
   */
  closePendingByRequester(requestedBy: string, patch: ClosePendingPatch): string[] {
    const rows = this.db
      .prepare(
        `UPDATE approvals SET status = 'rejected', resolution = ?, reason = ?, resolved_at = ?
         WHERE requested_by = ? AND status = 'pending'
         RETURNING id`,
      )
      .all(patch.resolution, patch.reason, patch.resolvedAt, requestedBy) as { id: string }[];
    return rows.map((r) => r.id);
  }
}
