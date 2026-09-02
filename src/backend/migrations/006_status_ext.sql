-- 006_status_ext — status_changes.entity_type CHECK 3종 → 6종
-- 정의 원본: DES-003 v2.1 §3-5
--
-- 왜 필요한가: v2가 상태 머신을 3개 → 6개로 늘리면서 그 전이를 기록할
-- entity_type을 넓히지 않았다. DES-007 §9("모든 상태 전이는 status_changes
-- 기록과 함께 발행한다")와 DES-009 v3.1(EntityType 6종)을 둘 다 만족할 수
-- 없는 상태였다.
--
-- SQLite는 ALTER TABLE ... DROP CONSTRAINT를 지원하지 않는다. CHECK를 바꾸려면
-- 새 테이블 생성 → INSERT INTO ... SELECT → 원본 DROP → RENAME 순서로 처리한다.
-- status_changes는 Phase 1에 실데이터가 없어 비용이 없다.

CREATE TABLE IF NOT EXISTS status_changes_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL
              CHECK (entity_type IN ('project','agent','task',
                                     'conversation','approval','stage')),
  entity_id   TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  changed_by  TEXT NOT NULL,
  changed_at  TEXT NOT NULL
);

INSERT INTO status_changes_new (id, entity_type, entity_id, from_status, to_status, changed_by, changed_at)
  SELECT id, entity_type, entity_id, from_status, to_status, changed_by, changed_at
  FROM status_changes;

DROP TABLE status_changes;

ALTER TABLE status_changes_new RENAME TO status_changes;

-- 인덱스는 DROP TABLE과 함께 사라지므로 다시 만든다
CREATE INDEX IF NOT EXISTS sc_entity_idx     ON status_changes(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS sc_changed_at_idx ON status_changes(changed_at);
