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
const catalog = JSON.parse(readFileSync(join(root, 'public', 'content-catalog.json'), 'utf8'))
const compareSemver = (left, right) => {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}
const latestByPack = new Map()
for (const entry of catalog.packs ?? []) {
  if (typeof entry?.id !== 'string' || typeof entry?.version !== 'string') continue
  const current = latestByPack.get(entry.id)
  if (!current || compareSemver(entry.version, current.version) > 0) latestByPack.set(entry.id, entry)
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
for (const [packId, entry] of latestByPack) {
  const packFile = join(packsRoot, packId, entry.version, 'pack.json')
  if (!existsSync(packFile)) {
    console.error('catalog pack missing:', packId, entry.version)
    process.exit(1)
  }
  // 版本无关：每个包只保留目录中按语义版本解析出的最新 pack.json。
  const outDir = join(outRoot, packId)
  mkdirSync(outDir, { recursive: true })
  copyFileSync(packFile, join(outDir, 'pack.json'))
  copied += 1
  // 防漂移：fixtures 必须与 public 同源同字节
  if (readFileSync(packFile, 'utf8') !== readFileSync(join(outDir, 'pack.json'), 'utf8')) {
    console.error('fixture drift for', packId)
    process.exit(1)
  }
}
console.log('e2e fixtures synced:', copied, 'file(s)')
