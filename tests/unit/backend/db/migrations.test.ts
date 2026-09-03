import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATION_FILES, runMigrations } from '../../../../src/backend/db/migrate.js';

/**
 * 정의 원본: DES-003 v2.1 §9 마이그레이션 전략
 *
 * 이 테스트가 강제하는 것: **CHECK 제약이 실제로 데이터를 거부하는가.**
 * 설계는 "애플리케이션 검증에만 의존하지 않는다"고 규정했다. 제약이 선언만
 * 되어 있고 동작하지 않으면 그 규정이 지켜지지 않는 것이다.
 */

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
});

afterEach(() => {
  db.close();
});

const now = () => new Date().toISOString();

/** 제약 위반이면 던진다 — 던지지 않으면 제약이 동작하지 않는 것이다 */
function insertApproval(overrides: Record<string, unknown> = {}) {
  const row = {
    id: crypto.randomUUID(),
    message_id: null,
    stage_id: null,
    approval_type: 'APV-ARCH',
    level: 'high',
    subject: '테스트 안건',
    options: null,
    artifacts: null,
    rationale: null,
    impact: null,
    requested_by: 'main',
    deadline_at: null,
    status: 'pending',
    resolution: null,
    reason: null,
    resolved_at: null,
    created_at: now(),
    ...overrides,
  };
  db.prepare(
    `INSERT INTO approvals (id, message_id, stage_id, approval_type, level, subject, options,
       artifacts, rationale, impact, requested_by, deadline_at, status, resolution, reason,
       resolved_at, created_at)
     VALUES (@id, @message_id, @stage_id, @approval_type, @level, @subject, @options,
       @artifacts, @rationale, @impact, @requested_by, @deadline_at, @status, @resolution,
       @reason, @resolved_at, @created_at)`,
  ).run(row);
}

describe('마이그레이션 적용 — DES-003 §9-2', () => {
  it('6개 마이그레이션을 순서대로 정의한다', () => {
    expect(MIGRATION_FILES).toEqual([
      '001_initial.sql',
      '002_conversations.sql',
      '003_phases.sql',
      '004_approvals.sql',
      '005_artifacts.sql',
      '006_status_ext.sql',
      '007_conversation_read.sql',
    ]);
  });

  it('Phase 1 테이블 11개 + FTS5 가상 테이블 1개를 만든다', () => {
    const names = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table') AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((r) => (r as { name: string }).name);

    for (const t of [
      'projects',
      'agents',
      'tasks',
      'status_changes',
      'conversations',
      'messages',
      'phases',
      'stages',
      'approvals',
      'artifacts',
      'wip_waivers',
    ]) {
      expect(names).toContain(t);
    }
    expect(names).toContain('messages_fts');
  });

  it('멱등하다 — 두 번 실행해도 안전하다', () => {
    expect(() => runMigrations(db)).not.toThrow();
  });

  it('_migrations에 적용 이력을 남긴다', () => {
    const applied = db
      .prepare('SELECT name FROM _migrations ORDER BY id')
      .all()
      .map((r) => (r as { name: string }).name);
    expect(applied).toEqual(MIGRATION_FILES);
  });
});

