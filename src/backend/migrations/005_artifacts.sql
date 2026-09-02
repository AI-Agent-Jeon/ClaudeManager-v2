-- 005_artifacts — artifacts → wip_waivers
-- 정의 원본: DES-003 v2.1 §4-4 · §4-5 (FR-031 동기화 추적 · FR-029 WIP)

-- ⚠ 동기화 상태(sync_status)를 저장하지 않는다.
-- notion_url·git_path 유무에서 파생한다 (3NF). 중복 저장하면 실제 상태와 어긋난다.
--   있음/있음 → synced      있음/없음 → notion_only (Git 동기화 누락)
--   없음/있음 → git_only    없음/없음 → missing
-- notion_only와 missing의 구분이 FR-031의 존재 이유다 —
-- 2026-09-01 "analyze 건너뜀" 오진단이 둘을 혼동한 사고였다.
CREATE TABLE IF NOT EXISTS artifacts (
  id         TEXT PRIMARY KEY,
  stage_id   TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft'
             CHECK (status IN ('draft','review','approved')),
  notion_url TEXT,
  git_path   TEXT,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS artifacts_code_unique ON artifacts(code);
CREATE INDEX IF NOT EXISTS artifacts_stage_idx ON artifacts(stage_id);

CREATE TABLE IF NOT EXISTS wip_waivers (
  id         TEXT PRIMARY KEY,
  phase_id   TEXT NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
  rule       TEXT NOT NULL,
  -- 사유는 필수다. 빈 문자열도 허용하지 않는다 —
  -- "무시했다"는 기록만 남고 "왜"가 없으면 감사에 쓸모가 없다.
  reason     TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS wip_waivers_phase_idx ON wip_waivers(phase_id);
