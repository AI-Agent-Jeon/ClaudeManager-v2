import { describe, expect, it } from 'vitest';
import { AppError, toErrorResponse } from '../../../../src/backend/utils/errors.js';
import { ErrorCode } from '../../../../src/shared/constants.js';

/**
 * 정의 원본: DES-009 v3.1 §HTTP 에러 응답 형식
 *
 * 에러 응답은 4필드 고정이다. 형태가 흔들리면 CLI의 에러 처리가 갈린다.
 */
describe('AppError', () => {
  it('상태 코드·코드·메시지를 담는다', () => {
    const e = new AppError(404, ErrorCode.PROJECT_NOT_FOUND, '프로젝트를 찾을 수 없습니다');
    expect(e.statusCode).toBe(404);
    expect(e.code).toBe('PROJECT_NOT_FOUND');
    expect(e.message).toBe('프로젝트를 찾을 수 없습니다');
    expect(e).toBeInstanceOf(Error);
  });

  it('부가 정보를 실을 수 있다 — 허용 전이 목록 등', () => {
    const e = new AppError(422, ErrorCode.INVALID_TRANSITION, '불가능한 전이', {
      allowedTransitions: ['running', 'cancelled'],
    });
    expect(e.details).toEqual({ allowedTransitions: ['running', 'cancelled'] });
  });
});

describe('toErrorResponse — 4필드 고정', () => {
  it('AppError를 응답 형식으로 바꾼다', () => {
    const r = toErrorResponse(new AppError(409, ErrorCode.PROJECT_NAME_CONFLICT, '이름 중복'));
    expect(r).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: '이름 중복',
      code: 'PROJECT_NAME_CONFLICT',
    });
  });

  it('알 수 없는 에러는 500 INTERNAL_ERROR로 감싼다', () => {
    const r = toErrorResponse(new Error('디스크가 터졌다'));
    expect(r.statusCode).toBe(500);
    expect(r.code).toBe('INTERNAL_ERROR');
  });

  it('내부 오류의 원문 메시지를 노출하지 않는다', () => {
    // PR 자체 검토 §보안: 에러 메시지에 내부 정보가 노출되지 않아야 한다
    const r = toErrorResponse(new Error('SQLITE_CANTOPEN: /Users/foo/secret.db'));
    expect(r.message).not.toContain('secret.db');
  });

  it('details가 없으면 4필드 그대로다', () => {
    const r = toErrorResponse(new AppError(404, ErrorCode.PROJECT_NOT_FOUND, '없음'));
    expect(Object.keys(r).sort()).toEqual(['code', 'error', 'message', 'statusCode']);
  });

  it('details가 있으면 5번째 필드로 붙는다 (2026-09-02 대표 결정)', () => {
    // DES-006 SCR-P04가 불허 전이 시 CLI에 "허용 목록 출력"을 요구한다.
    // 목록을 한국어 메시지에서 파싱하게 두면 문구를 다듬는 순간 깨진다.
    const r = toErrorResponse(
      new AppError(422, ErrorCode.INVALID_TRANSITION, '불가능한 전이', {
        allowedTransitions: ['running', 'cancelled'],
      }),
    );

    expect(Object.keys(r).sort()).toEqual(['code', 'details', 'error', 'message', 'statusCode']);
    expect(r.details).toEqual({ allowedTransitions: ['running', 'cancelled'] });
  });

  it('메시지에 허용 목록을 넣지 않는다 — details가 원본이다', () => {
    const r = toErrorResponse(
      new AppError(422, ErrorCode.INVALID_TRANSITION, '허용되지 않는 상태 전이입니다: ready → x', {
        allowedTransitions: ['running'],
      }),
    );
    expect(r.message).not.toContain('running');
  });

  it('상태 코드별 error 문구를 매핑한다', () => {
    expect(toErrorResponse(new AppError(400, ErrorCode.VALIDATION_ERROR, 'x')).error).toBe(
      'Bad Request',
    );
    expect(toErrorResponse(new AppError(401, ErrorCode.UNAUTHORIZED, 'x')).error).toBe(
      'Unauthorized',
    );
    expect(toErrorResponse(new AppError(403, ErrorCode.FORBIDDEN, 'x')).error).toBe('Forbidden');
    expect(toErrorResponse(new AppError(404, ErrorCode.NOT_FOUND, 'x')).error).toBe('Not Found');
    expect(toErrorResponse(new AppError(422, ErrorCode.INVALID_TRANSITION, 'x')).error).toBe(
      'Unprocessable Entity',
    );
  });
});
