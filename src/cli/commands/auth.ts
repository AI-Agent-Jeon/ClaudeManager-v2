import { createInterface } from 'node:readline';
import { Command } from 'commander';
import { ErrorCode } from '../../shared/constants.js';
import type { LoginResponse } from '../../shared/types.js';
import { ApiClient, ApiRequestError, ServerUnreachableError } from '../api-client.js';
import { clearAuth, getConfigPath, loadAuth, saveAuth } from '../config.js';

/**
 * `cm auth login` · `cm auth logout` · `cm auth status`
 *
 * 정의 원본: DES-006 v3.2 §2 SCR-A01~A03 · §4-1 EVT-A01~A03 · §5 PRM-01
 *
 * 판정 로직(run*)과 출력(present*)을 분리했다 — run* 함수는 콘솔에 아무것도
 * 쓰지 않고 결과값(판별 유니온)만 돌려준다. **토큰 원문은 이 판별 유니온에
 * 담기지 않는다** — 저장 경로·만료일시만 담아, 구조적으로 화면에 찍힐 수 없게
 * 한다 (요구사항: 토큰이 로그·에러 메시지에 노출되지 않을 것).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────
// 판정 로직
// ─────────────────────────────────────────────

/** ApiClient의 최소 인터페이스 — 테스트가 undici 없이 페이크를 주입할 수 있다 */
export interface AuthApiClient {
  baseUrl: string;
  post<T>(path: string, body?: unknown): Promise<T>;
  get<T>(path: string): Promise<T>;
}

export type LoginResult =
  | { ok: true; configPath: string; expiresAt: string; serverUrl: string }
  | { ok: false; reason: 'invalid_secret' }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'not_interactive' };

export interface RunLoginOpts {
  client: AuthApiClient;
  promptSecret: (question: string) => Promise<string>;
  homeDir?: string;
}

export async function runLogin(opts: RunLoginOpts): Promise<LoginResult> {
  let secret: string;
  try {
    secret = await opts.promptSecret(`서버 URL: ${opts.client.baseUrl}\n시크릿: `);
  } catch (err) {
    // PRM-01 "Ctrl+C→중단, 토큰 미변경" — 비대화형 환경(파이프·CI)도 같은 원칙으로
    // 다룬다. `defaultPromptSecret`가 둘을 다른 메시지로 구분해 던진다(§5 공통
    // 규칙 4: PRM-01은 `--force`로 생략 불가하므로 즉시 중단해야 한다).
    if (err instanceof Error && err.message === 'NOT_TTY') {
      return { ok: false, reason: 'not_interactive' };
    }
    return { ok: false, reason: 'cancelled' };
  }

  let res: { data: LoginResponse };
  try {
    res = await opts.client.post<{ data: LoginResponse }>('/auth/login', { secret });
  } catch (err) {
    if (err instanceof ServerUnreachableError) {
      return { ok: false, reason: 'server_unreachable', serverUrl: opts.client.baseUrl };
    }
    if (err instanceof ApiRequestError && err.code === ErrorCode.AUTH_INVALID_SECRET) {
      return { ok: false, reason: 'invalid_secret' };
    }
    throw err;
  }

  saveAuth({ token: res.data.token, expiresAt: res.data.expiresAt }, opts.homeDir);
  return {
    ok: true,
    configPath: getConfigPath(opts.homeDir),
    expiresAt: res.data.expiresAt,
    serverUrl: opts.client.baseUrl,
  };
}

export interface LogoutResult {
  configPath: string;
  hadToken: boolean;
}

export function runLogout(opts: { homeDir?: string } = {}): LogoutResult {
  const hadToken = loadAuth(opts.homeDir) !== null;
  clearAuth(opts.homeDir);
  return { configPath: getConfigPath(opts.homeDir), hadToken };
}

export type StatusResult =
  | { ok: false; reason: 'not_authenticated' }
  | { ok: false; reason: 'expired'; expiresAt: string; elapsedDays: number }
  | { ok: true; connected: true; serverUrl: string; expiresAt: string; remainingDays: number }
  | {
      ok: true;
      connected: false;
      serverUrl: string;
      expiresAt: string;
      remainingDays: number;
      warning: string;
    };

export interface RunStatusOpts {
  client: AuthApiClient;
  homeDir?: string;
  now?: () => Date;
}

