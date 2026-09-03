import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveAuth } from '../../../src/cli/config.js';
import {
  ambiguousIdBlock,
  type CliApiClient,
  cascadeBlock,
  checkAuth,
  diffCascade,
  notFoundBlock,
  resolveId,
  toIdLookupFailure,
} from '../../../src/cli/runtime.js';

/**
 * `project`·`agent`·`task`·`status-changes` 공용 골격 — 수용 기준
 *
 * 정의 원본: DES-006 v3.2 §8(공통 에러·ID 축약 규칙) · 개발 지시 §3(1)(2)
 * (허용 상태 전이·캐스케이드 표시)
 */

interface NamedEntity {
  id: string;
  name: string;
}

function fakeClient(overrides: Partial<CliApiClient> = {}): CliApiClient {
  return {
    baseUrl: 'http://127.0.0.1:3000/api',
    get: vi.fn().mockRejectedValue(new Error('not stubbed')),
    post: vi.fn().mockRejectedValue(new Error('not stubbed')),
    patch: vi.fn().mockRejectedValue(new Error('not stubbed')),
    delete: vi.fn().mockRejectedValue(new Error('not stubbed')),
    ...overrides,
  };
}

let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'cm-cli-runtime-test-'));
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
});

describe('checkAuth', () => {
  it('토큰이 없으면 not_authenticated', () => {
    expect(checkAuth(homeDir)).toEqual({ ok: false, reason: 'not_authenticated' });
  });

  it('토큰이 만료됐으면 expired', () => {
    saveAuth({ token: 't', expiresAt: '2026-09-01T00:00:00.000Z' }, homeDir);
    const result = checkAuth(homeDir, () => new Date('2026-09-02T00:00:00.000Z'));
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('유효한 토큰이면 ok', () => {
    saveAuth({ token: 't', expiresAt: '2099-01-01T00:00:00.000Z' }, homeDir);
    expect(checkAuth(homeDir)).toEqual({ ok: true });
  });
});

describe('resolveId', () => {
  it('전체 UUID(36자)면 목록 조회 없이 그대로 통과시킨다', async () => {
    const get = vi.fn();
    const client = fakeClient({ get });
    const fullId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    const result = await resolveId<NamedEntity>(client, '/projects', fullId, (p) => p.name);

    expect(result).toEqual({ ok: true, id: fullId });
    expect(get).not.toHaveBeenCalled();
  });

  it('8자 접두어가 정확히 1건과 일치하면 전체 UUID로 확장한다', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: [{ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'A' }],
        pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
      }),
    });

    const result = await resolveId<NamedEntity>(client, '/projects', 'a1b2c3d4', (p) => p.name);

    expect(result).toEqual({ ok: true, id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' });
  });

  it('일치하는 항목이 없으면 not_found', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: [],
        pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 },
      }),
    });

    const result = await resolveId<NamedEntity>(client, '/projects', 'zzzzzzzz', (p) => p.name);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('둘 이상 일치하면 ambiguous + 후보 목록 (§8 "축약 충돌")', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: [
          { id: 'a1a1a1a1-0000-0000-0000-000000000001', name: 'A' },
          { id: 'a1a1a1a2-0000-0000-0000-000000000002', name: 'B' },
        ],
        pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
      }),
    });

    const result = await resolveId<NamedEntity>(client, '/projects', 'a1a1a1a', (p) => p.name);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('ambiguous');
  });

  it('여러 페이지를 훑는다', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ id: 'zzzzzzzz-0000-0000-0000-000000000000', name: 'Z' }],
        pagination: { page: 1, pageSize: 100, total: 2, totalPages: 2 },
      })
      .mockResolvedValueOnce({
        data: [{ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'A' }],
        pagination: { page: 2, pageSize: 100, total: 2, totalPages: 2 },
      });
    const client = fakeClient({ get });

    const result = await resolveId<NamedEntity>(client, '/projects', 'a1b2c3d4', (p) => p.name);

    expect(result).toEqual({ ok: true, id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' });
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('toIdLookupFailure', () => {
  it('not_found를 id 포함 실패로 바꾼다', () => {
    expect(toIdLookupFailure({ ok: false, reason: 'not_found' }, 'abc12345')).toEqual({
      ok: false,
      reason: 'not_found',
      id: 'abc12345',
    });
  });

  it('ambiguous는 candidates를 그대로 옮긴다', () => {
    const candidates = [{ id: 'a', label: 'A' }];
    expect(toIdLookupFailure({ ok: false, reason: 'ambiguous', candidates }, 'a')).toEqual({
      ok: false,
      reason: 'ambiguous',
      candidates,
    });
  });
});

describe('ambiguousIdBlock', () => {
  it('후보 목록과 "더 긴 ID를 입력하세요" 안내를 담는다', () => {
    const block = ambiguousIdBlock([
      { id: 'a1a1a1a1-...', label: 'A' },
      { id: 'a1a1a1a2-...', label: 'B' },
    ]);
    expect(block).toContain('더 긴 ID를 입력하세요');
    expect(block).toContain('a1a1a1a1-...');
    expect(block).toContain('a1a1a1a2-...');
  });
});

describe('diffCascade', () => {
  it('상태가 바뀐 항목만 캐스케이드 대상으로 뽑는다 (개발 지시 §3(2))', () => {
    const before = [
      { id: '1', status: 'running', name: 'Agent A' },
      { id: '2', status: 'waiting', name: 'Agent B' },
      { id: '3', status: 'completed', name: 'Agent C' },
    ];
    const after = [
      { id: '1', status: 'cancelled', name: 'Agent A' },
      { id: '2', status: 'cancelled', name: 'Agent B' },
      { id: '3', status: 'completed', name: 'Agent C' }, // 변화 없음 — 제외
    ];

    const result = diffCascade(before, after, (a) => a.name);

    expect(result).toEqual([
      { id: '1', label: 'Agent A', from: 'running', to: 'cancelled' },
      { id: '2', label: 'Agent B', from: 'waiting', to: 'cancelled' },
    ]);
  });

  it('after에 없는(삭제된) 항목은 무시한다', () => {
    const before = [{ id: '1', status: 'running', name: 'A' }];
    const result = diffCascade(before, [], (a) => a.name);
    expect(result).toEqual([]);
  });
});

describe('notFoundBlock', () => {
  // 그룹 D 개발 지시 §4 — 받침 있는 라벨("건"·"널")은 "을", 받침 없는
  // 라벨("Agent"·"Project", 발음상 받침 없는 "트"로 끝남)은 "를"이어야 한다.
  it('받침 있는 한글 라벨은 "을"을 쓴다 (승인 건)', () => {
    expect(notFoundBlock('승인 건', 'ap123456', 'cm approvals')).toBe(
      '✗ 승인 건을 찾을 수 없습니다: ap123456\n  cm approvals',
    );
  });

  it('받침 있는 한글 라벨은 "을"을 쓴다 (대화 채널)', () => {
    expect(notFoundBlock('대화 채널', 'ch123456', 'cm chat list')).toBe(
      '✗ 대화 채널을 찾을 수 없습니다: ch123456\n  cm chat list',
    );
  });

  it('받침 없는 한글 라벨은 "를"을 쓴다 (단계)', () => {
    expect(notFoundBlock('단계', 'st123456', 'cm progress')).toBe(
      '✗ 단계를 찾을 수 없습니다: st123456\n  cm progress',
    );
  });

  it('영문 라벨은 기존과 동일하게 "를"을 쓴다 (Agent·Project — 회귀 방지)', () => {
    expect(notFoundBlock('Agent', 'ag123456', 'cm agent list')).toBe(
      '✗ Agent를 찾을 수 없습니다: ag123456\n  cm agent list',
    );
    expect(notFoundBlock('Project', 'pr123456', 'cm project list')).toBe(
      '✗ Project를 찾을 수 없습니다: pr123456\n  cm project list',
    );
  });
});

describe('cascadeBlock', () => {
  it('⚠로 시작하고 각 대상의 이름·ID·전이를 담는다', () => {
    const block = cascadeBlock('캐스케이드: Agent 1건', [
      {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        label: 'Agent A',
        from: 'running',
        to: 'cancelled',
      },
    ]);
    expect(block.startsWith('⚠')).toBe(true);
    expect(block).toContain('Agent A');
    expect(block).toContain('a1b2c3d4'); // 8자로 축약
    expect(block).toContain('running → cancelled');
  });
});
