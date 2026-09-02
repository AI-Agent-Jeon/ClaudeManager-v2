import { describe, expect, it, vi } from 'vitest';
import { type HubSocket, WebSocketHub } from '../../../../src/backend/ws/hub.js';
import { WsCloseCode } from '../../../../src/shared/constants.js';

/**
 * NFR-003 실시간 메시지 전달 — 수용 기준
 *   Given 새 메시지 발생 When 클라이언트 연결됨 Then 3초 이내 전달
 *   Given 연결 끊김 When 재연결 Then 누락 메시지는 **조회로 보충**
 *
 * 정의 원본: DES-001 v3.2 §레이어 규칙 8 (WS Hub는 출력 전용)
 *          DES-002 v2.1 §2-4 (버퍼링하지 않는다)
 */

function fakeSocket(): HubSocket & { sent: string[]; closed: number[] } {
  const sent: string[] = [];
  const closed: number[] = [];
  return {
    sent,
    closed,
    readyState: 1,
    send: (data: string) => sent.push(data),
    close: (code?: number) => closed.push(code ?? 1000),
  };
}

describe('WebSocketHub — 채널 브로드캐스트', () => {
  it('같은 채널 구독자에게만 보낸다', () => {
    const hub = new WebSocketHub();
    const a = fakeSocket();
    const b = fakeSocket();

    hub.register('conv:1', a);
    hub.register('conv:2', b);
    hub.broadcast('conv:1', { event: 'message:new', data: { id: 'm1' } });

    expect(a.sent).toHaveLength(1);
    expect(JSON.parse(a.sent[0] as string)).toEqual({
      event: 'message:new',
      data: { id: 'm1' },
    });
    expect(b.sent).toHaveLength(0);
  });

  it('구독자가 없는 채널에 보내도 던지지 않는다', () => {
    const hub = new WebSocketHub();
    expect(() => hub.broadcast('없는채널', { event: 'x', data: {} })).not.toThrow();
  });

  it('전역 브로드캐스트는 전역 채널 구독자에게 간다', () => {
    const hub = new WebSocketHub();
    const global = fakeSocket();
    const conv = fakeSocket();

    hub.register(WebSocketHub.GLOBAL_CHANNEL, global);
    hub.register('conv:1', conv);
    hub.broadcastGlobal({ event: 'status:changed', data: { id: 'p1' } });

    expect(global.sent).toHaveLength(1);
    expect(conv.sent).toHaveLength(0);
  });

  it('해제한 소켓에는 보내지 않는다', () => {
    const hub = new WebSocketHub();
    const s = fakeSocket();

    hub.register('conv:1', s);
    hub.unregister('conv:1', s);
    hub.broadcast('conv:1', { event: 'message:new', data: {} });

    expect(s.sent).toHaveLength(0);
  });

  it('닫힌 소켓은 건너뛰고 정리한다', () => {
    const hub = new WebSocketHub();
    const dead = fakeSocket();
    const alive = fakeSocket();

    hub.register('conv:1', dead);
    hub.register('conv:1', alive);
    dead.readyState = 3; // CLOSED

    hub.broadcast('conv:1', { event: 'message:new', data: {} });

    expect(dead.sent).toHaveLength(0);
    expect(alive.sent).toHaveLength(1);
    expect(hub.size('conv:1')).toBe(1);
  });

  it('한 소켓의 send 실패가 다른 소켓 전달을 막지 않는다', () => {
    const hub = new WebSocketHub();
    const broken: HubSocket = {
      readyState: 1,
      send: () => {
        throw new Error('EPIPE');
      },
      close: vi.fn(),
    };
    const ok = fakeSocket();

    hub.register('conv:1', broken);
    hub.register('conv:1', ok);

    expect(() => hub.broadcast('conv:1', { event: 'message:new', data: {} })).not.toThrow();
    expect(ok.sent).toHaveLength(1);
  });
});

describe('WebSocketHub — 출력 전용 (레이어 규칙 8)', () => {
  it('버퍼링하지 않는다 — 구독 전 발행분은 사라진다', () => {
    // 재연결 후 누락은 REST 조회로 보충한다 (DES-002 §2-4)
    const hub = new WebSocketHub();
    hub.broadcast('conv:1', { event: 'message:new', data: { id: 'lost' } });

    const late = fakeSocket();
    hub.register('conv:1', late);

    expect(late.sent).toHaveLength(0);
  });
});

describe('WebSocketHub — 종료 (DES-001 Graceful Shutdown 3단계)', () => {
  it('모든 소켓에 1001 Going Away를 보내고 비운다', () => {
    const hub = new WebSocketHub();
    const a = fakeSocket();
    const b = fakeSocket();

    hub.register('conv:1', a);
    hub.register(WebSocketHub.GLOBAL_CHANNEL, b);
    hub.closeAll();

    expect(a.closed).toEqual([WsCloseCode.GOING_AWAY]);
    expect(b.closed).toEqual([WsCloseCode.GOING_AWAY]);
    expect(hub.size('conv:1')).toBe(0);
  });
});
