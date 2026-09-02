import { relations } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Drizzle 스키마
 *
 * 정의 원본: DES-003 v2.1 §2 ERD
 *
 * ⚠ **이 파일은 스키마의 원본이 아니다.** 원본은 `src/backend/migrations/*.sql`이다.
 * CHECK 제약 5건, 부분 유니크 인덱스, FTS5 가상 테이블과 트리거는 Drizzle
 * 스키마로 표현되지 않는다. 여기는 **쿼리 타입을 위한 거울**이며, 마이그레이션이
 * 바뀌면 이 파일도 함께 바꿔야 한다.
 *
 * 그래서 `drizzle-kit generate`를 쓰지 않는다 — 생성된 SQL은 제약을 잃는다.
 */

// ── 기존 4종 (001_initial) ──────────────────────────────────

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('ready'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('projects_name_unique').on(t.name)],
);

export const agents = sqliteTable(
  'agents',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull().default(''),
    status: text('status').notNull().default('created'),
    /** status가 waiting일 때만 값을 가진다 — CHECK로 강제된다 (D-11) */
    waitingReason: text('waiting_reason'),
    skill: text('skill').notNull().default(''),
    /** DB는 TEXT(JSON 문자열), API 응답은 object. Service가 변환한다 */
    config: text('config').notNull().default('{}'),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('agents_project_id_idx').on(t.projectId),
    uniqueIndex('agents_project_name_unique').on(t.projectId, t.name),
  ],
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('ready'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('tasks_agent_id_idx').on(t.agentId)],
);

export const statusChanges = sqliteTable(
  'status_changes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 6종 — 006_status_ext에서 확장되었다 */
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    /** 최초 생성 시 NULL. '' 가 아니다 */
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    changedBy: text('changed_by').notNull(),
    changedAt: text('changed_at').notNull(),
  },
  (t) => [
    index('sc_entity_idx').on(t.entityType, t.entityId),
    index('sc_changed_at_idx').on(t.changedAt),
  ],
);

// ── 대화 (002_conversations) ────────────────────────────────

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    channelType: text('channel_type').notNull(),
    /** agents.id를 가리키지만 **FK가 아니다** — D-27 대화 보존 */
    entityId: text('entity_id'),
    status: text('status').notNull().default('active'),
    /** JSON — 삭제된 Agent 정보 보존 (의도적 비정규화) */
    entitySnapshot: text('entity_snapshot'),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [
    // 부분 유니크(WHERE channel_type='main')는 Drizzle로 표현되지 않는다.
    // 실제 제약은 002_conversations.sql에 있다.
    index('conversations_status_idx').on(t.status, t.archivedAt),
    index('conversations_entity_idx').on(t.entityId),
  ],
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    /** 'MSG-01' ~ 'MSG-06' */
    msgType: text('msg_type').notNull(),
    senderRole: text('sender_role').notNull(),
    /** FTS5 색인 대상 */
    body: text('body').notNull(),
    /** JSON — MSG-03 4단 보고 */
    structured: text('structured'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('messages_conv_idx').on(t.conversationId, t.createdAt)],
);

// ── 진행 (003_phases) ───────────────────────────────────────

export const phases = sqliteTable(
  'phases',
  {
    id: text('id').primaryKey(),
    number: integer('number').notNull(),
    name: text('name').notNull(),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    currentStage: text('current_stage'),
  },
  (t) => [uniqueIndex('phases_number_unique').on(t.number)],
);

export const stages = sqliteTable(
  'stages',
  {
    id: text('id').primaryKey(),
    phaseId: text('phase_id')
      .notNull()
      .references(() => phases.id, { onDelete: 'cascade' }),
    skill: text('skill').notNull(),
    status: text('status').notNull().default('pending'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
  },
  // gate_approval_id를 두지 않는다 — approvals.stage_id와 순환 FK가 된다
  (t) => [uniqueIndex('stages_phase_skill_unique').on(t.phaseId, t.skill)],
);

// ── 승인 (004_approvals) ────────────────────────────────────

export const approvals = sqliteTable(
  'approvals',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id').references(() => messages.id, { onDelete: 'set null' }),
    stageId: text('stage_id').references(() => stages.id, { onDelete: 'set null' }),
    approvalType: text('approval_type').notNull(),
    /** 'high' | 'medium' — 'low'는 적재하지 않는다 */
    level: text('level').notNull(),
    subject: text('subject').notNull(),
    options: text('options'),
    artifacts: text('artifacts'),
    rationale: text('rationale'),
    impact: text('impact'),
    requestedBy: text('requested_by').notNull(),
    /** high는 항상 NULL — CHECK (2)로 강제된다 */
    deadlineAt: text('deadline_at'),
    status: text('status').notNull().default('pending'),
    /** 'system:' 접두어는 시스템 마감 (R-04) */
    resolution: text('resolution'),
    reason: text('reason'),
    resolvedAt: text('resolved_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('approvals_status_idx').on(t.status, t.level),
    index('approvals_stage_idx').on(t.stageId, t.approvalType),
    // approvals_deadline_idx는 부분 인덱스라 SQL에만 있다
  ],
);

// ── 산출물·WIP (005_artifacts) ──────────────────────────────

export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    stageId: text('stage_id')
      .notNull()
      .references(() => stages.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull().default('draft'),
    notionUrl: text('notion_url'),
    gitPath: text('git_path'),
    updatedAt: text('updated_at').notNull(),
  },
  // syncStatus 컬럼이 없다 — notionUrl·gitPath 유무에서 파생한다 (3NF)
  (t) => [
    uniqueIndex('artifacts_code_unique').on(t.code),
    index('artifacts_stage_idx').on(t.stageId),
  ],
);

export const wipWaivers = sqliteTable(
  'wip_waivers',
  {
    id: text('id').primaryKey(),
    phaseId: text('phase_id')
      .notNull()
      .references(() => phases.id, { onDelete: 'cascade' }),
    rule: text('rule').notNull(),
    reason: text('reason').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('wip_waivers_phase_idx').on(t.phaseId)],
);

// ── 관계 ────────────────────────────────────────────────────

export const projectsRelations = relations(projects, ({ many }) => ({
  agents: many(agents),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  project: one(projects, { fields: [agents.projectId], references: [projects.id] }),
  tasks: many(tasks),
  // conversations와는 관계를 선언하지 않는다 — FK가 없다 (D-27)
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  agent: one(agents, { fields: [tasks.agentId], references: [agents.id] }),
}));

export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const phasesRelations = relations(phases, ({ many }) => ({
  stages: many(stages),
  wipWaivers: many(wipWaivers),
}));

export const stagesRelations = relations(stages, ({ one, many }) => ({
  phase: one(phases, { fields: [stages.phaseId], references: [phases.id] }),
  artifacts: many(artifacts),
  approvals: many(approvals),
}));

export const approvalsRelations = relations(approvals, ({ one }) => ({
  stage: one(stages, { fields: [approvals.stageId], references: [stages.id] }),
  message: one(messages, { fields: [approvals.messageId], references: [messages.id] }),
}));

export const artifactsRelations = relations(artifacts, ({ one }) => ({
  stage: one(stages, { fields: [artifacts.stageId], references: [stages.id] }),
}));

export const wipWaiversRelations = relations(wipWaivers, ({ one }) => ({
  phase: one(phases, { fields: [wipWaivers.phaseId], references: [phases.id] }),
}));
