import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConversationRepository } from '../../../../src/backend/repositories/conversation.repository.js';
import { MessageRepository } from '../../../../src/backend/repositories/message.repository.js';
import { ConversationService } from '../../../../src/backend/services/conversation.service.js';
import { AppError } from '../../../../src/backend/utils/errors.js';
import {
  createTestDb,
  seedAgent,
  seedAgentChannel,
  seedMainChannel,
  seedMessage,
  seedProject,
  type TestDb,
} from '../../../fixtures/test-db.js';

/**
 * ConversationService — FR-026 · FR-027
 *
 * 정의 원본: DES-004 v2.2 §14·§18 · §전체 함수 시그니처 요약 (Services)
 */

let testDb: TestDb;
let service: ConversationService;

beforeEach(() => {
  testDb = createTestDb();
  service = new ConversationService(
    new ConversationRepository(testDb.db),
    new MessageRepository(testDb.db),
  );
});

afterEach(() => {
  testDb.close();
});

describe('list — FR-026', () => {
  it('Given main·agent 채널이 있을 때 When status 지정 없이 조회하면 Then 기본값 active만 반환된다', async () => {
    seedMainChannel(testDb.db);
    const projectId = seedProject(testDb.db);
    const agentId = seedAgent(testDb.db, projectId);
    const archivedId = seedAgentChannel(testDb.db, agentId);
    testDb.db.prepare("UPDATE conversations SET status = 'archived' WHERE id = ?").run(archivedId);

    const result = await service.list({});
    expect(result.every((c) => c.status === 'active')).toBe(true);
    expect(result.find((c) => c.id === archivedId)).toBeUndefined();
  });

  it('type=main 필터로 CH-MAIN을 찾을 수 있다 (경로에 main 별칭을 두지 않는 대체 경로)', async () => {
    const mainId = seedMainChannel(testDb.db);
    const result = await service.list({ type: 'main' });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(mainId);
    expect(result[0]?.title).toBe('Main');
  });

  it('lastMessageAt은 가장 최근 메시지 시각으로 파생된다', async () => {
    const convId = seedMainChannel(testDb.db);
    seedMessage(testDb.db, convId, { createdAt: '2024-01-01T00:00:00.000Z' });
    seedMessage(testDb.db, convId, { createdAt: '2024-06-01T00:00:00.000Z' });

    const result = await service.list({ type: 'main' });
    expect(result[0]?.lastMessageAt).toBe('2024-06-01T00:00:00.000Z');
  });

  it('unreadCount는 항상 0이다 — 읽음 상태 컬럼이 스키마에 없다 (임시 조치)', async () => {
    seedMainChannel(testDb.db);
    const result = await service.list({ type: 'main' });
    expect(result[0]?.unreadCount).toBe(0);
  });

  it('아카이브된 채널의 title은 entitySnapshot에서 나온다 — Agent 행이 없어도 표시된다 (D-27)', async () => {
    const projectId = seedProject(testDb.db);
    const agentId = seedAgent(testDb.db, projectId, { name: '삭제예정에이전트' });
    const convId = seedAgentChannel(testDb.db, agentId);

    await service.archiveByEntity(agentId, {
      agentName: '삭제예정에이전트',
      projectName: '프로젝트명',
      projectId: crypto.randomUUID(),
      agentType: 'dev',
    });
    // D-27 — Agent 행 자체가 사라져도 이름이 나와야 한다
    testDb.db.prepare('DELETE FROM agents WHERE id = ?').run(agentId);

    const result = await service.list({ status: 'archived' });
    const archived = result.find((c) => c.id === convId);
    expect(archived?.title).toBe('삭제예정에이전트');
    expect(archived?.entitySnapshot?.agentName).toBe('삭제예정에이전트');
  });
});

describe('getById', () => {
  it('존재하지 않는 채널은 404 CONVERSATION_NOT_FOUND', async () => {
    await expect(service.getById(crypto.randomUUID())).rejects.toMatchObject({
      statusCode: 404,
      code: 'CONVERSATION_NOT_FOUND',
    });
  });
});

