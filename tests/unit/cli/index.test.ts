import { describe, expect, it } from 'vitest';
import { buildProgram, readVersion } from '../../../src/cli/index.js';

/**
 * Commander 진입점 — 골격 검증
 *
 * 정의 원본: DES-008 v3.1 §CLI Entry
 *
 * 이 모듈을 import해도 `main()`이 자동 실행되지 않아야 한다 (entry-point
 * 판별 가드) — 실행됐다면 vitest 자신의 argv를 commander가 해석하려다
 * 이 테스트 프로세스 자체가 죽었을 것이다. 이 파일이 끝까지 도는 것 자체가
 * 그 가드의 증거다.
 */

describe('buildProgram', () => {
  it('이름이 cm이다', () => {
    expect(buildProgram().name()).toBe('cm');
  });

  it('auth 명령 그룹이 등록되어 있다', () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('auth');
  });

  it('auth 하위에 login·logout·status가 있다', () => {
    const program = buildProgram();
    const auth = program.commands.find((c) => c.name() === 'auth');
    expect(auth).toBeDefined();
    const subNames = auth?.commands.map((c) => c.name());
    expect(subNames).toEqual(expect.arrayContaining(['login', 'logout', 'status']));
  });

  it('--help를 처리하고 exit 0으로 끝난다', async () => {
    const program = buildProgram();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });

    let caught: unknown;
    try {
      await program.parseAsync(['--help'], { from: 'user' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toMatchObject({ code: 'commander.helpDisplayed', exitCode: 0 });
  });
});

describe('readVersion', () => {
  it('package.json의 semver 형식 버전을 돌려준다', () => {
    expect(readVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
