// T14：E2E 测试时钟桥。
// - 服务层默认时钟统一走 e2eNow()（学习/日界逻辑全部经 LearningClock 注入，此为默认实现）。
// - 偏移只能在 E2E 构建（VITE_E2E=true）中通过 window.__GAOKAO_E2E__.advanceDays 修改；
//   生产构建该入口不存在，e2eNow() 恒等于 new Date()，行为与注入真实时钟完全一致。

const offsetMs = { value: 0 }

export const isE2eBuild = (): boolean => import.meta.env.VITE_E2E === 'true'

export const e2eNow = (): Date => new Date(Date.now() + offsetMs.value)

export const advanceE2eClockDays = (days: number): void => {
  if (!isE2eBuild()) return
  offsetMs.value += days * 86_400_000
}

export const installE2eBridge = (): void => {
  if (!isE2eBuild()) return
  ;(globalThis as { __GAOKAO_E2E__?: unknown }).__GAOKAO_E2E__ = {
    advanceDays: advanceE2eClockDays,
    clockOffsetMs: () => offsetMs.value,
  }
}