/**
 * 서버 연결 여부(`connected`)와 별개로 exit code는 **로컬 토큰 유효성**만
 * 기준으로 삼는다(등급 낮음 — 자율 판단). 서버가 잠깐 unreachable이어도
 * 로컬에 유효한 토큰이 있다면 "미인증"으로 취급하지 않는다 — EVT-A03-4가
 * `⚠` 경고블록이지 `✗` 실패가 아닌 것과 같은 판단이다.
 */
export async function runStatus(opts: RunStatusOpts): Promise<StatusResult> {
  const now = (opts.now ?? (() => new Date()))();
  const auth = loadAuth(opts.homeDir);

  if (!auth) {
    return { ok: false, reason: 'not_authenticated' };
  }

  const expiresAtMs = new Date(auth.expiresAt).getTime();
  if (expiresAtMs <= now.getTime()) {
    return {
      ok: false,
      reason: 'expired',
      expiresAt: auth.expiresAt,
      elapsedDays: Math.floor((now.getTime() - expiresAtMs) / MS_PER_DAY),
    };
  }
  const remainingDays = Math.ceil((expiresAtMs - now.getTime()) / MS_PER_DAY);

  try {
    await opts.client.get('/health');
    return {
      ok: true,
      connected: true,
      serverUrl: opts.client.baseUrl,
      expiresAt: auth.expiresAt,
      remainingDays,
    };
  } catch (err) {
    if (err instanceof ServerUnreachableError) {
      return {
        ok: true,
        connected: false,
        serverUrl: opts.client.baseUrl,
        expiresAt: auth.expiresAt,
        remainingDays,
        warning: '서버에 연결할 수 없어 토큰 유효성을 서버에서 확인하지 못했습니다',
      };
    }
    throw err;
  }
}

// ─────────────────────────────────────────────
// 마스킹 프롬프트 (PRM-01) — 기본 구현
// ─────────────────────────────────────────────

/**
 * `readline`은 마스킹 입력을 기본 제공하지 않는다. 별도 라이브러리(inquirer 등)를
 * 추가하지 않기 위해 `_writeToOutput`을 재정의해 입력 문자를 숨기는 관용적
 * 방법을 쓴다. 비대화형(파이프·CI) 환경에서는 마스킹이 의미가 없고 사용자가
 * 개입할 수도 없으므로 즉시 중단한다 — PRM-01은 `--force`로 생략 불가하다
 * (DES-006 §5 공통 규칙 3).
 *
 * SEC-04 — `createInterface`의 `terminal` 기본값은 `output.isTTY`다. **stdout만**
 * 리다이렉트해도(`cm auth login > login.log`) `terminal:false`가 되어
 * `_writeToOutput` 재정의가 아예 호출되지 않고, tty 드라이버의 기본 에코가
 * 살아나 입력한 시크릿이 터미널에 평문으로 표시된다. 가드를
 * `stdin.isTTY && stdout.isTTY` 둘 다로 강화하고, `terminal: true`를 명시해
 * 이중으로 막는다 — 마스킹은 stdin·stdout 둘 다 실제 터미널일 때만 의미가
 * 있다.
 */
export function defaultPromptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.reject(new Error('NOT_TTY'));
  }

  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let promptWritten = false;
    // biome-ignore lint/suspicious/noExplicitAny: readline 내부 비공개 API — 마스킹 목적
    (rl as any)._writeToOutput = (str: string) => {
      // 프롬프트 문구 자체와 개행만 그대로 보여주고, 입력 문자는 감춘다
      if (!promptWritten || str === '\n' || str === '\r\n') {
        process.stdout.write(str);
      }
      if (str.includes(question)) promptWritten = true;
    };

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
    rl.on('SIGINT', () => {
      rl.close();
      reject(new Error('CANCELLED'));
    });
  });
}

// ─────────────────────────────────────────────
// Commander 연결
// ─────────────────────────────────────────────

/**
 * 테스트가 이 파일과 **동일한 commander 설치본**으로 `Command`를 만들 수 있게
 * 하는 헬퍼다. 저장소 루트 `node_modules/commander`는 다른 워크스페이스
 * 도구(tsup → sucrase)가 요구하는 구버전(^4)이 호이스팅돼 있고, `src/cli`는
 * `src/cli/node_modules/commander`에 v14가 중첩 설치돼 있다. 테스트 파일이
 * 저장소 루트에 위치해 `commander`를 직접 import하면 그 구버전이 잡혀
 * `registerAuthCommand`가 기대하는 v14 `Command`와 타입·동작이 어긋난다.
 * 이 함수 안의 `import`는 **이 파일의 위치** 기준으로 해석되므로, 호출자가
 * 어디 있든 항상 v14가 잡힌다.
 */
