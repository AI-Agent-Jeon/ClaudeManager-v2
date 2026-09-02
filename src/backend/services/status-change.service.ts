import type { EntityType } from '../../shared/constants.js';
import type { Pagination, StatusChange } from '../../shared/types.js';
import type {
  StatusChangeInsertRow,
  StatusChangeRepository,
  StatusChangeRow,
} from '../repositories/status-change.repository.js';

/**
 * StatusChangeService (FR-009)
 *
 * 정의 원본: DES-004 v2.2 §12 · §전체 함수 시그니처 요약 (Services)
 *
 * "AuditLogger"라는 별칭(ANL-002 빌드 순서 2-1)으로도 불린다 — 모든 엔티티의
 * 상태 전이를 기록하는 감사 로그 역할을 한다.
 */

export interface ListStatusChangesOpts {
  page: number;
  pageSize: number;
  entityType?: EntityType;
  entityId?: string;
}

function toStatusChange(row: StatusChangeRow): StatusChange {
  return {
    id: row.id,
    entityType: row.entity_type as EntityType,
    entityId: row.entity_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    changedBy: row.changed_by,
    changedAt: row.changed_at,
  };
}

export class StatusChangeService {
  constructor(private readonly repo: StatusChangeRepository) {}

  async record(input: StatusChangeInsertRow): Promise<void> {
    this.repo.insert(input);
  }

  async list(
    opts: ListStatusChangesOpts,
  ): Promise<{ items: StatusChange[]; pagination: Pagination }> {
    const offset = (opts.page - 1) * opts.pageSize;
    const filter = { entityType: opts.entityType, entityId: opts.entityId };

    const rows = this.repo.findMany({ offset, limit: opts.pageSize, ...filter });
    const total = this.repo.count(filter);

    return {
      items: rows.map(toStatusChange),
      pagination: {
        page: opts.page,
        pageSize: opts.pageSize,
        total,
        totalPages: Math.ceil(total / opts.pageSize),
      },
    };
  }
}
