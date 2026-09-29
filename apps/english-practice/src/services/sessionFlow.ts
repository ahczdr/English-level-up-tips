import type { GaokaoDatabase } from '../data/db'
import type { Session } from '../data/migrations'
import { e2eNow } from '../data/e2e-clock'
import type { AppErrorCode, Result } from './learning'

export interface SessionSummary {
  totalSlots: number
  submittedSlots: number
  skippedSlots: number
  independentFirst: number
  assistedFirst: number
  failedFirst: number
  pending: number
}

interface FlowClock {
  now(): Date
}

// CR54：与服务层默认时钟同源（E2E 构建可被测试时钟桥推移，跨日推进时口径一致）
const systemClock: FlowClock = { now: () => e2eNow() }

const error = (code: AppErrorCode, messageZh: string): Result<never> => ({
  ok: false,
  error: { code, messageZh },
})

const firstUnfinished = (session: Session): number =>
  session.slots.findIndex((slot) => slot.state === 'unseen' || slot.state === 'answering')

export { firstUnfinished }

export async function setCurrentIndex(
  db: GaokaoDatabase,
  sessionId: string,
  index: number,
  expectedRevision: number,
  clock: FlowClock = systemClock,
): Promise<Result<Session>> {
  try {
    return await db.transaction('rw', db.sessions, async () => {
      const session = await db.sessions.get(sessionId)
      if (!session) return error('NOT_FOUND', '未找到指定学习记录')
      if (session.revision !== expectedRevision) return error('STALE_SESSION', '学习记录已在其他页面更新，请刷新后再试')
      if (!Number.isInteger(index) || index < 0 || index >= session.slots.length) {
        return error('NOT_FOUND', '未找到指定题目位置')
      }
      if (session.currentIndex === index) return { ok: true, value: session }
      session.currentIndex = index
      session.revision += 1
      session.updatedAt = clock.now().toISOString()
      await db.sessions.put(session)
      return { ok: true, value: session }
    })
  } catch {
    return error('STORAGE_FAILED', '本地存储写入失败，请检查设备存储空间')
  }
}

interface FirstAttemptPayload {
  grade: { earned: number; possible: number }
  assistance: string[]
}

export async function getSessionSummary(db: GaokaoDatabase, sessionId: string): Promise<Result<SessionSummary>> {
  try {
    const session = await db.sessions.get(sessionId)
    if (!session) return error('NOT_FOUND', '未找到指定学习记录')
    // CR3：一次拉回本会话全部首次作答与曝光，内存建映射，替代逐 slot 的 N+1 查询
    const attemptRows = await db.attempts.where('sessionId').equals(sessionId).toArray()
    const attemptBySlot = new Map<string, FirstAttemptPayload>()
    for (const record of attemptRows) {
      if (record.phase !== 'first') continue
      const payload = record.payload as FirstAttemptPayload | undefined
      if (payload && attemptBySlot.get(record.slotId) === undefined) attemptBySlot.set(record.slotId, payload)
    }
    // CR48/CR51：外会话曝光只统计本 profile 的行（per-profile 账本），跨 profile 不影响独立判定。
    // 熟题口径与 submitAnswer 一致（itemId 级）：本 profile 在任意版本下由其他会话首见即算辅助
    const exposureRows = await db.exposureLog.where('profileId').equals(session.profileId).toArray()
    const foreignItemIds = new Set(
      exposureRows.filter((exposure) => exposure.firstSeenSessionId !== sessionId).map((exposure) => exposure.itemId),
    )
    const summary: SessionSummary = {
      totalSlots: session.slots.length,
      submittedSlots: 0,
      skippedSlots: 0,
      independentFirst: 0,
      assistedFirst: 0,
      failedFirst: 0,
      pending: 0,
    }
    for (const slot of session.slots) {
      if (slot.state === 'submitted') summary.submittedSlots += 1
      const attempt = attemptBySlot.get(slot.id)
      if (attempt) {
        const assisted = attempt.assistance.length > 0 || foreignItemIds.has(slot.ref.itemId)
        const full = attempt.grade.possible > 0 && attempt.grade.earned === attempt.grade.possible
        if (full && !assisted) summary.independentFirst += 1
        else if (full) summary.assistedFirst += 1
        else summary.failedFirst += 1
      } else if (slot.state === 'skipped') {
        summary.skippedSlots += 1
      } else {
        summary.pending += 1
      }
    }
    return { ok: true, value: summary }
  } catch {
    return error('STORAGE_FAILED', '本地存储读取失败，请检查设备存储空间')
  }
}
