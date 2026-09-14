import type { GaokaoDatabase } from '../data/db'
import type { Session } from '../data/migrations'
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

const systemClock: FlowClock = { now: () => new Date() }

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
    const exposureRows = await db.exposures.toArray()
    const foreignSessionByRef = new Set(
      exposureRows
        .filter((exposure) => exposure.firstSeenSessionId !== sessionId)
        .map((exposure) => `${exposure.packId}|${exposure.packVersion}|${exposure.itemId}`),
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
        const refKey = `${slot.ref.packId}|${slot.ref.packVersion}|${slot.ref.itemId}`
        const assisted = attempt.assistance.length > 0 || foreignSessionByRef.has(refKey)
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
