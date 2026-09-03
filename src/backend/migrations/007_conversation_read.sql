-- 007_conversation_read — conversations에 읽음 포인터 추가
-- 근거: DEV-D-05 (대표 승인 2026-09-02)
--
-- 왜 필요한가: `Conversation.unreadCount`를 설계서 4곳(DES-002 §4, DES-004
-- 공통 타입, DES-006 SCR-CH11, DES-013 §4-5)이 요구하는데 **읽음 상태를
-- 저장하는 자리가 없었다.** "파생값"이라 적혀 있었으나 파생할 원본이 없었다.
--
-- 왜 채널당 컬럼 하나인가: 사용자가 대표 한 명이다. 메시지마다 읽음 플래그를
-- 두는 것(C안)은 1인 시스템에 과잉이고, 채널당 포인터 하나면 충분하다.
--   unreadCount = COUNT(messages WHERE conversation_id = ? AND created_at > last_read_at)
--
-- NULL은 "한 번도 열지 않음"을 뜻한다. 이때는 전체 메시지 수가 미읽음이다.

ALTER TABLE conversations ADD COLUMN last_read_at TEXT;

-- 미읽음 집계는 채널별 + 시각 경계 조회다. messages_conv_idx가
-- (conversation_id, created_at)이라 그대로 쓰인다 — 별도 인덱스가 필요 없다.
