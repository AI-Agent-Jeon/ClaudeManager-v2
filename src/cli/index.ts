import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerAgentCommand } from './commands/agent.js';
import { registerApprovalCommand } from './commands/approval.js';
import { registerAuthCommand } from './commands/auth.js';
import { registerChatCommand } from './commands/chat.js';
import { registerProjectCommand } from './commands/project.js';
import { registerStatusChangeCommand } from './commands/status-changes.js';
import { registerTaskCommand } from './commands/task.js';

/**
 * Commander 진입점
 *
 * 정의 원본: DES-006 v3.2 §1(GUI/CLI 용어 대응)·§8(공통 동작 규칙) ·
 * DES-008 v3.1 §CLI Entry
 *
 * Layer 3-1은 `cm auth login/logout/status`만 붙였다. Layer 3-2 그룹 A가
 * `project`·`agent`·`task`·`status-changes`(SCR-P01~SC01, 기본 CRUD 14개
 * 명령)를, 그룹 B가 `chat`(SCR-CH01~03·11~13, 대화 6개 명령)을, 그룹 C가
 * `inbox`·`decide`·`approvals`·`review`(SCR-CH04·05·07·08, 승인 4개 명령 —
 * 전부 최상위 명령이다)를 이어 붙였다. `progress`·`stage`·`artifacts`
 * (그룹 D)는 여전히 자리만 비워 둔다 — 동작하지 않는 명령이 `--help`에
 * 나타나면 대표가 실행해보고서야 미구현임을 알게 된다.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

export function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8')) as {
      version: string;
    };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('cm')
    .description('ClaudeManager CLI — 1인 CEO를 위한 멀티 에이전트 오케스트레이션')
    .version(readVersion());

  registerAuthCommand(program);
  registerProjectCommand(program);
  registerAgentCommand(program);
  registerTaskCommand(program);
  registerStatusChangeCommand(program);
  registerChatCommand(program);
  registerApprovalCommand(program);
  // 그룹 D에서 여기에 이어 붙인다: registerProgressCommand(program)

  return program;
}

export async function main(): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    // 토큰 등 민감정보를 담지 않는 예외만 여기까지 올라온다(api-client.ts·
    // commands/auth.ts가 이미 사용자용 메시지로 변환해 처리한다). 그래도
    // 예상 못한 예외의 스택은 대표에게 그대로 노출하지 않는다.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`✗ 예기치 못한 오류가 발생했습니다: ${message}`);
    process.exitCode = 1;
  }
}

/**
 * `src/cli/index.ts`가 직접 실행됐을 때만 `main()`을 돈다. 테스트가 이 모듈을
 * `import`할 때는 `process.argv`가 vitest 자신의 인자이므로, 여기서 실행해
 * 버리면 commander가 그 인자를 해석하려다 `process.exit()`를 불러 테스트
 * 프로세스를 죽인다 — Node ESM의 표준 "entry point 판별" 관용구를 쓴다.
 */
const isMainModule =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isMainModule) {
  await main();
}
