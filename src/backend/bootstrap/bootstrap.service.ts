import type { FastifyInstance } from 'fastify';
import { ConversationRepository } from '../repositories/conversation.repository.js';
import { MessageRepository } from '../repositories/message.repository.js';
import { buildPhaseService } from '../routes/phases.routes.js';
import { ConversationService } from '../services/conversation.service.js';
import type { PhaseService } from '../services/phase.service.js';

/**
 * BootstrapService — 서버 최초 기동 시드 (R-1)
 *
 * 정의 원본: DES-004 v2.2 §18(부트스트랩 시퀀스) · §전체 함수 시그니처 요약(BootstrapService) ·
 * DES-002 v2.1 §5-1 · DES-001 v3.2 §기동 순서 5단계
 *
 * CH-MAIN 채널·Phase 1·7단계가 없으면 `cm chat main`·`cm progress`·`cm stage start`가
 * 빈 DB를 만나 전부 실패한다(R-01). 서버 기동마다 호출해도 안전한 멱등 시드다.
 *
 * 레이어 규칙 7(src/CLAUDE.md): Bootstrap도 Service만 호출한다. Repository를 직접
 * 만지면 "CH-MAIN은 전역 1개" · "Phase당 7단계" 같은 비즈니스 규칙을 시드가 우회한다.
 */

/** PLN-001 FR-026 수용 기준 · docs/00-progress.md Phase 구조 표 기준 */
const PHASE_1_NUMBER = 1;
const PHASE_1_NAME = '기반 구축';

export class BootstrapService {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly phaseService: PhaseService,
  ) {}

  /**
   * 서버 `ready` 훅에서 1회 호출한다. 순서가 중요하다 —
   * `stages.phase_id`가 `phases`를 참조하므로 conversations → phases(+stages) 순으로 심는다.
   * 실패하면 던진다. 호출자(server.ts)는 이 예외를 삼키지 않고 기동을 중단해야 한다(R-01).
   */
  async seed(): Promise<{ mainChannelId: string; phaseId: string }> {
    const mainChannel = await this.conversationService.ensureMainChannel();
    const phaseId = await this.phaseService.ensurePhase(PHASE_1_NUMBER, PHASE_1_NAME);
    return { mainChannelId: mainChannel.id, phaseId };
  }
}

/**
 * `BootstrapService`를 조립한다. `phases.routes.ts`의 `buildPhaseService`를 그대로
 * 재사용한다(같은 export 재사용 패턴 — `approvals.routes.ts`의 `buildApprovalService` 참고).
 * `conversations.routes.ts`는 별도 팩토리를 export하지 않으므로 여기서 직접 조립한다.
 */
export function buildBootstrapService(app: FastifyInstance): BootstrapService {
  const conversationService = new ConversationService(
    new ConversationRepository(app.db),
    new MessageRepository(app.db),
  );
  const phaseService = buildPhaseService(app);
  return new BootstrapService(conversationService, phaseService);
}