describe('agents CHECK — D-11 waiting_reason', () => {
  const seedProject = () => {
    const id = crypto.randomUUID();
    db.prepare(
      'INSERT INTO projects (id, name, description, status, created_at, updated_at) VALUES (?,?,?,?,?,?)',
    ).run(id, `p-${id.slice(0, 8)}`, '', 'ready', now(), now());
    return id;
  };

  const insertAgent = (status: string, waitingReason: string | null) => {
    const pid = seedProject();
    db.prepare(
      `INSERT INTO agents (id, project_id, name, type, status, waiting_reason, skill, config,
         retry_count, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(crypto.randomUUID(), pid, 'a1', '', status, waitingReason, '', '{}', 0, now(), now());
  };

  it('status가 waiting이 아니면 waiting_reason은 NULL이어야 한다', () => {
    expect(() => insertAgent('running', 'ceo_approval')).toThrow();
  });

  it('waiting이면 사유를 가질 수 있다', () => {
    expect(() => insertAgent('waiting', 'ceo_approval')).not.toThrow();
  });

  it('정의되지 않은 사유는 거부한다', () => {
    expect(() => insertAgent('waiting', 'blocked_on_ceo')).toThrow();
  });
});

describe('conversations CHECK — D-27', () => {
  it('CH-MAIN은 전역 1개다', () => {
    const insertMain = () =>
      db
        .prepare(
          'INSERT INTO conversations (id, channel_type, entity_id, status, created_at) VALUES (?,?,?,?,?)',
        )
        .run(crypto.randomUUID(), 'main', null, 'active', now());
    insertMain();
    expect(() => insertMain()).toThrow();
  });

  it('main 채널은 entity_id가 NULL이어야 한다', () => {
    expect(() =>
      db
        .prepare(
          'INSERT INTO conversations (id, channel_type, entity_id, status, created_at) VALUES (?,?,?,?,?)',
        )
        .run(crypto.randomUUID(), 'main', 'agent-id', 'active', now()),
    ).toThrow();
  });

  it('agent 채널은 entity_id가 필수다', () => {
    expect(() =>
      db
        .prepare(
          'INSERT INTO conversations (id, channel_type, entity_id, status, created_at) VALUES (?,?,?,?,?)',
        )
        .run(crypto.randomUUID(), 'agent', null, 'active', now()),
    ).toThrow();
  });
});

describe('approvals CHECK 5건 — DES-003 §4-1', () => {
  it('(1) APV-GATE는 auto_advanced로 갈 수 없다', () => {
    expect(() =>
      insertApproval({
        approval_type: 'APV-GATE',
        level: 'high',
        status: 'auto_advanced',
        resolved_at: now(),
      }),
    ).toThrow();
  });

  it('(2) 높음 등급은 deadline_at을 가질 수 없다', () => {
    expect(() => insertApproval({ level: 'high', deadline_at: now() })).toThrow();
  });

  it('(3) 반려는 사유가 필수다', () => {
    expect(() =>
      insertApproval({ status: 'rejected', reason: null, resolved_at: now() }),
    ).toThrow();
    expect(() =>
      insertApproval({ status: 'rejected', reason: '근거 부족', resolved_at: now() }),
    ).not.toThrow();
  });

  it('(3) 조건부 승인도 사유가 필수다', () => {
    expect(() =>
      insertApproval({ status: 'conditional', reason: null, resolved_at: now() }),
    ).toThrow();
  });

  it('(4) APV-GATE는 등급 하향이 불가하다', () => {
    expect(() => insertApproval({ approval_type: 'APV-GATE', level: 'medium' })).toThrow();
  });

  it('(5) 처리된 건은 처리 시각이 필수다', () => {
    expect(() => insertApproval({ status: 'approved', resolved_at: null })).toThrow();
  });

  it("level에 'low'를 적재할 수 없다 — 자율 판단은 MSG-05로만 남는다", () => {
    expect(() => insertApproval({ level: 'low' })).toThrow();
  });

  it('R-04 시스템 마감은 제약을 만족한다', () => {
    expect(() =>
      insertApproval({
        status: 'rejected',
        resolution: 'system:agent_deleted',
        reason: '요청 Agent 삭제로 자동 마감',
        resolved_at: now(),
      }),
    ).not.toThrow();
  });
});

describe('stages·wip_waivers CHECK', () => {
  const seedPhase = () => {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO phases (id, number, name) VALUES (?,?,?)').run(id, 1, '기반 구축');
    return id;
  };

  it('Phase당 같은 skill은 1행뿐이다', () => {
    const pid = seedPhase();
    const ins = () =>
      db
        .prepare('INSERT INTO stages (id, phase_id, skill, status) VALUES (?,?,?,?)')
        .run(crypto.randomUUID(), pid, 'plan', 'pending');
    ins();
    expect(() => ins()).toThrow();
  });

  it('WIP 면제 사유는 공백일 수 없다', () => {
    const pid = seedPhase();
    expect(() =>
      db
        .prepare(
          'INSERT INTO wip_waivers (id, phase_id, rule, reason, created_at) VALUES (?,?,?,?,?)',
        )
        .run(crypto.randomUUID(), pid, 'WIP=1', '   ', now()),
    ).toThrow();
  });
});

describe('006_status_ext — entity_type 6종 확장', () => {
  it('신규 3종을 받아들인다', () => {
    for (const t of ['conversation', 'approval', 'stage']) {
      expect(() =>
        db
          .prepare(
            'INSERT INTO status_changes (entity_type, entity_id, from_status, to_status, changed_by, changed_at) VALUES (?,?,?,?,?,?)',
          )
          .run(t, crypto.randomUUID(), null, 'active', 'system', now()),
      ).not.toThrow();
    }
  });

  it('정의되지 않은 유형은 거부한다', () => {
    expect(() =>
      db
        .prepare(
          'INSERT INTO status_changes (entity_type, entity_id, from_status, to_status, changed_by, changed_at) VALUES (?,?,?,?,?,?)',
        )
        .run('artifact', crypto.randomUUID(), null, 'draft', 'system', now()),
    ).toThrow();
  });

  it('from_status는 NULL을 허용한다 — 최초 생성', () => {
    expect(() =>
      db
        .prepare(
          'INSERT INTO status_changes (entity_type, entity_id, from_status, to_status, changed_by, changed_at) VALUES (?,?,?,?,?,?)',
        )
        .run('project', crypto.randomUUID(), null, 'ready', 'system', now()),
    ).not.toThrow();
  });
});

describe('messages_fts — ADR-011', () => {
  const seedConversation = () => {
    const id = crypto.randomUUID();
    db.prepare(
      'INSERT INTO conversations (id, channel_type, entity_id, status, created_at) VALUES (?,?,?,?,?)',
    ).run(id, 'main', null, 'active', now());
    return id;
  };

  const insertMessage = (body: string, convId: string) =>
    db
      .prepare(
        'INSERT INTO messages (id, conversation_id, msg_type, sender_role, body, structured, created_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run(crypto.randomUUID(), convId, 'MSG-01', 'ceo', body, null, now());

  it('INSERT 트리거가 색인을 채운다', () => {
    const cid = seedConversation();
    insertMessage('대화 기능부터 진행해줘', cid);

    const hit = db.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH '대화'").all();
    expect(hit.length).toBe(1);
  });

  it('UPDATE 트리거가 색인을 갱신한다', () => {
    const cid = seedConversation();
    insertMessage('승인 게이트를 먼저 만들자', cid);
    db.prepare("UPDATE messages SET body = '배포부터 하자'").run();

    expect(
      db.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH '승인'").all(),
    ).toHaveLength(0);
    expect(
      db.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH '배포부터'").all(),
    ).toHaveLength(1);
  });

  it('DELETE 트리거가 색인을 지운다', () => {
    const cid = seedConversation();
    insertMessage('삭제될 메시지', cid);
    db.prepare('DELETE FROM messages').run();

    expect(
      db.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH '삭제될'").all(),
    ).toHaveLength(0);
  });

  it('⚠ 한국어 조사 한계를 실증한다 — 이월 B-1의 근거', () => {
    const cid = seedConversation();
    insertMessage('설계서를 개정했습니다', cid);

    // unicode61은 공백 기준으로 자르므로 '설계서를'이 한 토큰이다
    expect(
      db.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH '설계서를'").all(),
    ).toHaveLength(1);
    // 조사를 뗀 '설계서'로는 걸리지 않는다 → develop에서 trigram과 비교 후 확정
    expect(
      db.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH '설계서'").all(),
    ).toHaveLength(0);
  });
});
