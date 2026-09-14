// T14：将 public/content-packs 的 JSON（catalog + 各 pack.json）同步为 src/data/fixtures/ 下的
// 可导入副本（Vite 禁止从 public 目录 import）。仅 JSON，不含音频字节；由 build:e2e 前置执行。
import { mkdirSync, readdirSync, copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const packsRoot = join(root, 'public', 'content-packs')
const outRoot = join(root, 'src', 'data', 'fixtures')
if (!existsSync(packsRoot)) {
  console.error('public/content-packs missing; run npm run content:build first')
  process.exit(1)
}
if (!existsSync(join(root, 'public', 'content-catalog.json'))) {
  console.error('public/content-catalog.json missing; run npm run content:build first')
  process.exit(1)
}
// R4：清理 fixtures 下已消失的陈旧目录，保证 fixtures 与 public 集合一致
if (existsSync(outRoot)) {
  for (const stale of readdirSync(outRoot, { withFileTypes: true })) {
    if (stale.name === 'content-catalog.json') continue
    rmSync(join(outRoot, stale.name), { recursive: true, force: true })
  }
}
mkdirSync(outRoot, { recursive: true })
copyFileSync(join(root, 'public', 'content-catalog.json'), join(outRoot, 'content-catalog.json'))
let copied = 1
for (const entry of readdirSync(packsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const versionDirs = readdirSync(join(packsRoot, entry.name), { withFileTypes: true })
  for (const version of versionDirs) {
    if (!version.isDirectory()) continue
    const packFile = join(packsRoot, entry.name, version.name, 'pack.json')
    if (existsSync(packFile)) {
      // 版本无关：每个包只保留最新 pack.json（静态 ?raw 导入路径固定，不随版本号变动）
      const outDir = join(outRoot, entry.name)
      mkdirSync(outDir, { recursive: true })
      copyFileSync(packFile, join(outDir, 'pack.json'))
      copied += 1
      // 防漂移：fixtures 必须与 public 同源同字节
      if (readFileSync(packFile, 'utf8') !== readFileSync(join(outDir, 'pack.json'), 'utf8')) {
        console.error('fixture drift for', entry.name)
        process.exit(1)
      }
    }
  }
}
console.log('e2e fixtures synced:', copied, 'file(s)')