import type { Command } from 'commander';
import { EntityType, ErrorCode } from '../../shared/constants.js';
import type { StatusChange } from '../../shared/types.js';
import { ApiRequestError, ServerUnreachableError } from '../api-client.js';
import {
  formatTimestamp,
  ID_SHORT_LEN,
  paginationFooter,
  renderTable,
  shortId,
  successBlock,
} from '../output.js';
import {
  type CliApiClient,
  type CommandDeps,
  checkAuth,
  defaultCommandDeps,
  presentAuthGuardFailure,
  serverUnreachableBlock,
  unauthenticatedBlock,
} from '../runtime.js';

/**
 * `cm status-changes` — SCR-SC01
 *
 * 정의 원본: DES-006 v3.2 §2 SCR-SC01 · §3 표시 데이터 · §4-4 EVT-SC01-1~3
 *
 * 14개 명령 중 유일하게 단건 조회·상태 변경이 없는 순수 목록 화면이라
 * `project`·`agent`·`task`의 `status`(상세+변경) 명령보다 단순하다. ID
 * 접두어 해석(`runtime.ts` `resolveId`)도 쓰지 않는다 — `--entity-id`는
 * project·agent·task 세 테이블에 걸친 값이라 어느 목록에서 접두어를
 * 확장해야 할지 CLI가 알 수 없다(자율 판단, 등급 낮음). 그래서 `--entity-id`는
 * 전체 UUID를 그대로 서버에 넘긴다 — 목록 화면에서 8자로 잘라 보여준 뒤에도
 * 사용자가 전체 UUID를 복사해 붙여넣는 것을 전제한다.
 */

const ENTITY_TYPE_VALUES = Object.values(EntityType);

export type StatusChangeListResult =
  | {
      ok: true;
      items: StatusChange[];
      page: number;
      totalPages: number;
      total: number;
      entityType?: string;
      entityId?: string;
    }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

export async function runStatusChangeList(opts: {
  client: CliApiClient;
  entityType?: string;
  entityId?: string;
  page: number;
}): Promise<StatusChangeListResult> {
  try {
    const qs = new URLSearchParams({ page: String(opts.page) });
    if (opts.entityType) qs.set('entityType', opts.entityType);
    if (opts.entityId) qs.set('entityId', opts.entityId);
    const res = await opts.client.get<{
      data: StatusChange[];
      pagination: { page: number; totalPages: number; total: number };
    }>(`/status-changes?${qs.toString()}`);
    return {
      ok: true,
      items: res.data,
      page: res.pagination.page,
      totalPages: res.pagination.totalPages,
      total: res.pagination.total,
      entityType: opts.entityType,
      entityId: opts.entityId,
    };
  } catch (err) {
    if (err instanceof ServerUnreachableError) {
      return { ok: false, reason: 'server_unreachable', serverUrl: opts.client.baseUrl };
    }
    if (
      err instanceof ApiRequestError &&
      (err.code === ErrorCode.UNAUTHORIZED || err.code === ErrorCode.AUTH_TOKEN_EXPIRED)
    ) {
      return { ok: false, reason: 'unauthenticated' };
    }
    throw err;
  }
}

/** null이면 최초 생성(이전 상태 없음) — DES-003 v2.1 §3-5, `''`이 아니라 `null`이다 */
function formatFromStatus(fromStatus: string | null): string {
  return fromStatus ?? '-';
}

function presentStatusChangeList(result: StatusChangeListResult, deps: CommandDeps): void {
  if (!result.ok) {
    if (result.reason === 'server_unreachable')
      deps.errorLog(serverUnreachableBlock(result.serverUrl));
    else deps.errorLog(unauthenticatedBlock(false));
    deps.setExitCode(1);
    return;
  }

  if (result.items.length === 0) {
    deps.log(successBlock('상태 변경 이력', '상태 변경 이력이 없습니다'));
    deps.setExitCode(0);
    return;
  }

  // EVT-SC01-2 — 필터(entity-id) 없을 때만 ID 컬럼을 추가한다 (§3 SCR-SC01)
  const showId = !result.entityId;
  const headers = showId
    ? ['시각', '엔티티', 'ID', 'From', 'To', '변경자']
    : ['시각', '엔티티', 'From', 'To', '변경자'];
  const minWidths = showId ? [19, 10, ID_SHORT_LEN, 10, 10, 0] : [19, 10, 10, 10, 0];
  const rows = result.items.map((c) => {
    const cells = [formatTimestamp(c.changedAt), c.entityType];
    if (showId) cells.push(shortId(c.entityId));
    cells.push(formatFromStatus(c.fromStatus), c.toStatus, c.changedBy);
    return cells;
  });
  const table = renderTable(headers, rows, minWidths);

  const filters = [result.entityType, result.entityId].filter((v): v is string => Boolean(v));
  const footer = paginationFooter(
    { page: result.page, pageSize: 0, total: result.total, totalPages: result.totalPages },
    filters,
  );
  deps.log(successBlock('상태 변경 이력', `${table}\n\n${footer}`));
  deps.setExitCode(0);
}

// ─────────────────────────────────────────────
// Commander 연결
// ─────────────────────────────────────────────

export function registerStatusChangeCommand(
  program: Command,
  overrides: Partial<CommandDeps> = {},
): void {
  const deps: CommandDeps = { ...defaultCommandDeps(), ...overrides };

  program
    .command('status-changes')
    .description('상태 변경 이력을 조회한다 (SCR-SC01)')
    .option('--entity-type <entityType>', `엔티티 유형 필터 (${ENTITY_TYPE_VALUES.join('|')})`)
    .option('--entity-id <entityId>', '엔티티 ID 필터 (전체 UUID)')
    .option('--page <page>', '페이지 번호', '1')
    .action(async (opts: { entityType?: string; entityId?: string; page: string }) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      const result = await runStatusChangeList({
        client: deps.createClient(),
        entityType: opts.entityType,
        entityId: opts.entityId,
        page: Number(opts.page),
      });
      presentStatusChangeList(result, deps);
    });
}
