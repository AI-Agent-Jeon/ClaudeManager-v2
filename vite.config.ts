import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Phase 2A 웹 UI 빌드 설정
 *
 * 정의 원본: 대표 승인 APV-2A-01(동일 오리진 SPA) — 별도 프로세스를 띄우지
 * 않는다. 개발 중에는 이 설정의 dev 서버(`npm run frontend:dev`)가 `/api`를
 * 기존 Fastify(127.0.0.1:3000)로 프록시하고, 배포 형태로 볼 때는
 * `npm run frontend:build`가 만든 `dist/frontend`를 Fastify가 직접
 * 서빙한다(`src/backend/plugins/static.ts`).
 *
 * root를 `src/frontend`로 두고 out을 `dist/frontend`로 내보낸다 — 백엔드
 * `tsup` 빌드(`dist/`)와 하위 폴더로 공존한다.
 */
export default defineConfig({
  root: 'src/frontend',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../../dist/frontend',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
});
