import type BetterSqlite3 from 'better-sqlite3';
import {
  ApprovalStatus,
  EntityType,
  ErrorCode,
  type SkillName,
  StageStatus,
  WIP_RULE,
} from '../../shared/constants.js';
import type { StageSummary } from '../../shared/types.js';
import type {
  PhaseRepository,
  StageAggregateRow,
  StageRow,
} from '../repositories/phase.repository.js';
import type { StatusChangeRepository } from '../repositories/status-change.repository.js';
import { AppError } from '../utils/errors.js';
import { validateTransition } from '../utils/state-machine.js';
import type { WebSocketHub } from '../ws/hub.js';
import type { ApprovalService } from './approval.service.js';
import { isGateRequired, sortBySkillOrder, toStageSummary } from './stage-mapper.js';

/**
 * StageService (FR-030 승인 게이트 강제)
 *
 * 정의 원본: DES-004 v2.4 §16(착수 시퀀스) · §전체 함수 시그니처 요약(StageService) ·
 * DES-002 v2.1 §5 `POST /api/stages/:id/start` · DES-007 v2.1 §7 · §7-1 · §7-2
 * DB 스키마: DES-003 v2.1 §4-3 (stages) — 마이그레이션은 003_phases.sql(기존)
 *
 * ── 이 계층이 왜 중요한가 ──────────────────────────────────────
 * `POST /api/stages/:id/start`가 CLAUDE.md 스킬 전환 게이트의 **유일한**
 * 강제 지점이다. 화면에서 버튼을 감추는 것으로는 강제되지 않으며 CLI·API
 * 직접 호출도 여기를 지난다 (DES-004 §16 주석).
 *
 * ── 3단 가드 순서 (DES-007 §7-1 · DES-002 §5) ────────────────────
 * 1. 직전 단계가 completed인가 → 422 INVALID_TRANSITION
 *    (자기 자신의 상태 전이 유효성도 여기서 함께 본다 — `pending` 이외의
 *    상태에서 착수를 시도하면 `STAGE_TRANSITIONS`가 이미 거부한다.
 *    `src/shared/state-transitions.ts`를 조회만 한다 — 하드코딩 금지)
 * 2. 게이트 필요 단계면 APV-GATE가 approved인가 → 403 GATE_NOT_PASSED
 *    (`ApprovalService.findGateApproval()` 경유 — `StageService → ApprovalService`는
 *    "허용된 Service 간 의존 5건" 중 하나다. ApprovalRepository를 직접 만지지 않는다)
 * 3. WIP=1 위반인데 면제(`wip_waivers`)가 없는가 → 409 WIP_VIOLATION
 *
 * ── gate.required 파생 ────────────────────────────────────────
 * `isGateRequired()`는 `./stage-mapper.js`(단일 원본은 `shared/constants.ts`의
 * `GATE_REQUIRED_SKILLS`)를 그대로 위임한다. `PhaseService.isGateRequired`와
 * 다른 배열을 참조하면 어느 stage에 `APV-GATE`를 채워야 하는지가 갈린다
 * (Layer 2-8 개발 지시 §2, 이 계층의 실패 조건).
 *
 * ── 상태 머신 — 선형 3상태 (R-03) ─────────────────────────────
 * `pending → in_progress → completed`. 되돌아가는 전이는 없다. 게이트 반려의
 * 효력은 "대상 단계가 pending에 머무는 것"이며, 그것은 전이가 아니라
 * **전이가 일어나지 않는 것**이다(DES-007 §7). 이 서비스는 `pending`으로
 * 되돌리는 메서드를 두지 않는다.
 *
 * ── 승인은 건드리지 않는다 (R-03) ─────────────────────────────
 * `approvals`를 쓰지 않는다. `ApprovalService.findGateApproval()`로 읽기만 한다.
 *
 * ── 트랜잭션 규칙 (Layer 2-6·2-7에서 확립) ───────────────────────
 * 가드 3단(직전 단계 조회 · 게이트 조회 · WIP 조회)은 전부 트랜잭션 **밖**에서
 * 수행한다 — `findGateApproval`이 `async`라 `db.transaction()`의 동기 콜백
 * 안에서 값을 꺼낼 수 없기 때문이다. 실제 쓰기(`stages` 전이 + `phases.current_stage`
 * 갱신 + `status_changes` 기록)만 동기 콜백 하나로 묶는다. `void`로 async
 * 함수를 fire-and-forget 호출하지 않는다 — 이 패턴은 커밋 `47e1396`·`d3cb4e6`에서
 * 제거되었고 다시 만들지 않는다.
 */

export class StageService {
  constructor(
    /** 트랜잭션 경계 전용. 쿼리는 Repository가 한다 */
    private readonly db: BetterSqlite3.Database,
    private readonly phaseRepo: PhaseRepository,
    /** "허용된 Service 간 의존 5건" 중 하나(Stage→Approval) — Repository를 직접 만지지 않는다 */
    private readonly approvalService: ApprovalService,
    private readonly statusChangeRepo: StatusChangeRepository,
    private readonly hub: WebSocketHub,
  ) {}

  /** 스킬 전환 모드에서 파생 — 저장하지 않는다 (DES-007 §7-2) */
  isGateRequired(skill: SkillName): boolean {
    return isGateRequired(skill);
  }

