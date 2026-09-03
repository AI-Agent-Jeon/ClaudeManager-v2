-- 003_phases — phases → stages
-- 정의 원본: DES-003 v2.1 §4-2 · §4-3 (D-16 승인 게이트 · FR-029 진행 추적)

CREATE TABLE IF NOT EXISTS phases (
  id            TEXT PRIMARY KEY,
  number        INTEGER NOT NULL,
  name          TEXT NOT NULL,
  started_at    TEXT,
  completed_at  TEXT,
  current_stage TEXT
                CHECK (current_stage IS NULL OR current_stage IN
                       ('plan','analyze','design','develop','test','deploy','operate'))
);

-- 부트스트랩이 Phase 1을 멱등 시드할 수 있는 근거다 (R-01)
CREATE UNIQUE INDEX IF NOT EXISTS phases_number_unique ON phases(number);

-- ⚠ stages.gate_approval_id를 두지 않는다 (DES-003 §4-3).
-- DES-014 §7-1 초안은 stages → approvals와 approvals → stages를 양쪽에 두어
-- 순환 FK를 만들었다. approvals.stage_id 한 방향만 남기고, 게이트 승인은
-- stage_id + approval_type='APV-GATE'로 조회한다.
CREATE TABLE IF NOT EXISTS stages (
  id           TEXT PRIMARY KEY,
  phase_id     TEXT NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
  skill        TEXT NOT NULL
               CHECK (skill IN ('plan','analyze','design','develop','test','deploy','operate')),
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','in_progress','completed')),
  started_at   TEXT,
  completed_at TEXT
);

-- Phase당 정확히 7행이어야 한다. 개별 생성을 허용하지 않고
-- POST /api/phases가 Phase + 7단계를 한 트랜잭션으로 만드는 근거다 (R-01).
CREATE UNIQUE INDEX IF NOT EXISTS stages_phase_skill_unique ON stages(phase_id, skill);
