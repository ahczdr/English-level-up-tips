// T14：E2E 测试用内容加载器。
// - 仅在 VITE_E2E=true 构建生效；生产构建该模块的条件为常量假，动态导入被摇树剔除，
//   e2eFixtureFor 恒返回 null（与未引入本机制等价）。
// - fixtures 提供固定的 catalog.json / pack.json（与 public/content-packs 同源同 hash），
//   音频字节仍走真实 HTTP 资源；校验（validatePack + bytes/sha256）不因 fixtures 关闭或修改。
import { isE2eBuild } from './e2e-clock'

const fixtureFor = async (url: string): Promise<string | null> => {
  const mod = await import('./e2e-fixture-data')
  return mod.fixtureFor(url)
}

export const e2eFixtureFor = async (url: string): Promise<string | null> => {
  if (!isE2eBuild()) return null
  return fixtureFor(url)
}
