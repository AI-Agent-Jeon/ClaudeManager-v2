import type BetterSqlite3 from 'better-sqlite3';
import {
  AgentStatus,
  APPROVAL_TIMEOUT_MS,
  ApprovalStatus,
  ApprovalType,
  ConversationStatus,
  DecisionLevel,
  EntityType,
  ErrorCode,
  MessageType,
  SenderRole,
  SyncStatus,
  WaitingReason,
} from '../../shared/constants.js';
import type {
  ApprovalDetail,
  ApprovalImpact,
  ApprovalOption,
  ApprovalSummary,
  ArtifactRef,
  CreateApprovalInput,
  ListApprovalsOpts,
  ResolveApprovalInput,
} from '../../shared/types.js';
import type { AgentRepository } from '../repositories/agent.repository.js';
import type {
  ApprovalInsertRow,
  ApprovalRepository,
  ApprovalRow,
} from '../repositories/approval.repository.js';
import type { ArtifactRepository, ArtifactRow } from '../repositories/artifact.repository.js';
import type { ConversationRepository } from '../repositories/conversation.repository.js';
import type { MessageRepository } from '../repositories/message.repository.js';
import type { StatusChangeRepository } from '../repositories/status-change.repository.js';
import { AppError } from '../utils/errors.js';
import { validateTransition } from '../utils/state-machine.js';
import type { WebSocketHub } from '../ws/hub.js';
import type { AgentService } from './agent.service.js';
// 파생 로직(deriveSyncStatus)만 가져온다 — ArtifactService 인스턴스를 주입받지
// 않으므로 "허용된 Service 간 의존 4건"을 늘리지 않는다(순수 함수 import는
// DB·상태에 접근하지 않아 Service 간 호출 그래프에 간선을 추가하지 않는다).
// 3NF 파생 규칙(DES-003 §4-4)의 단일 원본은 artifact.service.ts 하나뿐이어야
// 하므로, 여기서 같은 로직을 복제하지 않고 그 함수를 그대로 재사용한다.
import { deriveSyncStatus } from './artifact.service.js';

/**
 * ApprovalService (FR-028 · FR-030)
 *
 * 정의 원본: DES-004 v2.4 §15(요청·응답)·§16(게이트 검증 조회)·§17(타임아웃) ·
 * §전체 함수 시그니처 요약 (Services) · DES-002 v2.1 §5(엔드포인트)·§6-4(스키마)
 * DB 스키마: DES-003 v2.1 §4-1 (CHECK 제약 5건)
 *
 * ── 의존 설계 메모 ──────────────────────────────────────────────
 *
 * 1) MessageRepository·ConversationRepository를 ConversationService를 거치지
 *    않고 **직접** 주입받는다. DES-004 §15 시퀀스가 `AS->>MR: messageRepo.insert`로
 *    명시하는 그대로다. 이유는 원자성이다 — MSG-04(요청)/MSG-01(응답)/MSG-05(자동
 *    진행) 기록과 approvals 갱신은 **하나의 SQLite 트랜잭션**이어야 하는데(요구
 *    사항 "위 전체가 한 트랜잭션이다"), `ConversationService.appendSystemMessage`
 *    처럼 async 함수는(내부에 실제 await가 없어도) 호출 즉시 syncronous 하게
 *    반환값을 얻을 수 없다 — `async` 키워드가 있으면 항상 Promise로 감싸이므로
 *    `db.transaction()`의 동기 콜백 안에서 값을 꺼낼 수 없다. 이는 AgentService
 *    가 ConversationRepository를 직접 참조하는 기존 패턴(읽기 전용)과 같은
 *    원칙을 쓰기에도 적용한 것이다.
 *
 * 2) AgentRepository를 직접 주입받는 이유는 DEV-D-06 때문이다 — `requested_by`는
 *    자유 문자열이라 `'main'`처럼 Agent 행이 없는 요청자가 있다. 존재 여부를
 *    조용히 확인(예외 없이)하려면 AgentService.getById(예외를 던진다)가 아니라
 *    AgentRepository.findById(null 반환)가 필요하다. `closeByRequester()`도
 *    같은 판단 기준을 쓴다.
 *
 * 3) `StatusChangeRepository`를 직접 쓰고 `StatusChangeService`를 거치지 않는다
 *    — `project.service.ts`·`agent.service.ts`와 같은 이유다: Service→Service
 *    호출로 두면 "허용된 Service 간 의존 4건" 밖의 결합이 늘어난다.
 *
 * 4) Agent 상태 전이(`AgentService.updateStatus`)는 **트랜잭션 밖에서, 커밋 후**
 *    호출한다. DES-001 v3 §Cross-Cutting "전이 이벤트 발행은 트랜잭션 커밋 후"
 *    규칙과 같은 이유로 WS 브로드캐스트도 트랜잭션 밖에서 한다 — approvals
 *    자체(승인 기록)의 원자성이 최우선이고, Agent 쪽 부수 효과는 일반적인
 *    await 호출로 실패 시 정상적으로 예외가 전파되게 둔다.
 *
 * 5) `ArtifactRepository`도 같은 원칙으로 직접 주입받는다(Layer 2-9). 승인
 *    상세(`ApprovalDetail.artifacts`)를 조립하려면 산출물 코드 배열을 실제
 *    행으로 펼쳐야 하는데, `ApprovalService → ArtifactService`는 "허용된
 *    Service 간 의존 4건"(`Stage→Approval→Agent→Conversation`)에 없다.
 *    Layer 2-7(`PhaseService`가 집계를 위해 Repository를 직접 읽은 선례)과
 *    같은 판단이다 — 읽기 전용 조회는 Service 계층을 거치지 않고
 *    Repository를 직접 주입받는다.
 */