export function createProgram(): Command {
  return new Command();
}

export interface AuthCommandDeps {
  createClient: () => AuthApiClient;
  promptSecret: (question: string) => Promise<string>;
  homeDir?: string;
  now?: () => Date;
  log: (msg: string) => void;
  errorLog: (msg: string) => void;
  setExitCode: (code: number) => void;
}

function defaultDeps(): AuthCommandDeps {
  return {
    createClient: () => new ApiClient(),
    promptSecret: defaultPromptSecret,
    log: (msg) => console.log(msg),
    errorLog: (msg) => console.error(msg),
    setExitCode: (code) => {
      process.exitCode = code;
    },
  };
}

export function registerAuthCommand(
  program: Command,
  overrides: Partial<AuthCommandDeps> = {},
): void {
  const deps: AuthCommandDeps = { ...defaultDeps(), ...overrides };
  const auth = program.command('auth').description('인증 관리');

  auth
    .command('login')
    .description('로그인하고 JWT를 발급받아 저장한다 (SCR-A01)')
    .action(async () => {
      const result = await runLogin({
        client: deps.createClient(),
        promptSecret: deps.promptSecret,
        homeDir: deps.homeDir,
      });
      presentLogin(result, deps);
    });

  auth
    .command('logout')
    .description('저장된 토큰을 삭제한다 (SCR-A02)')
    .action(() => {
      const result = runLogout({ homeDir: deps.homeDir });
      deps.log(`✓ 로그아웃 되었습니다\n\n  토큰 삭제 경로: ${result.configPath}`);
      deps.setExitCode(0);
    });

  auth
    .command('status')
    .description('인증 상태를 확인한다 (SCR-A03)')
    .action(async () => {
      const result = await runStatus({
        client: deps.createClient(),
        homeDir: deps.homeDir,
        now: deps.now,
      });
      presentStatus(result, deps);
    });
}

function presentLogin(result: LoginResult, deps: AuthCommandDeps): void {
  if (result.ok) {
    deps.log(
      `✓ 인증 성공\n\n  토큰 저장 경로: ${result.configPath}\n  만료일시: ${result.expiresAt}`,
    );
    deps.setExitCode(0);
    return;
  }

  switch (result.reason) {
    case 'invalid_secret':
      deps.errorLog('✗ 시크릿이 올바르지 않습니다');
      break;
    case 'server_unreachable':
      deps.errorLog(`✗ 서버에 연결할 수 없습니다 (${result.serverUrl})\n  npm run server:start`);
      break;
    case 'cancelled':
      deps.errorLog('✗ 로그인이 취소되었습니다');
      break;
    case 'not_interactive':
      deps.errorLog(
        '✗ 대화형 터미널이 아닙니다\n  cm auth login은 시크릿을 직접 입력받아야 하므로 터미널에서 실행하세요',
      );
      break;
  }
  deps.setExitCode(1);
}

function presentStatus(result: StatusResult, deps: AuthCommandDeps): void {
  if (!result.ok) {
    if (result.reason === 'not_authenticated') {
      deps.errorLog('✗ 인증되지 않았습니다\n  cm auth login');
    } else {
      deps.errorLog(
        `✗ 토큰이 만료되었습니다\n  만료일시: ${result.expiresAt} (${result.elapsedDays}일 경과)\n  cm auth login`,
      );
    }
    deps.setExitCode(1);
    return;
  }

  if (result.connected) {
    deps.log(
      `✓ 인증됨\n\n  서버 URL: ${result.serverUrl} (connected)\n  토큰: 유효\n  만료일시: ${result.expiresAt} (${result.remainingDays}일 남음)`,
    );
  } else {
    deps.log(
      `⚠ 토큰 존재 (유효성 확인 불가)\n\n  ${result.warning}\n  서버 URL: ${result.serverUrl}\n  만료일시: ${result.expiresAt} (${result.remainingDays}일 남음)`,
    );
  }
  deps.setExitCode(0);
}
