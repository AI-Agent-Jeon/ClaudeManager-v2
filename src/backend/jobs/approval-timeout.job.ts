import { APPROVAL_JOB_INTERVAL_MS } from '../../shared/constants.js';
import type { ApprovalService } from '../services/approval.service.js';

/**
 * ApprovalTimeoutJob — 타임아웃 자동 진행 스케줄러 (R-2, D-10)
 *
 * 정의 원본: DES-004 v2.4 §17(타임아웃 자동 진행 시퀀스) ·
 * §전체 함수 시그니처 요약(Jobs) · DES-001 v3.2 ADR-012(배치 위치)
 *
 * 배치 위치는 ADR-012로 확정됐다 — Fastify 프로세스 내부 `setInterval` 타이머.
 * 별도 워커 프로세스는 SQLite 단일 쓰기자 전제와 충돌해 기각됐다.
 *
 * 레이어 규칙 7(src/CLAUDE.md): Job은 Repository를 직접 만지지 않는다. 전건
 * `ApprovalService`를 경유해 등급 검사·`MSG-05` 기록·Agent 재개가 한 곳에서
 * 일어나게 한다. `APV-GATE`는 이중 방어다 — ①`findExpired()`의 조회 조건
 * (`deadline_at IS NOT NULL`)에 애초에 걸리지 않는다(GATE는 항상 high=무기한)
 * ②그래도 `autoAdvance()`가 유형을 한 번 더 검사해 거부한다. 그 거부(`AppError`)를
 * 여기서 로깅 후 삼켜 다음 건으로 넘어간다 — tick을 중단하지 않는다.
 */

/** 로깅만 쓴다 — Fastify `app.log`(Pino)와 `console` 둘 다 만족하는 최소 인터페이스 */
export interface JobLogger {
  error(...args: unknown[]): void;
}

export class ApprovalTimeoutJob {
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 이전 tick이 실행 중이면 새 tick을 건너뛴다 — `setInterval`은 실행 시간을 기다리지 않는다 */
  private ticking = false;

  constructor(
    private readonly approvalService: ApprovalService,
    private readonly logger: JobLogger = console,
    private readonly intervalMs: number = APPROVAL_JOB_INTERVAL_MS,
  ) {}

  /** 서버 `ready` 훅에서 `BootstrapService.seed()` 완료 후 1회 호출한다 (DES-001 §기동 순서 6단계) */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    // 이 타이머 하나로 프로세스가 살아있을 필요는 없다 — Fastify 리스닝 소켓이
    // 이미 그 역할을 한다. unref로 두면 테스트·CLI 종료 시 불필요하게 붙잡지 않는다.
    this.timer.unref?.();
  }

  /** Graceful Shutdown에서 가장 먼저 호출한다 — DB를 닫은 뒤 tick이 돌면 연결 오류가 난다 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;

    try {
      const now = new Date().toISOString();
      const expired = await this.approvalService.findExpired(now);

      for (const approval of expired) {
        try {
          await this.approvalService.autoAdvance(approval.id);
        } catch (err) {
          // APV-GATE 이중 방어 ②를 포함해, 한 건이 실패해도 나머지 건 처리를 막지 않는다
          this.logger.error(
            { err, approvalId: approval.id },
            'approval-timeout-job: autoAdvance 실패 — 다음 건으로 진행',
          );
        }
      }
    } catch (err) {
      // tick 내부 예외는 로깅 후 삼켜 서버를 죽이지 않는다
      this.logger.error({ err }, 'approval-timeout-job: tick 실패');
    } finally {
      this.ticking = false;
    }
  }
}