/** `ArtifactRow` → `ArtifactRef` (승인 상세 `artifacts` 필드) */
function toArtifactRef(row: ArtifactRow): ArtifactRef {
  return {
    code: row.code,
    title: row.title,
    notionUrl: row.notion_url,
    gitPath: row.git_path,
    syncStatus: deriveSyncStatus(row.notion_url, row.git_path),
  };
}

/**
 * `approvals.artifacts`에 저장된 코드가 `artifacts` 테이블에 없을 때의
 * 표시값 (개발 지시 §3 — "코드에 해당하는 artifact 행이 없으면 빈 필드로
 * 두되 syncStatus='missing'"). 조회 실패로 승인 상세 전체가 깨지면 안
 * 되므로 예외를 던지지 않고 이 값으로 채운다 — 아직 산출물 행이 생성되기
 * 전에 승인이 먼저 상정되는 순서(승인 요청 시점에 문서가 없을 수 있다)를
 * 정상 경로로 취급한다.
 */
function toMissingArtifactRef(code: string): ArtifactRef {
  return { code, title: code, notionUrl: null, gitPath: null, syncStatus: SyncStatus.MISSING };
}

function parseJson<T>(value: string | null): T | null {
  return value ? (JSON.parse(value) as T) : null;
}

function toSummary(row: ApprovalRow): ApprovalSummary {
  const now = Date.now();
  const createdAtMs = new Date(row.created_at).getTime();
  const deadlineAtMs = row.deadline_at ? new Date(row.deadline_at).getTime() : null;

  return {
    id: row.id,
    approvalType: row.approval_type as ApprovalSummary['approvalType'],
    level: row.level as ApprovalSummary['level'],
    subject: row.subject,
    requestedBy: row.requested_by,
    status: row.status as ApprovalSummary['status'],
    deadlineAt: row.deadline_at,
    elapsedSeconds: Math.max(0, Math.floor((now - createdAtMs) / 1000)),
    remainingSeconds: deadlineAtMs !== null ? Math.floor((deadlineAtMs - now) / 1000) : null,
    createdAt: row.created_at,
  };
}

/**
 * §3 스텁 교체 — `approvals.artifacts`(코드 문자열 배열)를 실제 `artifacts`
 * 행으로 펼친다. `artifactRepo`를 인자로 받는 이유는 `ApprovalRepository`를
 * 직접 만지지 않는다는 규칙과 같은 이유로 이 함수를 모듈 스코프 순수
 * 함수로 유지하기 위해서다 — 인스턴스 메서드로 바꾸면 `toSummary` 등
 * 주변 순수 함수들과 스타일이 갈린다. 코드에 대응하는 행이 없으면
 * `toMissingArtifactRef`로 채운다 — 조회 실패로 승인 상세 전체가 깨지지
 * 않는다.
 */
