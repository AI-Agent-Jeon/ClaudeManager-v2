import type BetterSqlite3 from 'better-sqlite3';
import { ErrorCode } from '../../shared/constants.js';
import { AppError } from '../utils/errors.js';

/**
 * PhaseRepository — Phase + 7단계 + WIP 예외 CRUD (FR-029)
 *
 * 정의 원본: DES-004 v2.2 §18(부트스트랩)·§전체 함수 시그니처 요약(PhaseService) ·
 * DES-002 v2.1 §5(GET /api/phases/current · POST /api/phases · POST /api/wip-waivers)
 * DB 스키마: DES-003 v2.1 §4-2(phases)·§4-3(stages)·§4-5(wip_waivers)
 * (migrations/003_phases.sql · 005_artifacts.sql)
 *
 * ── 교차 애그리거트 읽기 판단 메모 ──────────────────────────────
 * `GET /api/phases/current`는 stage마다 artifactCount(artifacts)·
 * pendingApprovalCount(approvals)·gate(approvals)가 필요하다. 그런데
 * "허용된 Service 간 의존 4건"(Stage→Approval→Agent→Conversation)에
 * PhaseService→ApprovalService도 →ArtifactService도 없다.
 * → 이 읽기는 Service 간 의존을 늘리지 않고 **Repository가 JOIN으로 직접
 * 집계**한다. AgentService가 ConversationRepository를 읽기 목적으로 직접
 * 참조하는 기존 선례, ApprovalService가 같은 이유로 MessageRepository를
 * 주입받은 선례(Layer 2-6)와 같은 원칙이다.
 * `findStagesWithAggregates`가 7단계를 한 번의 GROUP BY/윈도 함수 쿼리로
 * 가져온다 — 단계별로 반복 조회하는 N+1을 만들지 않는다.
 *
 * 레이어 규칙(src/CLAUDE.md §레이어 규칙 3): Repository는 쿼리만 수행한다.
 */

/** DB 행 그대로 — snake_case */
export interface PhaseRow {
  id: string;
  number: number;
  name: string;
  started_at: string | null;
  completed_at: string | null;
  current_stage: string | null;
}

export interface StageRow {
  id: string;
  phase_id: string;
  skill: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
}

/** `findStagesWithAggregates` 전용 — StageRow + 교차 애그리거트 집계값 */
export interface StageAggregateRow extends StageRow {
  artifact_count: number;
  pending_approval_count: number;
  /** 해당 단계의 최신 APV-GATE 승인 — 없으면 둘 다 null */
  gate_approval_id: string | null;
  gate_status: string | null;
}

export interface WipWaiverRow {
  id: string;
  phase_id: string;
  rule: string;
  reason: string;
  created_at: string;
}

export interface PhaseInsertRow {
  id: string;
  number: number;
  name: string;
  startedAt: string;
}

export interface StageInsertRow {
  id: string;
  phaseId: string;
  skill: string;
}

export interface WipWaiverInsertRow {
  id: string;
  phaseId: string;
  rule: string;
  reason: string;
  createdAt: string;
}

/** better-sqlite3의 UNIQUE 위반 에러 코드 — ProjectRepository와 같은 판별 패턴 */
function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

/** better-sqlite3의 FK 위반 에러 코드 — ApprovalRepository와 같은 판별 패턴 */
function isForeignKeyConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
  );
}

/** wip_waivers.reason CHECK(length(trim(reason)) > 0) 위반 — Service가 선검증하지만
 *  이중 방어로 여기서도 500이 아닌 400으로 변환한다 (개발 지시 §2 createWaiver 규칙) */
function isCheckConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'SQLITE_CONSTRAINT_CHECK'
  );
}

