// T14：发布构建冒烟——验证不含 VITE_E2E 的产物：
// 1) dist 无 fixtures 专属字符串（R1：摇树门禁固化）；2) 应用 shell 可用；
// 3) window.__GAOKAO_E2E__ 测试入口不存在；4) SW 已注册；5) 4174 未被外部占用（R2）。
// 用法：先 npm run build:release，再 npm run test:smoke（test:smoke 已串联 build:release）。
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { chromium } from '@playwright/test'

const PORT = 4174
const URL = 'http://127.0.0.1:' + PORT + '/'

const fail = (message) => {
  console.error('SMOKE FAIL:', message)
  process.exit(1)
}

// R1：dist/assets/*.js 不得含 fixture 专属字符串（摇树门禁）
const assetsDir = join(process.cwd(), 'dist', 'assets')
if (!existsSync(assetsDir)) fail('dist/ missing; run npm run build:release first')
// T16/B1：sw.js 必须含 SKIP_WAITING 监听（prompt 更新确认路径）
const swContent = readFileSync(join(process.cwd(), 'dist', 'sw.js'), 'utf8')
if (!swContent.includes('SKIP_WAITING')) fail('dist/sw.js missing SKIP_WAITING listener')
// CR61：precache 仅 shell 断言对发布产物执行（此前只在高 E2E 配置里，实际读到的是 E2E 构建的 dist）
if (swContent.includes('content-packs')) fail('dist/sw.js precaches content packs; only the app shell may be precached')
if (swContent.includes('content-assets')) fail('dist/sw.js precaches shared content assets; only the app shell may be precached')
if (!swContent.includes('content-catalog.json')) fail('dist/sw.js missing content-catalog.json network-first handler')
// T16/B2：release-info.json 存在且 BUILD_SHA 一致
const infoPath = join(process.cwd(), 'dist', 'release-info.json')
if (!existsSync(infoPath)) fail('dist/release-info.json missing; run collect-release-info.mjs after build')
const info = JSON.parse(readFileSync(infoPath, 'utf8'))
const expectedSha = process.env.BUILD_SHA ?? 'unversioned'
// CR13：拒绝带反斜杠等格式污染的 SHA（40 位十六进制或显式 unversioned 之外一律失败）
if (expectedSha !== 'unversioned' && !/^[0-9a-f]{40}$/.test(expectedSha)) {
  fail('BUILD_SHA must be a 40-char lowercase hex sha or unset; got: ' + JSON.stringify(expectedSha))
}
if (info.buildSha !== expectedSha) fail('release-info buildSha ' + info.buildSha + ' != BUILD_SHA ' + expectedSha)
// 夹具数据内嵌 pack JSON：E2E 构建的 JS 才会含包 id 字符串（版本无关，避免版本提升让标记失效）
const fixtureMarkers = ['"id":"gaokao-protocol-demo"', '"id":"gaokao-listening"']
for (const file of readdirSync(assetsDir)) {
  if (!file.endsWith('.js')) continue
  const content = readFileSync(join(assetsDir, file), 'utf8')
  for (const marker of fixtureMarkers) {
    if (content.includes(marker)) fail('dist/assets/' + file + ' contains fixture marker: ' + marker)
  }
}

// R2：端口被外部占用时直接失败，不静默借道外部服务器
let external = false
try {
  const response = await fetch(URL)
  if (response.ok) external = true
} catch {
  // 端口空闲，符合预期
}
if (external) fail('port ' + PORT + ' is already serving something else; refusing to smoke against it')

// R2/CR65：用当前 node 直启 vite 入口脚本（不依赖 POSIX 的 node_modules/.bin，Windows 可跑）
const vitePkgPath = join(process.cwd(), 'node_modules', 'vite', 'package.json')
if (!existsSync(vitePkgPath)) fail('vite package not found; run npm ci first')
const vitePkg = JSON.parse(readFileSync(vitePkgPath, 'utf8'))
const viteBinRelative = typeof vitePkg.bin === 'string' ? vitePkg.bin : vitePkg.bin?.vite
if (!viteBinRelative) fail('vite package.json has no bin entry')
const viteEntry = join(dirname(vitePkgPath), viteBinRelative)
const server = spawn(process.execPath, [viteEntry, 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: process.cwd(), stdio: 'pipe' })
let serverOut = ''
server.stdout.on('data', (chunk) => { serverOut += String(chunk) })
server.stderr.on('data', (chunk) => { serverOut += String(chunk) })
const cleanup = () => {
  try {
    server.kill('SIGTERM')
  } catch {
    // 已退出
  }
}
process.on('exit', cleanup)

const waitForServer = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(URL)
      if (response.ok) return
    } catch {
      // 未就绪，继续等待
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('preview server did not start: ' + serverOut.slice(0, 400))
}

try {
  await waitForServer()
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.locator('.app-shell').waitFor()
    const title = await page.locator('.app-shell h1').textContent()
    if (title !== '高考英语练习') throw new Error('unexpected title: ' + title)
    const bridge = await page.evaluate(() => window.__GAOKAO_E2E__)
    if (bridge !== undefined) throw new Error('__GAOKAO_E2E__ present in release build')
    const swRegistered = await page.evaluate(async () => ('serviceWorker' in navigator ? Boolean(navigator.serviceWorker.controller) || Boolean(await navigator.serviceWorker.getRegistration()) : false))
    if (!swRegistered) throw new Error('service worker not registered in release build')
  } finally {
    // CR58：断言失败也要关闭浏览器，不留孤儿 Chromium
    await browser.close().catch(() => undefined)
  }
} catch (error) {
  cleanup()
  fail(error && error.message ? error.message : String(error))
}
console.log('SMOKE OK: dist clean, shell OK, no E2E bridge, SW registered')
// CR58：vite preview 子进程的管道会让事件循环一直存活，成功路径必须收尾并显式退出，
// 否则脚本打印 SMOKE OK 后永不结束（CI release-smoke 卡死即此因）
cleanup()
process.exit(0)