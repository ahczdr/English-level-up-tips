import { defineConfig, devices } from '@playwright/test'

// T12/T14：SW 用例在生产构建 preview（:4174）运行；reuseExistingServer=false 防连到其他项目服务。
// 由 npm run test:e2e 在主配置之后串联执行（主配置结束后端口已释放）。运行前 npm run build。
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /offline\.spec\.ts/,
  outputDir: 'test-results/prod-offline',
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'chromium-preview',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
