import { SHUTDOWN_TIMEOUT_MS } from '../shared/constants.js';
import { buildApp } from './app.js';

/**
 * 서버 진입점 — listen + Graceful Shutdown
 *
 * 정의 원본: DES-001 v3.2 §기동 순서 · §Graceful Shutdown
 *
 * 기동 순서 1~4단계는 buildApp이 담당한다. 여기는 5~7단계다.
 */

async function main(): Promise<void> {
  const app = await buildApp({ logger: true });
  const { host, port, authSecretGenerated, authSecret } = app.config;

  if (authSecretGenerated) {
    // ADR-005: 시크릿 미설정 시 랜덤 생성 후 콘솔 출력.
    // 매 기동마다 값이 바뀌어 기존 토큰이 무효가 되므로 반드시 알린다.
    console.info(
      [
        '',
        '  ⚠ CM_AUTH_SECRET이 설정되지 않아 이번 기동용 시크릿을 생성했습니다.',
        `     ${authSecret}`,
        '     .env에 CM_AUTH_SECRET으로 저장하지 않으면 재시작 시 토큰이 무효가 됩니다.',
        '',
      ].join('\n'),
    );
  }

  // 5단계 BootstrapService.seed() — Layer R-1에서 여기에 들어간다.
  //    CH-MAIN·Phase 1·7단계 멱등 시드. 실패하면 listen하지 않고 종료한다 (R-01).
  // 6단계 ApprovalTimeoutJob.start() — Layer R-2.

  // 7단계
  await app.listen({ host, port });

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    app.log.info({ signal }, 'graceful shutdown 시작');

    // 시간 안에 끝나지 않으면 강제 종료한다. 진행 중인 요청을 기다리되
    // 무한정 기다리지는 않는다 (FR-001).
    const timer = setTimeout(() => {
      app.log.error('shutdown timeout — 강제 종료');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();

    try {
      // ApprovalTimeoutJob.stop()이 여기 맨 앞에 들어간다 (Layer R-2).
      // DB를 닫은 뒤 tick이 돌면 연결 오류가 난다 — 순서가 중요하다.

      // app.close()가 onClose 훅을 등록 역순으로 실행한다:
      //   WS 소켓 정리(1001) → DB 종료
      await app.close();
      clearTimeout(timer);
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'shutdown 실패');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  // FR-001 수용 기준: DB 연결에 실패하면 에러 메시지와 함께 시작이 중단된다
  console.error('서버 시작 실패:', err instanceof Error ? err.message : err);
  process.exit(1);
});
