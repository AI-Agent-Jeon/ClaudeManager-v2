import { describe, expect, it } from 'vitest';
import {
  errorBlock,
  formatFields,
  formatTimestamp,
  ID_SHORT_LEN,
  NAME_MAX_LEN,
  paginationFooter,
  renderTable,
  shortId,
  successBlock,
  truncateName,
} from '../../../src/cli/output.js';

/**
 * CLI 출력 포맷 헬퍼 — 수용 기준
 *
 * 정의 원본: DES-006 v3.2 §8(공통 동작 규칙 — 출력 형식·ID 축약 규칙·출력
 * 컬럼 규칙)
 *
 * project·agent·task 목록 3종이 "같은 규칙"을 쓰는지(개발 지시 §2)는 이
 * 파일이 공용 헬퍼 자체를 검증하는 것으로 보장한다 — 3개 명령 파일이 전부
 * 이 함수들만 거쳐 표를 만들기 때문이다.
 */

describe('shortId', () => {
  it('ID를 앞 8자로 자른다 (§8 ID 축약 규칙 — 목록)', () => {
    expect(shortId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe('a1b2c3d4');
  });
});

describe('truncateName', () => {
  it('20자 이하면 그대로 둔다', () => {
    expect(truncateName('짧은 이름')).toBe('짧은 이름');
  });

  it('20자 초과면 17자 + ...로 자른다 (§8 출력 컬럼 규칙)', () => {
    const long = 'a'.repeat(30);
    const result = truncateName(long);
    expect(result).toHaveLength(NAME_MAX_LEN);
    expect(result.endsWith('...')).toBe(true);
  });
});

describe('formatTimestamp', () => {
  it('ISO 8601을 YYYY-MM-DD HH:mm:ss로 바꾼다 (19자 고정)', () => {
    const iso = new Date(2026, 8, 2, 9, 5, 3).toISOString();
    const result = formatTimestamp(iso);
    expect(result).toHaveLength(19);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe('renderTable', () => {
  it('헤더·구분선·본문을 정렬해 만든다', () => {
    const table = renderTable(
      ['ID', '이름', '상태'],
      [
        ['a1b2c3d4', '프로젝트A', 'running'],
        ['b2c3d4e5', 'B', 'ready'],
      ],
    );
    const lines = table.split('\n');
    expect(lines).toHaveLength(4); // header + separator + 2 rows
    expect(lines[0]).toContain('ID');
    expect(lines[1]).toMatch(/^-+/);
  });

  it('minWidths로 긴 값이 잘리지 않게 최소폭만 보장한다 (Status "10자, 잘림 없음")', () => {
    const table = renderTable(
      ['상태'],
      [['pending_completion']], // 18자 — "10자" 최소폭보다 길다
      [10],
    );
    expect(table).toContain('pending_completion');
  });
});

describe('formatFields', () => {
  it('필드명: 값 형태로 2칸 들여쓴다 (§8 출력 형식)', () => {
    const result = formatFields([
      ['ID', 'abc'],
      ['이름', '프로젝트A'],
    ]);
    expect(result).toBe('  ID: abc\n  이름: 프로젝트A');
  });
});

describe('paginationFooter', () => {
  it('페이지 n/m · 총 건수를 만든다', () => {
    const footer = paginationFooter({ page: 1, pageSize: 20, total: 45, totalPages: 3 });
    expect(footer).toBe('페이지 1/3 · 총 45건');
  });

  it('필터가 있으면 "filtered by: {값}" 행을 이어붙인다 (EVT-P02-2)', () => {
    const footer = paginationFooter({ page: 1, pageSize: 20, total: 3, totalPages: 1 }, [
      'running',
    ]);
    expect(footer).toBe('페이지 1/1 · 총 3건\nfiltered by: running');
  });
});

describe('successBlock · errorBlock', () => {
  it('성공은 ✓로 시작한다', () => {
    expect(successBlock('완료', '  본문')).toBe('✓ 완료\n\n  본문');
  });

  it('본문 없는 성공도 허용한다', () => {
    expect(successBlock('완료')).toBe('✓ 완료');
  });

  it('실패는 ✗로 시작하고 힌트를 들여쓴다', () => {
    expect(errorBlock('찾을 수 없습니다', 'cm project list')).toBe(
      '✗ 찾을 수 없습니다\n  cm project list',
    );
  });
});

describe('ID_SHORT_LEN', () => {
  it('8이다', () => {
    expect(ID_SHORT_LEN).toBe(8);
  });
});
