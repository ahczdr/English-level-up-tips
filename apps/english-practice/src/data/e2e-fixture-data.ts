// T14：固定 fixtures 数据（仅被 e2e-fixtures.ts 在 VITE_E2E=true 构建中动态加载）。
// 与 public/content-packs 同源：catalog.json 与 pack.json 原样内联，sha256 为真实资产摘要，
// 因此下载链路的 bytes/sha256/MIME 校验在 fixtures 模式下依旧全量生效。
import catalogJson from './fixtures/content-catalog.json?raw'
import packJson from './fixtures/gaokao-listening/pack.json?raw'

export const fixtureFor = (url: string): string | null => {
  if (url.includes('content-catalog.json')) return catalogJson
  // 按 包id/版本 精确匹配，其余 pack.json 走真实 HTTP（fixture 未覆盖的包不提供测试数据）
  if (url.includes('/gaokao-listening/') && url.includes('/pack.json')) return packJson
  return null
}