  /**
   * FR-030 — 단계 착수. 3단 가드를 순서대로 통과해야 `pending → in_progress`
   * 전이가 일어난다 (DES-007 §7-1 · DES-004 §16).
   */
  async start(id: string): Promise<StageSummary> {
    const stage = this.getStageOrThrow(id);

    // 가드 1 — 직전 단계 완료 + 자기 자신의 전이 유효성
    this.assertValidStartTransition(stage);

    // 가드 2 — 게이트 필요 단계면 APV-GATE가 approved인가
    if (this.isGateRequired(stage.skill as SkillName)) {
      const gate = await this.approvalService.findGateApproval(stage.id);
      if (!gate || gate.status !== ApprovalStatus.APPROVED) {
        throw new AppError(
          403,
          ErrorCode.GATE_NOT_PASSED,
          `승인 게이트(APV-GATE)를 통과하지 못했습니다: ${stage.skill}`,
        );
      }
    }

    // 가드 3 — WIP=1 위반인데 면제가 없는가
    const inProgressCount = this.phaseRepo.countInProgressStages(stage.phase_id);
    if (inProgressCount >= 1) {
      const waiver = this.phaseRepo.findWaiver(stage.phase_id, WIP_RULE);
      if (!waiver) {
        throw new AppError(
          409,
          ErrorCode.WIP_VIOLATION,
          'WIP=1 규칙을 위반합니다. cm progress --waive로 면제를 등록하세요',
        );
      }
    }

    const now = new Date().toISOString();
    this.db.transaction((): void => {
      this.phaseRepo.startStage(stage.id, now);
      this.phaseRepo.updateCurrentStage(stage.phase_id, stage.skill);
      this.statusChangeRepo.insert({
        entityType: EntityType.STAGE,
        entityId: stage.id,
        fromStatus: stage.status,
        toStatus: StageStatus.IN_PROGRESS,
        changedBy: 'ceo',
        changedAt: now,
      });
    })();

    const summary = this.toSummarySync(stage.id);
    // 기록이 먼저, 발행이 나중이다 — 트랜잭션 커밋 후 브로드캐스트 (DES-004 §9)
    this.hub.broadcastGlobal({ event: 'stage:changed', data: summary });
    return summary;
  }

  /**
   * `in_progress → completed` 전이. `POST /api/stages/:id/complete`
   * (`stages.routes.ts`)가 이 메서드를 그대로 호출한다(Layer 2-8 보완,
   * 대표 승인 A안 — DES-002 §3-3 엔드포인트 목록 누락 보완).
   *
   * 선행 조건은 두지 않는다 — 산출물 개수·승인 상태를 검사하지 않는다.
   * 그 판단은 대표의 몫이며, 여기서 검사를 걸면 `start`의 3단 가드에 이은
   * 두 번째 강제 지점이 생겨 R-03("게이트 강제는 start 한 곳에서만")이
   * 흐려진다. `phases.current_stage`도 바꾸지 않는다 — 다음 `start`가
   * 갱신한다.
   */
  async complete(id: string): Promise<StageSummary> {
    const stage = this.getStageOrThrow(id);

    if (!validateTransition(EntityType.STAGE, stage.status, StageStatus.COMPLETED)) {
      throw new AppError(
        422,
        ErrorCode.INVALID_TRANSITION,
        `${stage.status} 상태에서는 완료로 전이할 수 없습니다`,
      );
    }

    const now = new Date().toISOString();
    this.db.transaction((): void => {
      this.phaseRepo.completeStage(stage.id, now);
      this.statusChangeRepo.insert({
        entityType: EntityType.STAGE,
        entityId: stage.id,
        fromStatus: stage.status,
        toStatus: StageStatus.COMPLETED,
        changedBy: 'ceo',
        changedAt: now,
      });
    })();

    const summary = this.toSummarySync(stage.id);
    this.hub.broadcastGlobal({ event: 'stage:changed', data: summary });
    return summary;
  }

  private getStageOrThrow(id: string): StageRow {
    const stage = this.phaseRepo.findStageById(id);
    if (!stage) {
      throw new AppError(404, ErrorCode.STAGE_NOT_FOUND, `단계를 찾을 수 없습니다: ${id}`);
    }
    return stage;
  }

  /**
   * 가드 1 — `pending → in_progress`가 `STAGE_TRANSITIONS`(하드코딩 아님)로
   * 허용되는지 먼저 보고, 허용되면 직전 단계(스킬 순서상 바로 앞)가
   * `completed`인지 확인한다. `plan`(첫 단계)은 직전 단계가 없어 통과한다
   * (DES-007 §7-1 "첫 번째 단계에는 직전 단계가 없다").
   */
  private assertValidStartTransition(stage: StageRow): void {
    if (!validateTransition(EntityType.STAGE, stage.status, StageStatus.IN_PROGRESS)) {
      throw new AppError(
        422,
        ErrorCode.INVALID_TRANSITION,
        `이미 ${stage.status} 상태인 단계는 착수할 수 없습니다`,
      );
    }

    const siblings = sortBySkillOrder(this.phaseRepo.findStagesByPhase(stage.phase_id));
    const idx = siblings.findIndex((s) => s.id === stage.id);
    const preceding = idx > 0 ? siblings[idx - 1] : null;
    if (preceding && preceding.status !== StageStatus.COMPLETED) {
      throw new AppError(
        422,
        ErrorCode.INVALID_TRANSITION,
        `직전 단계(${preceding.skill})가 완료되지 않았습니다`,
      );
    }
  }

  /** 동기 코어 — 단계 1건을 StageSummary로 조립한다 (읽기 전용) */
  private toSummarySync(stageId: string): StageSummary {
    const row = this.phaseRepo.findStageWithAggregates(stageId) as StageAggregateRow;
    return toStageSummary(row);
  }
}