describe('listMessages — 커서 페이지네이션 (FR-027)', () => {
  it('존재하지 않는 채널은 404 CONVERSATION_NOT_FOUND', async () => {
    await expect(service.listMessages(crypto.randomUUID(), {})).rejects.toMatchObject({
      statusCode: 404,
      code: 'CONVERSATION_NOT_FOUND',
    });
  });

  it('limit+1건 조회로 hasMore를 판정한다 — 정확히 limit개면 hasMore는 false', async () => {
    const convId = seedMainChannel(testDb.db);
    for (let i = 0; i < 3; i++) {
      seedMessage(testDb.db, convId, { createdAt: new Date(2024, 0, 1, 0, 0, i).toISOString() });
    }

    const result = await service.listMessages(convId, { limit: 3 });
    expect(result.data).toHaveLength(3);
    expect(result.cursor.hasMore).toBe(false);
    expect(result.cursor.next).toBeNull();
  });

  it('초과분이 있으면 hasMore가 true이고 next 커서가 채워진다', async () => {
    const convId = seedMainChannel(testDb.db);
    for (let i = 0; i < 5; i++) {
      seedMessage(testDb.db, convId, { createdAt: new Date(2024, 0, 1, 0, 0, i).toISOString() });
    }

    const result = await service.listMessages(convId, { limit: 3 });
    expect(result.data).toHaveLength(3);
    expect(result.cursor.hasMore).toBe(true);
    expect(result.cursor.next).not.toBeNull();
  });

  it('커서로 이어 조회하면 중복·누락 없이 전건을 순회한다', async () => {
    const convId = seedMainChannel(testDb.db);
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      ids.push(
        seedMessage(testDb.db, convId, { createdAt: new Date(2024, 0, 1, 0, 0, i).toISOString() }),
      );
    }

    const collected: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = await service.listMessages(convId, { limit: 3, cursor });
      collected.push(...page.data.map((m) => m.id));
      if (!page.cursor.hasMore) break;
      cursor = page.cursor.next as string;
    }

    expect(collected).toHaveLength(7);
    expect(new Set(collected).size).toBe(7); // 중복 없음
    expect(collected).toEqual([...ids].reverse()); // 최신순 순회 결과가 원본의 역순과 같다
  });

  it('구조가 잘못된 커서는 400 VALIDATION_ERROR', async () => {
    const convId = seedMainChannel(testDb.db);
    await expect(service.listMessages(convId, { cursor: 'not-base64-json' })).rejects.toThrow(
      AppError,
    );
  });
});