function toDetail(row: ApprovalRow, artifactRepo: ArtifactRepository): ApprovalDetail {
  const artifactCodes = parseJson<string[]>(row.artifacts) ?? [];
  const found = new Map(artifactRepo.findByCodes(artifactCodes).map((a) => [a.code, a]));

  return {
    ...toSummary(row),
    options: parseJson<ApprovalOption[]>(row.options) ?? [],
    artifacts: artifactCodes.map((code) => {
      const artifact = found.get(code);
      return artifact ? toArtifactRef(artifact) : toMissingArtifactRef(code);
    }),
    rationale: row.rationale,
    impact: parseJson<ApprovalImpact>(row.impact),
    messageId: row.message_id,
    stageId: row.stage_id,
    resolution: row.resolution,
    reason: row.reason,
    resolvedAt: row.resolved_at,
  };
}

/** resolve() 처리 결과를 MSG-01 본문으로 만든다 */
function buildResolutionBody(input: ResolveApprovalInput): string {
  const verb: Record<ResolveApprovalInput['status'], string> = {
    approved: '승인',
    rejected: '반려',
    conditional: '조건부 승인',
  };
  const label = verb[input.status];
  return input.reason ? `${label}: ${input.reason}` : label;
}

export class ApprovalService {
  constructor(
    /** 트랜잭션 경계 전용. 쿼리는 Repository가 한다 */
    private readonly db: BetterSqlite3.Database,
    private readonly approvalRepo: ApprovalRepository,
    private readonly statusChangeRepo: StatusChangeRepository,
    private readonly messageRepo: MessageRepository,
    private readonly conversationRepo: ConversationRepository,
    private readonly agentRepo: AgentRepository,
    private readonly artifactRepo: ArtifactRepository,
    private readonly agentService: AgentService,
    private readonly hub: WebSocketHub,
  ) {}

  /**
   * FR-028 — 승인 요청 발행 (§15 [1]). `level==='low'`면 적재하지 않고 `null`을
   * 반환한다(R-06). `high`/`medium`은 MSG-04 기록 → approvals INSERT →
   * status_changes 기록까지 하나의 트랜잭션이다. 커밋 후 Agent를 `waiting`으로
   * 전이하고 `approval:created`를 브로드캐스트한다.
   */
  async request(input: CreateApprovalInput): Promise<ApprovalDetail | null> {
    // 게이트는 등급 하향 불가 (DB CHECK (4) · DES-002 §5)
    if (input.approvalType === ApprovalType.GATE && input.level !== DecisionLevel.HIGH) {
      throw new AppError(
        422,
        ErrorCode.VALIDATION_ERROR,
        'APV-GATE는 등급 high로 고정됩니다 (하향 불가)',
      );
    }

    const conversation = this.conversationRepo.findById(input.conversationId);
    if (!conversation) {
      throw new AppError(
        404,
        ErrorCode.CONVERSATION_NOT_FOUND,
        `대화 채널을 찾을 수 없습니다: ${input.conversationId}`,
      );
    }
    if (conversation.status !== ConversationStatus.ACTIVE) {
      throw new AppError(
        409,
        ErrorCode.CONVERSATION_ARCHIVED,
        `읽기 전용 채널입니다 (상태: ${conversation.status})`,
      );
    }

    const now = new Date().toISOString();

    if (input.level === DecisionLevel.LOW) {
      // R-06 — approvals에 적재하지 않는다. 자율 판단은 MSG-05로 대화에만 남고
      // Agent 상태는 건드리지 않는다(§15 [1] "Agent는 waiting으로 가지 않는다")
      this.messageRepo.insert({
        id: crypto.randomUUID(),
        conversationId: input.conversationId,
        msgType: MessageType.SYSTEM_EVENT,
        senderRole: SenderRole.SYSTEM,
        body: input.subject,
        structured: null,
        createdAt: now,
      });
      return null;
    }

    // high → 무기한(null) · medium → now + 30분 (D-10 · APPROVAL_TIMEOUT_MS)
    const deadlineAt =
      input.level === DecisionLevel.HIGH
        ? null
        : new Date(Date.now() + APPROVAL_TIMEOUT_MS).toISOString();

    const id = crypto.randomUUID();
    const row = this.db.transaction((): ApprovalRow => {
      const message = this.messageRepo.insert({
        id: crypto.randomUUID(),
        conversationId: input.conversationId,
        msgType: MessageType.DECISION_REQUEST,
        senderRole: SenderRole.AGENT,
        body: input.subject,
        structured: null,
        createdAt: now,
      });

      const insertRow: ApprovalInsertRow = {
        id,
        messageId: message.id,
        stageId: input.stageId ?? null,
        approvalType: input.approvalType,
        level: input.level,
        subject: input.subject,
        options: JSON.stringify(input.options),
        artifacts: input.artifacts ? JSON.stringify(input.artifacts) : null,
        rationale: input.rationale ?? null,
        impact: input.impact ? JSON.stringify(input.impact) : null,
        requestedBy: input.requestedBy,
        deadlineAt,
        createdAt: now,
      };
      const inserted = this.approvalRepo.insert(insertRow);

      this.statusChangeRepo.insert({
        entityType: EntityType.APPROVAL,
        entityId: id,
        fromStatus: null,
        toStatus: ApprovalStatus.PENDING,
        changedBy: 'system',
        changedAt: now,
      });

      return inserted;
    })();

    // high·APV-GATE → ceo_approval(무기한) / medium → ceo_decision(30분) (§15)
    const waitingReason =
      input.approvalType === ApprovalType.GATE || input.level === DecisionLevel.HIGH
        ? WaitingReason.CEO_APPROVAL
        : WaitingReason.CEO_DECISION;
    await this.transitionRequesterStatus(input.requestedBy, AgentStatus.WAITING, waitingReason);

    this.hub.broadcastGlobal({ event: 'approval:created', data: toSummary(row) });
    return toDetail(row, this.artifactRepo);
  }

