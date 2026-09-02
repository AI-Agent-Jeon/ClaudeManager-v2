import { defineConfig } from 'vitest/config';

// 경로 별칭을 두지 않는다. tsc(NodeNext)와 Vite가 별칭을 다르게 해석해
// "테스트는 통과하는데 typecheck는 실패"하는 상태가 생긴다.
// src 코드와 동일하게 상대 경로 + '.js' 확장자로 통일한다.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/frontend/**',
        'src/shared/index.ts',
        // 타입 선언만 있는 파일 — 컴파일 후 런타임 코드가 남지 않아 실행할 것이 없다
        'src/shared/types.ts',
        // 프로세스 진입점. listen·시그널 처리라 단위 테스트로 실행하지 않는다.
        // ⚠ Graceful Shutdown이 커버리지에서 빠진다 — 통합 테스트(test 스킬)에서 다룬다
        'src/backend/server.ts',
      ],
      // DES 기준: 전체 70% / Must 스토리 관련 코드 80%
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
