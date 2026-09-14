// T12 SW 注册与更新提示（D09）：有新版本先提示；applyUpdate 只由用户点击触发，
// 活动会话期间不自动重载（App 层会话标志把关）。
import { registerSW } from 'virtual:pwa-register'

export type DisplayModeKind = 'standalone' | 'toplevel' | 'browser'

export interface PwaHandle {
  applyUpdate: () => void
}

export const ACTIVE_SESSION_FLAG = 'gaokao-active-session'

export const hasActiveSessionFlag = (): boolean => {
  try {
    return globalThis.sessionStorage?.getItem(ACTIVE_SESSION_FLAG) === '1'
  } catch {
    return false
  }
}

export const setActiveSessionFlag = (active: boolean): void => {
  try {
    if (active) globalThis.sessionStorage?.setItem(ACTIVE_SESSION_FLAG, '1')
    else globalThis.sessionStorage?.removeItem(ACTIVE_SESSION_FLAG)
  } catch {
    // 会话存储不可用时静默：仅影响更新时机提示
  }
}

export function setupPwa(options: { onNeedRefresh?: () => void; onOfflineReady?: () => void } = {}): PwaHandle {
  if (!import.meta.env.PROD) {
    return { applyUpdate: () => undefined }
  }
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => options.onNeedRefresh?.(),
    onOfflineReady: () => options.onOfflineReady?.(),
  })
  return {
    applyUpdate: () => {
      void updateSW(true)
    },
  }
}

// 区分独立应用 / iOS 主屏幕（toplevel）/ 普通浏览器标签（D09 + P05）；
// 结果仅本地展示，不参与任何上报。国产安卓浏览器无法可靠区分，
// 页面展示浏览器形态说明即可，不做浏览器特征上报。
export const detectDisplayMode = (): DisplayModeKind => {
  try {
    const nav = globalThis.navigator as { standalone?: boolean }
    if (nav.standalone === true) return 'toplevel'
    if (globalThis.matchMedia?.('(display-mode: standalone)').matches === true) return 'standalone'
    return 'browser'
  } catch {
    return 'browser'
  }
}

export const isIosDevice = (): boolean => {
  try {
    return /iP(hone|ad|od)/.test(globalThis.navigator.userAgent ?? '')
  } catch {
    return false
  }
}