  /** FR-028 — 목록. `sort` 기본값은 'deadline'(DES-002 §5) */
  async list(opts: ListApprovalsOpts): Promise<ApprovalSummary[]> {
    const rows = this.approvalRepo.findMany({
      status: opts.status,
      level: opts.level,
      type: opts.type,
      sort: opts.sort ?? 'deadline',
    });
    return rows.map(toSummary);
  }

  async getById(id: string): Promise<ApprovalDetail> {
    const row = this.approvalRepo.findById(id);
    if (!row) {
      throw new AppError(404, ErrorCode.APPROVAL_NOT_FOUND, `승인 건을 찾을 수 없습니다: ${id}`);
    }
    return toDetail(row, this.artifactRepo);
  }

  /**
   * FR-028 — 대표 응답 처리 (§15 [2]). 검증 순서·에러 코드가 DES-002 §5와 1:1이다.
   * approvals 갱신 → MSG-01 기록까지 하나의 트랜잭션. 커밋 후 approved·
   * conditional이면 요청 Agent를 `running`으로 전이한다(rejected는 waiting 유지).
   */
  async resolve(id: string, input: ResolveApprovalInput): Promise<ApprovalDetail> {
    const approval = this.approvalRepo.findById(id);
    if (!approval) {
      throw new AppError(404, ErrorCode.APPROVAL_NOT_FOUND, `승인 건을 찾을 수 없습니다: ${id}`);
    }
    if (approval.status !== ApprovalStatus.PENDING) {
      throw new AppError(409, ErrorCode.APPROVAL_ALREADY_RESOLVED, '이미 처리된 승인 건입니다');
    }
    if ((input.status === 'rejected' || input.status === 'conditional') && !input.reason) {
      throw new AppError(
        400,
        ErrorCode.APPROVAL_REASON_REQUIRED,
        '반려·조건부 승인은 사유가 필요합니다',
      );
    }
    // ResolveApprovalInput 타입은 'auto_advanced'를 배제하지만, 호출부가 타입을
    // 우회할 수 있어 런타임에서도 막는다(§15 [2] "APV-GATE에 auto_advanced 시도")
    if (
      approval.approval_type === ApprovalType.GATE &&
      (input.status as string) === ApprovalStatus.AUTO_ADVANCED
    ) {
      throw new AppError(
        422,
        ErrorCode.GATE_AUTO_ADVANCE_FORBIDDEN,
        'APV-GATE는 자동 진행할 수 없습니다',
      );
    }
    if (input.resolution != null) {
      const options = parseJson<ApprovalOption[]>(approval.options) ?? [];
      if (!options.some((o) => o.code === input.resolution)) {
        throw new AppError(
          400,
          ErrorCode.VALIDATION_ERROR,
          `옵션에 없는 resolution 코드입니다: ${input.resolution}`,
        );
      }
    }

    const now = new Date().toISOString();
    const updated = this.db.transaction((): ApprovalRow => {
      const row = this.approvalRepo.resolve(id, {
        status: input.status,
        resolution: input.resolution ?? null,
        reason: input.reason ?? null,
        resolvedAt: now,
      });

      this.statusChangeRepo.insert({
        entityType: EntityType.APPROVAL,
        entityId: id,
        fromStatus: ApprovalStatus.PENDING,
        toStatus: input.status,
        changedBy: 'ceo',
        changedAt: now,
      });

      this.postFollowUpMessage(
        approval.message_id,
        buildResolutionBody(input),
        MessageType.CEO_UTTERANCE,
        SenderRole.CEO,
        now,
      );

      return row;
    })();

    if (input.status === 'approved' || input.status === 'conditional') {
      await this.transitionRequesterStatus(updated.requested_by, AgentStatus.RUNNING, null);
    }
    // rejected — Agent는 waiting 유지. 사유는 위에서 기록한 MSG-01로 전달된다

    this.hub.broadcastGlobal({ event: 'approval:updated', data: toSummary(updated) });
    return toDetail(updated, this.artifactRepo);
  }

