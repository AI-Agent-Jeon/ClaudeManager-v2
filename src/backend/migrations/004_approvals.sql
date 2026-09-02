-- 004_approvals — approvals (002·003 이후여야 한다)
-- 정의 원본: DES-003 v2.1 §4-1 (D-18 decision_requests 통합)
--
-- 순서 의존: approvals.message_id가 messages(002)를, approvals.stage_id가
-- stages(003)를 참조한다. 004를 앞당기면 FK가 성립하지 않는다.

CREATE TABLE IF NOT EXISTS approvals (
  id            TEXT PRIMARY KEY,
  -- 이 승인을 발행한 MSG-04. 메시지가 사라져도 승인 이력은 남는다
  message_id    TEXT REFERENCES messages(id) ON DELETE SET NULL,
  -- APV-GATE일 때만 채운다. 단계 재생성 시 승인 이력 보존
  stage_id      TEXT REFERENCES stages(id) ON DELETE SET NULL,
  approval_type TEXT NOT NULL
                CHECK (approval_type IN ('APV-GATE','APV-ARCH','APV-DEPLOY',
                                         'APV-EXT','APV-CHOICE','APV-RETRY')),
  -- 'low'는 적재하지 않는다. 자율 판단은 MSG-05로 대화에만 남는다 (R-06)
  level         TEXT NOT NULL CHECK (level IN ('high','medium')),
  subject       TEXT NOT NULL,
  options       TEXT,
  artifacts     TEXT,
  rationale     TEXT,
  impact        TEXT,
  requested_by  TEXT NOT NULL,
  deadline_at   TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','conditional','auto_advanced')),
  -- 'system:' 접두어는 시스템 마감을 뜻한다 — system:agent_deleted (R-04).
  -- 대표 반려와 구분하는 근거다.
  resolution    TEXT,
  reason        TEXT,
  resolved_at   TEXT,
  created_at    TEXT NOT NULL,

  -- 비즈니스 규칙을 DB 제약으로 강제한다 (DES-003 §4-1)

  -- (1) APV-GATE는 타임아웃 자동 진행 불가. 게이트가 시간 경과로 통과되면
  --     승인 게이트의 의미가 없다
  CHECK (NOT (approval_type = 'APV-GATE' AND status = 'auto_advanced')),

  -- (2) 높음 등급은 타임아웃 없음 — 무기한 대기
  CHECK (NOT (level = 'high' AND deadline_at IS NOT NULL)),

  -- (3) 반려·조건부 승인은 사유 필수 (승인 안전장치 S-2)
  CHECK (status NOT IN ('rejected','conditional') OR reason IS NOT NULL),

  -- (4) APV-GATE는 등급 높음 고정 — 하향 불가
  CHECK (NOT (approval_type = 'APV-GATE' AND level <> 'high')),

  -- (5) 처리된 건은 처리 시각 필수
  CHECK (status = 'pending' OR resolved_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS approvals_status_idx ON approvals(status, level);
CREATE INDEX IF NOT EXISTS approvals_stage_idx  ON approvals(stage_id, approval_type);

-- 타임아웃 스케줄러는 pending만 훑는다. 처리된 건을 색인할 이유가 없다.
CREATE INDEX IF NOT EXISTS approvals_deadline_idx
  ON approvals(deadline_at) WHERE status = 'pending';
