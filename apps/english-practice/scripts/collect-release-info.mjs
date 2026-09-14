// T16：生成 dist/release-info.json——记录 build SHA、应用版本、内容包版本（发布存档 + 页面核对一致性）。
// 用法：BUILD_SHA=<sha> node scripts/collect-release-info.mjs（在 npm run build 之后执行）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const catalogPath = join(root, 'dist', 'content-catalog.json')
if (!existsSync(catalogPath)) {
  console.error('dist/content-catalog.json 缺失；先执行 npm run build')
  process.exit(1)
}
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const info = {
  appVersion: pkg.version,
  buildSha: process.env.BUILD_SHA ?? 'unversioned',
  generatedAt: new Date().toISOString(),
  packs: (catalog.packs ?? []).map((pack) => ({ id: pack.id, version: pack.version, sha256: pack.sha256 })),
}
writeFileSync(join(root, 'dist', 'release-info.json'), JSON.stringify(info, null, 2) + '\n')
console.log('release-info.json 已生成：', info.appVersion, info.buildSha, info.packs.map((p) => p.id + '@' + p.version).join(', '))