  /** DES-004 §16 — StageService.start()의 게이트 검증이 조회한다(StageRepository를 직접 만지지 않는다) */
  async findGateApproval(stageId: string): Promise<ApprovalDetail | null> {
    const row = this.approvalRepo.findLatestGateByStage(stageId);
    return row ? toDetail(row, this.artifactRepo) : null;
  }

  /** 스케줄러(ApprovalTimeoutJob) 전용 — §17 */
  async findExpired(now: string): Promise<ApprovalSummary[]> {
    return this.approvalRepo.findExpired(now).map(toSummary);
  }

  /**
   * 스케줄러 전용 — §17. `APV-GATE`는 이중 방어로 거부한다: ①`findExpired`의
   * 조회 조건(`deadline_at IS NOT NULL`)에 애초에 걸리지 않는다(GATE는 항상
   * high=무기한) ②그래도 여기서 한 번 더 유형을 검사한다.
   */
  async autoAdvance(id: string): Promise<ApprovalDetail> {
    const approval = this.approvalRepo.findById(id);
    if (!approval) {
      throw new AppError(404, ErrorCode.APPROVAL_NOT_FOUND, `승인 건을 찾을 수 없습니다: ${id}`);
    }
    if (approval.approval_type === ApprovalType.GATE) {
      throw new AppError(
        422,
        ErrorCode.GATE_AUTO_ADVANCE_FORBIDDEN,
        'APV-GATE는 자동 진행할 수 없습니다',
      );
    }

    const now = new Date().toISOString();
    const updated = this.db.transaction((): ApprovalRow => {
      const row = this.approvalRepo.resolve(id, {
        status: ApprovalStatus.AUTO_ADVANCED,
        resolution: null,
        reason: null,
        resolvedAt: now,
      });

      this.statusChangeRepo.insert({
        entityType: EntityType.APPROVAL,
        entityId: id,
        fromStatus: ApprovalStatus.PENDING,
        toStatus: ApprovalStatus.AUTO_ADVANCED,
        changedBy: 'system',
        changedAt: now,
      });

      this.postFollowUpMessage(
        approval.message_id,
        '기한 만료로 자동 진행되었습니다',
        MessageType.SYSTEM_EVENT,
        SenderRole.SYSTEM,
        now,
      );

      return row;
    })();

    await this.transitionRequesterStatus(updated.requested_by, AgentStatus.RUNNING, null);
    this.hub.broadcastGlobal({ event: 'approval:updated', data: toSummary(updated) });
    return toDetail(updated, this.artifactRepo);
  }

