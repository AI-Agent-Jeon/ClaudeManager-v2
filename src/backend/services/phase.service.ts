import type BetterSqlite3 from 'better-sqlite3';
import { ErrorCode, type SkillName, WIP_RULE } from '../../shared/constants.js';
import type {
  CreatePhaseInput,
  CreateWipWaiverInput,
  PhaseCurrent,
  WipViolation,
} from '../../shared/types.js';
import type { PhaseRepository, PhaseRow } from '../repositories/phase.repository.js';
import { AppError } from '../utils/errors.js';
import { STAGE_ORDER, sortBySkillOrder, toStageSummary } from './stage-mapper.js';

/**
 * PhaseService (FR-029 진행 추적 · WIP)
 *
 * 정의 원본: DES-004 v2.2 §18(부트스트랩)·§전체 함수 시그니처 요약(PhaseService) ·
 * DES-002 v2.1 §5(GET /api/phases/current · POST /api/phases · POST /api/wip-waivers)
 * DB 스키마: DES-003 v2.1 §4-2·§4-3·§4-5
 *
 * ── 교차 애그리거트 읽기 판단 메모 ──────────────────────────────
 * `artifactCount`·`pendingApprovalCount`·`gate`는 "허용된 Service 간 의존
 * 4건"(Stage→Approval→Agent→{Conversation, Task})에 없는 PhaseService→ApprovalService·
 * →ArtifactService 의존을 요구한다. Service 의존을 늘리지 않기 위해, 이
 * 읽기 전용 집계는 **PhaseRepository가 JOIN으로 직접** 구한다(N+1 없이 한
 * 쿼리) — AgentService가 ConversationRepository를 읽기 목적으로 직접
 * 참조하는 기존 선례, ApprovalService가 같은 이유로 MessageRepository를
 * 직접 주입받은 선례(Layer 2-6)와 같은 원칙이다. `phase.repository.ts` 상단
 * 주석 참조.
 *
 * ── gate.required 파생 근거 ──────────────────────────────────
 * CLAUDE.md 스킬 전환 모드: `plan→analyze`·`test→deploy`만 승인 필수.
 * DES-002 v2.1 §5 `GET /api/phases/current` 응답 예시가 `skill: "plan"`
 * 단계에 `gate.required: true`를 보여준다 — 게이트는 **전환을 시작하는
 * 단계**(plan, test)에 귀속된다. 집합 자체(`GATE_REQUIRED_SKILLS`)의 단일
 * 원본은 `shared/constants.ts`다. **여기서 복제하지 않는다** —
 * `StageService`(착수 가드 2단, FR-030)가 같은 집합을 참조해야 어느 stage의
 * `approvals.stage_id`에 `APV-GATE`를 채워야 하는지가 갈리지 않는다
 * (Layer 2-8 개발 지시 §2). 판정 함수·`StageAggregateRow → StageSummary`
 * 변환은 `./stage-mapper.js`로 승격했다.
 *
 * ── 트랜잭션 규칙 ──────────────────────────────────────────
 * `create()`·`ensurePhase()`는 Phase 행 + 7단계를 `db.transaction()`의
 * 동기 콜백 안에서 만든다. `PhaseRepository`의 insert 계열 메서드는 전부
 * 동기라 async 래퍼 없이 트랜잭션 콜백에 바로 넣을 수 있다(Layer 2-6에서
 * 확립된 규칙 — `async` 메서드는 트랜잭션 콜백 안에서 값을 꺼낼 수 없다).
 */

export class PhaseService {
  constructor(
    /** 트랜잭션 경계 전용. 쿼리는 Repository가 한다 */
    private readonly db: BetterSqlite3.Database,
    private readonly phaseRepo: PhaseRepository,
  ) {}

  /** FR-029 — 진행 중 Phase 없음 → 404 NOT_FOUND (DES-002 §5) */
  async getCurrent(): Promise<PhaseCurrent> {
    const phase = this.phaseRepo.findCurrentPhase();
    if (!phase) {
      throw new AppError(404, ErrorCode.NOT_FOUND, '진행 중인 Phase가 없습니다');
    }
    return this.buildPhaseCurrentSync(phase);
  }

