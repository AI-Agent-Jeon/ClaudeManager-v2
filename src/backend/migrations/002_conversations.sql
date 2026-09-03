-- 002_conversations — conversations → messages → messages_fts + 트리거 3종
-- 정의 원본: DES-003 v2.1 §3 (D-09 대화 · D-27 삭제 시 보존)

CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  channel_type    TEXT NOT NULL CHECK (channel_type IN ('main','agent')),
  -- ⚠ agents.id를 가리키지만 FK를 걸지 않는다 (D-27).
  -- FK + CASCADE를 걸면 Agent 삭제 시 대화가 함께 사라진다. Agent가 사라져도
  -- 대표가 무엇을 지시하고 무엇을 승인했는지는 남아야 한다.
  entity_id       TEXT,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','readonly','archived')),
  -- 삭제된 Agent의 이름을 화면에 표시하기 위한 의도적 비정규화
  entity_snapshot TEXT,
  created_at      TEXT NOT NULL,
  archived_at     TEXT,

  CHECK ((channel_type = 'main'  AND entity_id IS NULL)
      OR (channel_type = 'agent' AND entity_id IS NOT NULL))
);

-- CH-MAIN은 전역 1개다. 부트스트랩이 매 기동마다 멱등 시드할 수 있는 근거다 (R-01)
CREATE UNIQUE INDEX IF NOT EXISTS conversations_main_unique
  ON conversations(channel_type) WHERE channel_type = 'main';

CREATE INDEX IF NOT EXISTS conversations_status_idx ON conversations(status, archived_at);
CREATE INDEX IF NOT EXISTS conversations_entity_idx ON conversations(entity_id);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  msg_type        TEXT NOT NULL
                  CHECK (msg_type IN ('MSG-01','MSG-02','MSG-03','MSG-04','MSG-05','MSG-06')),
  sender_role     TEXT NOT NULL CHECK (sender_role IN ('ceo','main','agent','system')),
  body            TEXT NOT NULL,
  -- MSG-03 4단 보고를 파싱해 저장한다 (summary/work_done/artifacts/open_issues)
  structured      TEXT,
  created_at      TEXT NOT NULL
);

-- CASCADE는 유지한다. conversations 행이 실제로 삭제되는 경로가 없으므로
-- 메시지는 어떤 경우에도 사라지지 않는다.
CREATE INDEX IF NOT EXISTS messages_conv_idx ON messages(conversation_id, created_at);

-- 전문 검색 (ADR-011). external content 방식이라 본문을 중복 저장하지 않는다.
-- messages는 암묵 rowid를 쓰므로 WITHOUT ROWID로 선언하지 않는다.
--
-- ⚠ 토크나이저 미확정 (DES-003 §10 · 이월 B-1): unicode61은 한국어 조사 때문에
-- "설계서를"이 "설계서" 검색에 걸리지 않는다. develop에서 trigram과 비교 후 확정한다.
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  body,
  content       = 'messages',
  content_rowid = 'rowid',
  tokenize      = 'unicode61'
);

CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
  INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;
