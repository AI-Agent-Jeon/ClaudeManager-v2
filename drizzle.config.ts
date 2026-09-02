import { defineConfig } from 'drizzle-kit';

// 마이그레이션 경로는 CLAUDE.md §디렉토리 구조 기준이다 (DES-008 v3.1 정정).
// src/backend/db/migrations/ 가 아니라 src/backend/migrations/ 다.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/backend/db/schema.ts',
  out: './src/backend/migrations',
  dbCredentials: {
    url: process.env.CM_DB_PATH ?? './data/claude-manager.db',
  },
  verbose: true,
  strict: true,
});