  /**
   * WIP=1 검사 — 저장하지 않고 조회 시점에 계산한다. `in_progress` 단계가
   * 2개 이상이면 위반. 면제(`wip_waivers`)가 있어도 **위반 자체는 계속
   * 보고**하고 `waived: true`로만 표시한다(감춤 금지 — 개발 지시 §2).
   * `GET /api/phases/current`(`buildPhaseCurrentSync`)도 같은 계산을 쓴다 —
   * `deriveWipViolationsSync`로 로직을 하나로 모았다.
   */
  async checkWip(phaseId: string): Promise<WipViolation[]> {
    const inProgressCount = this.phaseRepo.countInProgressStages(phaseId);
    return this.deriveWipViolationsSync(phaseId, inProgressCount);
  }

  /**
   * `reason` 필수 — 빈 문자열·공백만도 거부한다(400 VALIDATION_ERROR).
   * DB CHECK(`length(trim(reason)) > 0`)와 동일한 조건을 애플리케이션에서
   * 먼저 검증해 CHECK 위반이 500으로 새는 경로를 없앤다. `phaseId`가
   * 존재하지 않으면 FK 위반이 Repository에서 404 NOT_FOUND로 변환된다.
   */
  async createWaiver(input: CreateWipWaiverInput): Promise<void> {
    if (input.reason.trim().length === 0) {
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'reason은 빈 문자열일 수 없습니다');
    }

    this.phaseRepo.insertWaiver({
      id: crypto.randomUUID(),
      phaseId: input.phaseId,
      rule: input.rule,
      reason: input.reason,
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * FR-029 — Phase 행 + 7단계를 한 트랜잭션으로 생성한다(v2.1 R-01).
   * `number` 중복 → 409 VALIDATION_ERROR, `number < 1` → 400 VALIDATION_ERROR.
   */
  async create(input: CreatePhaseInput): Promise<PhaseCurrent> {
    if (input.number < 1) {
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'number는 1 이상이어야 합니다');
    }

    const phaseId = crypto.randomUUID();
    const now = new Date().toISOString();

    const phase = this.db.transaction((): PhaseRow => {
      const inserted = this.phaseRepo.insertPhase({
        id: phaseId,
        number: input.number,
        name: input.name,
        startedAt: now,
      });
      for (const skill of STAGE_ORDER) {
        this.phaseRepo.insertStage({ id: crypto.randomUUID(), phaseId, skill });
      }
      return inserted;
    })();

    return this.buildPhaseCurrentSync(phase);
  }

  /**
   * 부트스트랩 전용 — 멱등 (R-01). `INSERT … ON CONFLICT DO NOTHING` 계열이라
   * 몇 번을 호출해도 Phase 1행·단계 7행을 넘지 않는다. `BootstrapService`가
   * 서버 `ready` 훅에서 호출한다(§18) — 이 계층은 그 메서드만 제공한다.
   */
  async ensurePhase(number: number, name: string): Promise<string> {
    const phaseId = crypto.randomUUID();
    const now = new Date().toISOString();

    const phase = this.db.transaction((): PhaseRow => {
      const upserted = this.phaseRepo.upsertPhaseIgnoreConflict({
        id: phaseId,
        number,
        name,
        startedAt: now,
      });
      for (const skill of STAGE_ORDER) {
        this.phaseRepo.upsertStageIgnoreConflict({
          id: crypto.randomUUID(),
          phaseId: upserted.id,
          skill,
        });
      }
      return upserted;
    })();

    return phase.id;
  }

  /** 동기 코어 — Phase 행 하나를 PhaseCurrent 응답 형태로 조립한다 (읽기 전용, 트랜잭션 불필요) */
  private buildPhaseCurrentSync(phase: PhaseRow): PhaseCurrent {
    const stageRows = sortBySkillOrder(this.phaseRepo.findStagesWithAggregates(phase.id));
    const stages = stageRows.map(toStageSummary);
    const inProgressCount = stageRows.filter((s) => s.status === 'in_progress').length;

    return {
      phase: {
        id: phase.id,
        number: phase.number,
        name: phase.name,
        currentStage: (phase.current_stage as SkillName | null) ?? null,
      },
      stages,
      wipViolations: this.deriveWipViolationsSync(phase.id, inProgressCount),
    };
  }

  /** 동기 코어 — `checkWip()`과 `buildPhaseCurrentSync()`가 공유하는 WIP 판정 로직 */
  private deriveWipViolationsSync(phaseId: string, inProgressCount: number): WipViolation[] {
    if (inProgressCount < 2) return [];

    const waiver = this.phaseRepo.findWaiver(phaseId, WIP_RULE);
    return [
      {
        rule: WIP_RULE,
        detail: `${inProgressCount}개 단계가 동시에 in_progress`,
        waived: waiver !== null,
      },
    ];
  }
}
