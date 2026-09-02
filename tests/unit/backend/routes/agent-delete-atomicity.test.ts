import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/backend/app.js';
import { seedApproval } from '../../../fixtures/test-db.js';

/**
 * DELETE /api/agents/:id 트랜잭션 원자성 — R-04 (Layer 2-6 후속)
 *
 * 정의 원본: DES-004 v2.4 §13 · 레이어 규칙 9
 *
 * 왜 필요한가: `agents.routes.ts`의 DELETE 핸들러는
 * `approvalService.closeByRequesterSync(id)` → `agentService.deleteSync(id)`를
 * `db.transaction()` 콜백 **안에서 직접** 호출한다. 두 메서드 모두 `async`가
 * 아니므로("트랜잭션 콜백 안에서 안전하다"는 불변조건을 타입 체커가 강제한다)
 * 실제로 원자적이어야 한다 — `agent-atomicity.test.ts`(Agent 생성)·
 * `approval-atomicity.test.ts`(승인 요청·응답)와 같은 방식(실제 SQLite
 * 트랜잭션 롤백 검증)으로 DELETE 경로도 검증한다.
 */

let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  app = await buildApp({
    config: { dbPath: ':memory:', authSecret: 'test-secret', jwtExpiresIn: '7d' },
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { secret: 'test-secret' },
  });
  token = res.json().data.token;
});

afterEach(async () => {
  await app.close();
});

function authHeader() {
  return { authorization: `Bearer ${token}` };
}

async function createAgentWithApprovals(pendingCount: number): Promise<string> {
  const projectRes = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: authHeader(),
    payload: { name: `프로젝트-${crypto.randomUUID().slice(0, 8)}` },
  });
  const projectId = projectRes.json().data.id as string;

  const agentRes = await app.inject({
    method: 'POST',
    url: '/api/agents',
    headers: authHeader(),
    payload: { projectId, name: `에이전트-${crypto.randomUUID().slice(0, 8)}` },
  });
  const agentId = agentRes.json().data.id as string;

  for (let i = 0; i < pendingCount; i += 1) {
    seedApproval(app.db, { requestedBy: agentId, status: 'pending' });
  }

  return agentId;
}

const countPendingByRequester = (requestedBy: string) =>
  (
    app.db
      .prepare("SELECT COUNT(*) AS n FROM approvals WHERE requested_by = ? AND status = 'pending'")
      .get(requestedBy) as { n: number }
  ).n;

describe('DELETE /api/agents/:id 원자성 — 두 번째 단계(Agent 삭제) 실패', () => {
  it('승인 마감 이후 Agent 삭제가 실패하면(대화 채널 없음) 승인 마감도 함께 롤백된다', async () => {
    const agentId = await createAgentWithApprovals(2);

    // deleteSync가 CONVERSATION_NOT_FOUND로 실패하도록 채널을 미리 지운다 —
    // closeByRequesterSync(첫 단계)는 정상 완료된 뒤 두 번째 단계에서 실패한다
    app.db.prepare('DELETE FROM conversations WHERE entity_id = ?').run(agentId);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/agents/${agentId}`,
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('CONVERSATION_NOT_FOUND');

    // 롤백되었다면 승인은 여전히 pending이고 Agent 행도 남아 있어야 한다
    expect(countPendingByRequester(agentId)).toBe(2);
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/agents/${agentId}`,
      headers: authHeader(),
    });
    expect(getRes.statusCode).toBe(200);
  });
});

describe('DELETE /api/agents/:id 원자성 — 첫 번째 단계(승인 마감) 실패', () => {
  it('승인 마감이 실패하면 Agent 삭제는 실행되지 않고 전건 롤백된다', async () => {
    const agentId = await createAgentWithApprovals(1);

    // closeByRequesterSync 내부의 UPDATE approvals를 실패시킨다 — 실제
    // better-sqlite3 트랜잭션이 이 실패로 진짜 롤백하는지 검증한다
    // (approval-atomicity.test.ts와 같은 db.prepare 몽키패치 방식).
    const original = app.db.prepare.bind(app.db);
    // biome-ignore lint/suspicious/noExplicitAny: 테스트 전용 몽키패치
    (app.db as any).prepare = (sql: string) => {
      if (sql.includes("UPDATE approvals SET status = 'rejected'")) {
        throw new Error('승인 마감 실패 시뮬레이션');
      }
      return original(sql);
    };

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/agents/${agentId}`,
      headers: authHeader(),
    });

    // biome-ignore lint/suspicious/noExplicitAny: 테스트 전용 몽키패치 복원
    (app.db as any).prepare = original;

    expect(res.statusCode).toBe(500);

    // 롤백되었다면 승인은 여전히 pending이고, deleteSync(두 번째 단계)는
    // 아예 실행되지 않았어야 하므로 Agent 행도 남아 있어야 한다
    expect(countPendingByRequester(agentId)).toBe(1);
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/agents/${agentId}`,
      headers: authHeader(),
    });
    expect(getRes.statusCode).toBe(200);
  });
});
