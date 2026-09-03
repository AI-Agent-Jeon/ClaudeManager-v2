import { WsCloseCode } from '../../shared/constants.js';
import type { WsEnvelope } from '../../shared/types.js';

/**
 * WebSocket Hub — 채널별 브로드캐스트
 *
 * 정의 원본: DES-001 v3.2 §레이어 규칙 8 · DES-002 v2.1 §2-4
 *
 * ⚠ **출력 전용이다.** Hub는 Service를 호출하지 않는다. 호출하면 순환이 생긴다.
 * ⚠ **버퍼링하지 않는다.** 재연결 후 누락분은 REST 조회로 보충한다 (NFR-003).
 *    버퍼를 두면 "얼마나 오래, 몇 건까지"라는 정책이 필요해지고, 그 정책이
 *    틀리면 조용히 메시지를 잃는다. 보충 책임을 클라이언트에 명시적으로 둔다.
 */

/** ws 라이브러리에 직접 의존하지 않기 위한 최소 표면 */
export interface HubSocket {
  /** 1 = OPEN (ws.OPEN) */
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const OPEN = 1;

export class WebSocketHub {
  /** 전역 상태 스트리밍 채널 — WS /ws */
  static readonly GLOBAL_CHANNEL = '__global__';

  private readonly channels = new Map<string, Set<HubSocket>>();

  register(channel: string, socket: HubSocket): void {
    let set = this.channels.get(channel);
    if (!set) {
      set = new Set();
      this.channels.set(channel, set);
    }
    set.add(socket);
  }

  unregister(channel: string, socket: HubSocket): void {
    const set = this.channels.get(channel);
    if (!set) return;

    set.delete(socket);
    if (set.size === 0) this.channels.delete(channel);
  }

  /** 채널 구독자 수 — 테스트와 감시용 */
  size(channel: string): number {
    return this.channels.get(channel)?.size ?? 0;
  }

  broadcast<T>(channel: string, envelope: WsEnvelope<T>): void {
    const set = this.channels.get(channel);
    if (!set || set.size === 0) return;

    const payload = JSON.stringify(envelope);
    const dead: HubSocket[] = [];

    for (const socket of set) {
      if (socket.readyState !== OPEN) {
        dead.push(socket);
        continue;
      }
      try {
        socket.send(payload);
      } catch {
        // 한 소켓의 전송 실패가 나머지 전달을 막으면 안 된다.
        // 끊긴 소켓은 다음 tick에 정리된다.
        dead.push(socket);
      }
    }

    for (const socket of dead) this.unregister(channel, socket);
  }

  broadcastGlobal<T>(envelope: WsEnvelope<T>): void {
    this.broadcast(WebSocketHub.GLOBAL_CHANNEL, envelope);
  }

  /**
   * Graceful Shutdown 3단계 — 모든 소켓에 1001(Going Away)을 보내고 비운다.
   * DB를 닫기 전에 해야 한다 (DES-001 §Graceful Shutdown).
   */
  closeAll(): void {
    for (const set of this.channels.values()) {
      for (const socket of set) {
        try {
          socket.close(WsCloseCode.GOING_AWAY, 'server shutting down');
        } catch {
          // 이미 끊긴 소켓 — 종료 경로에서 예외를 올릴 이유가 없다
        }
      }
    }
    this.channels.clear();
  }
}