describe('sendMessage — FR-027', () => {
  it('Given active 채널일 때 When 발화하면 Then MSG-01/ceo로 고정 저장된다', async () => {
    const convId = seedMainChannel(testDb.db);
    const message = await service.sendMessage(convId, { body: '지시사항' });

    expect(message.msgType).toBe('MSG-01');
    expect(message.senderRole).toBe('ceo');
    expect(message.body).toBe('지시사항');
  });

  it('Given readonly 채널일 때 When 발화하면 Then 409 CONVERSATION_ARCHIVED', async () => {
    const convId = seedMainChannel(testDb.db);
    testDb.db.prepare("UPDATE conversations SET status = 'readonly' WHERE id = ?").run(convId);

    await expect(service.sendMessage(convId, { body: '실패해야함' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONVERSATION_ARCHIVED',
    });
  });

  it('Given archived 채널일 때 When 발화하면 Then 409 CONVERSATION_ARCHIVED', async () => {
    const convId = seedMainChannel(testDb.db);
    testDb.db.prepare("UPDATE conversations SET status = 'archived' WHERE id = ?").run(convId);

    await expect(service.sendMessage(convId, { body: '실패해야함' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONVERSATION_ARCHIVED',
    });
  });

  it('Given 존재하지 않는 채널일 때 When 발화하면 Then 404 CONVERSATION_NOT_FOUND', async () => {
    await expect(
      service.sendMessage(crypto.randomUUID(), { body: '없는채널' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'CONVERSATION_NOT_FOUND' });
  });
});

describe('search — FR-027 FTS5', () => {
  it('검색 결과에 conversationTitle과 snippet이 포함된다', async () => {
    const convId = seedMainChannel(testDb.db);
    seedMessage(testDb.db, convId, { body: 'DES-004 시퀀스 다이어그램 개정' });

    const results = await service.search({ q: '시퀀스' });
    expect(results).toHaveLength(1);
    expect(results[0]?.conversationTitle).toBe('Main');
    expect(results[0]?.snippet).toContain('<mark>');
  });

  describe('SEC-05/REV-M-05 — FTS5 특수문자가 섞여도 구문 오류(500)가 아니다', () => {
    // 이스케이프 전에는 이 값들이 그대로 MATCH에 바인딩되면
    // `fts5: syntax error near ...`를 던졌다(재현: GET /conversations/search?q=%22
    // 또는 q=AND). 이제는 큰따옴표로 감싼 phrase 리터럴로 변환돼 구문 오류가
    // 나지 않는다 — 결과가 없어도(0건) 예외 없이 빈 배열이어야 한다.
    it.each([
      ['큰따옴표 하나', '"'],
      ['불리언 연산자 AND', 'AND'],
      ['접두어 연산자 *', '설계*'],
      ['NEAR 연산자', 'NEAR(a b)'],
    ])('%s(%s)는 예외 없이 처리된다', async (_label, q) => {
      const convId = seedMainChannel(testDb.db);
      seedMessage(testDb.db, convId, { body: '관련 없는 본문' });

      await expect(service.search({ q })).resolves.toBeInstanceOf(Array);
    });

    it('큰따옴표가 포함된 검색어도 이스케이프되어 해당 문구를 담은 메시지를 찾는다', async () => {
      const convId = seedMainChannel(testDb.db);
      seedMessage(testDb.db, convId, { body: '설계 문서에 "승인 대기" 상태를 명시했다' });

      const results = await service.search({ q: '"승인 대기"' });
      expect(results).toHaveLength(1);
    });
  });
});

describe('exportMarkdown — FR-027', () => {
  it('마크다운 문자열을 반환한다', async () => {
    const convId = seedMainChannel(testDb.db);
    seedMessage(testDb.db, convId, { body: '본문내용' });

    const markdown = await service.exportMarkdown(convId);
    expect(markdown).toContain('# Main');
    expect(markdown).toContain('본문내용');
  });

  it('존재하지 않는 채널은 404 CONVERSATION_NOT_FOUND', async () => {
    await expect(service.exportMarkdown(crypto.randomUUID())).rejects.toMatchObject({
      statusCode: 404,
      code: 'CONVERSATION_NOT_FOUND',
    });
  });
});

describe('appendSystemMessage', () => {
  it('msgType별로 senderRole이 고정 매핑된다', async () => {
    const convId = seedMainChannel(testDb.db);

    const main = await service.appendSystemMessage(convId, 'MSG-02', 'Main 응답');
    expect(main.senderRole).toBe('main');

    const system = await service.appendSystemMessage(convId, 'MSG-05', '타임아웃 자동 진행');
    expect(system.senderRole).toBe('system');
  });

  it('structured가 있으면 저장·복원된다 (MSG-03 4단 보고)', async () => {
    const convId = seedMainChannel(testDb.db);
    const message = await service.appendSystemMessage(convId, 'MSG-03', '보고', {
      summary: '요약',
      workDone: '수행내용',
      artifacts: ['docs/a.md'],
      openIssues: '미해결',
    });

    expect(message.structured).toEqual({
      summary: '요약',
      workDone: '수행내용',
      artifacts: ['docs/a.md'],
      openIssues: '미해결',
    });
  });
});

describe('createForAgent — 채널 생명주기 (D-09)', () => {
  it('Agent id로 CH-AGENT를 개설하고 title은 Agent 이름이다', async () => {
    const projectId = seedProject(testDb.db);
    const agentId = seedAgent(testDb.db, projectId, { name: '신규에이전트' });

    const conv = await service.createForAgent(agentId);
    expect(conv.channelType).toBe('agent');
    expect(conv.status).toBe('active');
    expect(conv.title).toBe('신규에이전트');
  });
});

describe('markReadonly — Agent 종료 시 (DES-007 v2 §8)', () => {
  it('active 채널을 readonly로 전환한다', async () => {
    const projectId = seedProject(testDb.db);
    const agentId = seedAgent(testDb.db, projectId);
    const convId = seedAgentChannel(testDb.db, agentId);

    await service.markReadonly(agentId);

    const conv = await service.getById(convId);
    expect(conv.status).toBe('readonly');
  });

  it('채널이 없으면 조용히 반환한다 (방어적 처리)', async () => {
    await expect(service.markReadonly(crypto.randomUUID())).resolves.toBeUndefined();
  });
});

describe('archiveByEntity — Agent 삭제 시 (D-27)', () => {
  it('채널을 archived로 전환하고 snapshot을 남긴다', async () => {
    const projectId = seedProject(testDb.db);
    const agentId = seedAgent(testDb.db, projectId, { name: '삭제될이름' });
    const convId = seedAgentChannel(testDb.db, agentId);

    const returnedId = await service.archiveByEntity(agentId, {
      agentName: '삭제될이름',
      projectName: '프로젝트',
      projectId: crypto.randomUUID(),
      agentType: 'dev',
    });

    expect(returnedId).toBe(convId);
    const conv = await service.getById(convId);
    expect(conv.status).toBe('archived');
    expect(conv.archivedAt).not.toBeNull();
  });

  it('채널이 없으면 404 CONVERSATION_NOT_FOUND', async () => {
    await expect(
      service.archiveByEntity(crypto.randomUUID(), {
        agentName: 'x',
        projectName: 'y',
        projectId: 'p',
        agentType: 'z',
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'CONVERSATION_NOT_FOUND' });
  });
});

describe('ensureMainChannel — 부트스트랩 (R-01)', () => {
  it('CH-MAIN이 없으면 생성한다', async () => {
    const conv = await service.ensureMainChannel();
    expect(conv.channelType).toBe('main');
    expect(conv.title).toBe('Main');
  });

  it('멱등이다 — 두 번 호출해도 같은 id를 반환한다', async () => {
    const first = await service.ensureMainChannel();
    const second = await service.ensureMainChannel();
    expect(second.id).toBe(first.id);

    const rows = testDb.db
      .prepare("SELECT COUNT(*) as n FROM conversations WHERE channel_type='main'")
      .get() as {
      n: number;
    };
    expect(rows.n).toBe(1);
  });
});