export class PhaseRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  /**
   * `number` 중복은 `phases_number_unique` 인덱스가 막는다. 그 위반을
   * 409 VALIDATION_ERROR로 번역한다(DES-002 §5 POST /api/phases 검증표).
   */
  insertPhase(row: PhaseInsertRow): PhaseRow {
    try {
      this.db
        .prepare('INSERT INTO phases (id, number, name, started_at) VALUES (?, ?, ?, ?)')
        .run(row.id, row.number, row.name, row.startedAt);
    } catch (cause) {
      if (isUniqueConstraintError(cause)) {
        throw new AppError(
          409,
          ErrorCode.VALIDATION_ERROR,
          `이미 존재하는 Phase 번호입니다: ${row.number}`,
        );
      }
      throw cause;
    }
    return this.findPhaseById(row.id) as PhaseRow;
  }

  /**
   * 부트스트랩 전용 — 멱등 (R-01). `phases_number_unique`가 충돌하면 조용히
   * 무시한다(예외를 던지지 않는다). `insertPhase`와 메서드를 분리한 이유는
   * `POST /api/phases`(번호 중복 시 명시적으로 409를 던져야 한다)와
   * `ensurePhase`(재기동해도 안전해야 한다)의 요구가 반대이기 때문이다.
   */
  upsertPhaseIgnoreConflict(row: PhaseInsertRow): PhaseRow {
    this.db
      .prepare(
        'INSERT INTO phases (id, number, name, started_at) VALUES (?, ?, ?, ?) ON CONFLICT(number) DO NOTHING',
      )
      .run(row.id, row.number, row.name, row.startedAt);
    return this.findPhaseByNumber(row.number) as PhaseRow;
  }

  findPhaseById(id: string): PhaseRow | null {
    const row = this.db.prepare('SELECT * FROM phases WHERE id = ?').get(id) as
      | PhaseRow
      | undefined;
    return row ?? null;
  }

  findPhaseByNumber(number: number): PhaseRow | null {
    const row = this.db.prepare('SELECT * FROM phases WHERE number = ?').get(number) as
      | PhaseRow
      | undefined;
    return row ?? null;
  }

  /**
   * "진행 중 Phase" = 아직 완료되지 않은 Phase(`completed_at IS NULL`) 중
   * 번호가 가장 큰 것 (설계 판단, 등급 낮음 — 자율 판단 후 기록). DES-002는
   * "진행 중 Phase 없음 → 404"만 규정하고 복수 후보 시 선택 기준을 정하지
   * 않았다 — CLAUDE.md의 "주요 단계 WIP = 1"이 Phase 자체의 동시 진행까지
   * 막지는 않으므로 방어적으로 최신 번호를 택한다.
   */
  findCurrentPhase(): PhaseRow | null {
    const row = this.db
      .prepare('SELECT * FROM phases WHERE completed_at IS NULL ORDER BY number DESC LIMIT 1')
      .get() as PhaseRow | undefined;
    return row ?? null;
  }

  insertStage(row: StageInsertRow): void {
    this.db
      .prepare("INSERT INTO stages (id, phase_id, skill, status) VALUES (?, ?, ?, 'pending')")
      .run(row.id, row.phaseId, row.skill);
  }

  /** 부트스트랩 전용 — `UNIQUE(phase_id, skill)` 충돌 시 조용히 무시한다 (R-01) */
  upsertStageIgnoreConflict(row: StageInsertRow): void {
    this.db
      .prepare(
        `INSERT INTO stages (id, phase_id, skill, status) VALUES (?, ?, ?, 'pending')
         ON CONFLICT(phase_id, skill) DO NOTHING`,
      )
      .run(row.id, row.phaseId, row.skill);
  }

  /**
   * Phase의 7단계 + 교차 애그리거트 집계를 **한 쿼리**로 가져온다 (N+1 방지).
   * `ROW_NUMBER() OVER (PARTITION BY stage_id ORDER BY created_at DESC)`로
   * 단계별 최신 APV-GATE 승인 1건만 남긴다 — MAX(created_at) 서브쿼리 방식은
   * 동시각 생성 시 조인이 중복 행을 만들 수 있어 윈도 함수를 썼다.
   * 정렬(스킬 순서)은 호출자(Service)가 SkillName 순서로 재배열한다 — 7행
   * 뿐이라 SQL의 CASE...WHEN보다 TS 배열 정렬이 더 읽기 쉽다.
   */
  findStagesWithAggregates(phaseId: string): StageAggregateRow[] {
    return this.db
      .prepare(
        `SELECT
           s.id, s.phase_id, s.skill, s.status, s.started_at, s.completed_at,
           COALESCE(ac.cnt, 0) AS artifact_count,
           COALESCE(pac.cnt, 0) AS pending_approval_count,
           ga.id AS gate_approval_id,
           ga.status AS gate_status
         FROM stages s
         LEFT JOIN (
           SELECT stage_id, COUNT(*) AS cnt FROM artifacts GROUP BY stage_id
         ) ac ON ac.stage_id = s.id
         LEFT JOIN (
           SELECT stage_id, COUNT(*) AS cnt FROM approvals
            WHERE status = 'pending' GROUP BY stage_id
         ) pac ON pac.stage_id = s.id
         LEFT JOIN (
           SELECT stage_id, id, status,
                  ROW_NUMBER() OVER (PARTITION BY stage_id ORDER BY created_at DESC) AS rn
           FROM approvals
           WHERE approval_type = 'APV-GATE'
         ) ga ON ga.stage_id = s.id AND ga.rn = 1
         WHERE s.phase_id = ?`,
      )
      .all(phaseId) as StageAggregateRow[];
  }

  countInProgressStages(phaseId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM stages WHERE phase_id = ? AND status = 'in_progress'")
      .get(phaseId) as { n: number };
    return row.n;
  }

  /** 해당 Phase·규칙의 가장 최근 면제 기록 (있으면 위반이어도 waived: true) */
  findWaiver(phaseId: string, rule: string): WipWaiverRow | null {
    const row = this.db
      .prepare(
        'SELECT * FROM wip_waivers WHERE phase_id = ? AND rule = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(phaseId, rule) as WipWaiverRow | undefined;
    return row ?? null;
  }

  /**
   * `phase_id` FK 위반은 404 NOT_FOUND로, `reason` CHECK 위반은 400
   * VALIDATION_ERROR로 변환한다. Service가 `reason`을 선검증하므로 CHECK
   * 경로는 정상 흐름에서 도달하지 않아야 하지만, 우회 호출에 대비한
   * 이중 방어다 (개발 지시 §2 "CHECK에 걸려 500이 나는 경로가 없어야 한다").
   */
  insertWaiver(row: WipWaiverInsertRow): WipWaiverRow {
    try {
      this.db
        .prepare(
          'INSERT INTO wip_waivers (id, phase_id, rule, reason, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(row.id, row.phaseId, row.rule, row.reason, row.createdAt);
    } catch (cause) {
      if (isForeignKeyConstraintError(cause)) {
        throw new AppError(404, ErrorCode.NOT_FOUND, `Phase를 찾을 수 없습니다: ${row.phaseId}`);
      }
      if (isCheckConstraintError(cause)) {
        throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'reason은 빈 문자열일 수 없습니다');
      }
      throw cause;
    }
    const inserted = this.db.prepare('SELECT * FROM wip_waivers WHERE id = ?').get(row.id) as
      | WipWaiverRow
      | undefined;
    return inserted as WipWaiverRow;
  }
}
