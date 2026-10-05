import {API_BASE,API_PORT,PRODUCTION_BASE} from './tests/e2e/api-base'
import { defineConfig } from '@playwright/test'
const uiBase=process.env.TONGYE_E2E_BASE_URL||'http://localhost:5173'
const uiURL=new URL(uiBase)
if(uiURL.origin!==uiBase||uiURL.protocol!=='http:'||uiURL.hostname!=='localhost'||!/^\d+$/.test(uiURL.port))throw new Error('E2E前端必须使用显式localhost端口')
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: uiBase, trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: { ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) } },
  webServer: [
    { command: 'npx tsx scripts/e2e-server.ts', url: `http://127.0.0.1:${API_PORT}/api/v1/ready`, reuseExistingServer: false, timeout: 180_000, env: { TONGYE_E2E_ADMIN_ROOT: 'a'.repeat(64), TONGYE_E2E_ORIGINS: `http://localhost:5173,${PRODUCTION_BASE},${uiBase}` } },
    { command: `npx tsx scripts/generate-help.ts && npx vite --host 127.0.0.1 --port ${uiURL.port} --strictPort`, url: uiBase, reuseExistingServer: false, env: { VITE_API_URL: API_BASE }, timeout: 180_000 },
  ],
})