  /**
   * 동기 코어 — Agent 삭제 시 미처리 승인 자동 마감 (R-04).
   *
   * `agents.routes.ts`의 DELETE 핸들러가 `db.transaction()` 콜백 **안에서
   * 이 메서드를 직접** 호출한다(`agentService.deleteSync()`보다 먼저). `async`
   * 키워드가 없으므로 본문 안에 `await`를 쓰면 컴파일 자체가 되지 않는다 —
   * "트랜잭션 콜백 안에서 안전하다"(내부에 실제 비동기 지점이 없다)는 불변조건을
   * 주석이 아니라 타입 체커가 강제한다. `approvalRepo`·`statusChangeRepo`는
   * 둘 다 동기라 자연스럽게 만족된다.
   *
   * 자체 `db.transaction()`을 한 번 더 열지만, better-sqlite3는 트랜잭션 함수를
   * 다른 트랜잭션 함수 안에서 호출하는 것을 SAVEPOINT로 지원하므로 Route가 연
   * 바깥 트랜잭션에 안전하게 중첩된다.
   */
  closeByRequesterSync(requestedBy: string): number {
    const now = new Date().toISOString();
    const closedIds = this.db.transaction((): string[] => {
      const ids = this.approvalRepo.closePendingByRequester(requestedBy, {
        resolution: 'system:agent_deleted',
        reason: '요청 Agent 삭제로 자동 마감',
        resolvedAt: now,
      });
      for (const approvalId of ids) {
        this.statusChangeRepo.insert({
          entityType: EntityType.APPROVAL,
          entityId: approvalId,
          fromStatus: ApprovalStatus.PENDING,
          toStatus: ApprovalStatus.REJECTED,
          changedBy: 'system',
          changedAt: now,
        });
      }
      return ids;
    })();
    return closedIds.length;
  }

  /**
   * 공개 API — DES-004 §전체 함수 시그니처 요약의 `Promise<number>` 그대로다.
   * 동기 코어(`closeByRequesterSync`)를 감싸는 얇은 래퍼이며, 단독 호출(트랜잭션
   * 조율이 필요 없는 경우)에 쓴다. R-04 트랜잭션 조율에는 동기 코어를 쓴다.
   */
  async closeByRequester(requestedBy: string): Promise<number> {
    return this.closeByRequesterSync(requestedBy);
  }

  /**
   * DEV-D-06 — `requested_by`는 자유 문자열이다(`'main'` 등 Agent 행이 없는
   * 요청자가 있다). Agent로 존재하면 상태를 전이하고, 없으면 조용히 건너뛴다.
   *
   * REV-H-02/SEC-09 — 이 호출은 항상 `request()`/`resolve()`의 트랜잭션이
   * **커밋된 뒤**에 일어난다(클래스 상단 의존 설계 메모 4번). 커밋 후 부수효과가
   * 예외를 던지면 승인(approvals) 행은 이미 확정됐는데 응답만 422로 실패하고,
   * 재시도는 409 APPROVAL_ALREADY_RESOLVED로 막다른 길이 된다(예: 프로젝트
   * cancelled 캐스케이드로 요청자 Agent가 이미 `cancelled`인 채 승인이 뒤늦게
   * 처리되는 경로). 그래서 `agentService.updateStatus`(내부에서 422를 던질 수
   * 있다)를 그대로 부르지 않고, `validateTransition`으로 **먼저** 검사한다.
   * 전이가 불가하면 예외를 전파하지 않고 경고만 남긴 채 건너뛴다 — DEV-D-06이
   * 세운 "요청자 Agent 행이 없으면 조용히 건너뛴다" 선례를 "행은 있지만 현재
   * 상태에서 전이가 불가한 경우"까지 넓힌 것이다.
   */
  private async transitionRequesterStatus(
    requestedBy: string,
    newStatus: AgentStatus,
    waitingReason: WaitingReason | null,
  ): Promise<void> {
    const exists = this.agentRepo.findById(requestedBy);
    if (!exists) return;
    if (!validateTransition('agent', exists.status, newStatus)) {
      console.warn(
        `[approval.service] 요청자 Agent 상태 전이를 건너뜁니다 (허용되지 않는 전이): ` +
          `${requestedBy} ${exists.status} → ${newStatus}`,
      );
      return;
    }
    await this.agentService.updateStatus(requestedBy, newStatus, waitingReason);
  }

  /** 응답/자동 진행 시 원 요청 메시지가 속한 채널에 후속 메시지를 남긴다 */
  private postFollowUpMessage(
    sourceMessageId: string | null,
    body: string,
    msgType: MessageType,
    senderRole: SenderRole,
    now: string,
  ): void {
    if (!sourceMessageId) return;
    const source = this.messageRepo.findById(sourceMessageId);
    if (!source) return;
    this.messageRepo.insert({
      id: crypto.randomUUID(),
      conversationId: source.conversation_id,
      msgType,
      senderRole,
      body,
      structured: null,
      createdAt: now,
    });
  }
}
