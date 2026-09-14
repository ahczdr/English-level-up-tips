import { describe, expect, it } from 'vitest'
import { advanceE2eClockDays, e2eNow, isE2eBuild } from '../../src/data/e2e-clock'
import { e2eFixtureFor } from '../../src/data/e2e-fixtures'

// T14：生产/单测环境（无 VITE_E2E）下，测试入口必须缺席
describe('E2E 构建门控（生产默认关闭）', () => {
  it('isE2eBuild 为 false，fixtures 恒为 null（内容加载器不提供测试入口）', async () => {
    expect(isE2eBuild()).toBe(false)
    expect(await e2eFixtureFor('http://x/content-catalog.json')).toBeNull()
    expect(await e2eFixtureFor('http://x/content-packs/gaokao-listening/1.0.0/pack.json')).toBeNull()
  })

  it('时钟偏移 advance 在非 E2E 构建为 no-op，e2eNow 等价真实时间', () => {
    const before = e2eNow().getTime()
    advanceE2eClockDays(7)
    const after = e2eNow().getTime()
    // 容忍执行耗时；若无偏移，差值远小于 7 天
    expect(after - before).toBeLessThan(86_400_000)
  })
})
