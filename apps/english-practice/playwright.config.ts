import { defineConfig, devices } from '@playwright/test'

// T14：E2E 主配置跑在生产构建 preview（:4174），与其它项目服务隔离：
// reuseExistingServer=false + strictPort + 独立测试输出目录。运行前 npm run build。
// offline.spec 的 SW 用例由 playwright.offline.config.ts 单独串联（同为 4174，顺序执行）。
export default defineConfig({
  testDir: 'tests/e2e',
  testIgnore: /offline\.spec\.ts/,
  outputDir: 'test-results/prod-main',
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
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // T14：Firefox/WebKit 只跑基础流程（learning.spec），全量回归仍以 Chromium 为准；
      // WebKit 为引擎模拟，不等价 iOS 真机（触屏/软键盘/存储分区行为需真机验证）。
      name: 'firefox-basics',
      testMatch: /learning\.spec\.ts/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit-basics',
      testMatch: /learning\.spec\.ts/,
      use: { ...devices['Desktop Safari'] },
    },
  ],
})
