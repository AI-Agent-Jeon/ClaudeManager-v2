-- 001_initial — projects → agents → tasks → status_changes
-- 정의 원본: DES-003 v2.1 §2 ERD · §5 인덱스 전략 · §6 외래 키 정책
--
-- CHECK 제약은 마이그레이션에 포함한다. 애플리케이션 검증에만 의존하지 않는다
-- (DES-003 §9-3 원칙). 애플리케이션 버그가 있어도 데이터가 규칙을 깨지 못한다.

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'ready'
              CHECK (status IN ('ready','running','waiting','paused',
                                'pending_completion','completed','failed','cancelled')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS projects_name_unique ON projects(name);

CREATE TABLE IF NOT EXISTS agents (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'created'
                 CHECK (status IN ('created','running','waiting','paused',
                                   'completed','failed','cancelled')),
  -- D-11: 신규 상태를 만들지 않고 사유 필드로 세분화했다 (DES-003 §3-4)
  waiting_reason TEXT
                 CHECK (waiting_reason IN ('ceo_approval','ceo_decision','external_input')),
  skill          TEXT NOT NULL DEFAULT '',
  config         TEXT NOT NULL DEFAULT '{}',
  retry_count    INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,

  -- status가 waiting이 아니면 waiting_reason은 반드시 NULL이다
  CHECK (status = 'waiting' OR waiting_reason IS NULL)
);

CREATE INDEX IF NOT EXISTS agents_project_id_idx ON agents(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS agents_project_name_unique ON agents(project_id, name);

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'ready'
              CHECK (status IN ('ready','in_progress','in_review','paused',
                                'completed','failed','cancelled','skipped')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tasks_agent_id_idx ON tasks(agent_id);

-- entity_type은 006에서 6종으로 확장된다. 여기서는 v1 정의(3종)를 그대로 둔다 —
-- 전진 전용 마이그레이션은 최적화된 최종 상태가 아니라 변경 이력이다.
CREATE TABLE IF NOT EXISTS status_changes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('project','agent','task')),
  entity_id   TEXT NOT NULL,
  -- 최초 생성 시 NULL이다. '' 가 아니다 (DES-003 v2.1 §3-5)
  from_status TEXT,
  to_status   TEXT NOT NULL,
  changed_by  TEXT NOT NULL,
  changed_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sc_entity_idx     ON status_changes(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS sc_changed_at_idx ON status_changes(changed_at);
