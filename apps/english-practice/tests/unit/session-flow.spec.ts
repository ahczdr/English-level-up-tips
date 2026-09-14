import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import samplePack from '../fixtures/sample-pack.json'
import { createDatabase, deleteDatabase, type GaokaoDatabase } from '../../src/data/db'
import type { CoursePack } from '../../src/content/types'
import {
  createSession,
  enterCurrentSlot,
  revealHint,
  submitAnswer,
  skipSlot,
  type LearningClock,
} from '../../src/services/learning'
import { getSessionSummary, setCurrentIndex } from '../../src/services/sessionFlow'

const pack = samplePack as unknown as CoursePack
const clock: LearningClock = { now: () => new Date('2026-09-11T00:00:00.000Z') }
const databases: GaokaoDatabase[] = []

const openDb = async () => {
  const db = createDatabase(`gaokao-flow-${crypto.randomUUID()}`)
  await db.open()
  await db.packs.add({ id: pack.id, version: pack.version, status: 'installed', pack, installedAt: clock.now().toISOString(), resourcesReady: true })
  databases.push(db)
  return db
}

const makeSession = async (db: GaokaoDatabase, id: string, minutes: number) => {
  const created = await createSession({ db, unitId: 'demo-school-club', minutes, profileId: 'gaokao-common-training-v1', clock, idGenerator: () => id })
  if (!created.ok || created.value.kind !== 'session') throw new Error('expected session')
  return created.value.session
}

afterEach(async () => {
  while (databases.length > 0) await deleteDatabase(databases.pop()!)
})

describe('T05 会话推进服务', () => {
  it('推进 currentIndex 并持久化 revision 变化', async () => {
    const db = await openDb()
    const session = await makeSession(db, 'flow-1', 2)
    const moved = await setCurrentIndex(db, 'flow-1', 1, session.revision)
    expect(moved.ok).toBe(true)
    if (!moved.ok) throw new Error(moved.error.messageZh)
    expect(moved.value.currentIndex).toBe(1)
    expect(moved.value.revision).toBe(session.revision + 1)
    const stored = await db.sessions.get('flow-1')
    expect(stored?.currentIndex).toBe(1)
    expect(stored?.revision).toBe(session.revision + 1)
  })

  it('索引不变时保持幂等，不额外增加 revision', async () => {
    const db = await openDb()
    const session = await makeSession(db, 'flow-2', 2)
    const unchanged = await setCurrentIndex(db, 'flow-2', 0, session.revision)
    expect(unchanged.ok).toBe(true)
    if (!unchanged.ok) throw new Error(unchanged.error.messageZh)
    expect(unchanged.value.revision).toBe(session.revision)
  })

  it('过期 revision 与未知记录返回错误', async () => {
    const db = await openDb()
    const session = await makeSession(db, 'flow-3', 2)
    const stale = await setCurrentIndex(db, 'flow-3', 1, session.revision + 100)
    expect(stale).toMatchObject({ ok: false, error: { code: 'STALE_SESSION' } })
    const missing = await setCurrentIndex(db, 'missing', 0, 0)
    expect(missing).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })

  it('越界索引被拒绝且不写入', async () => {
    const db = await openDb()
    const session = await makeSession(db, 'flow-4', 2)
    const outOfRange = await setCurrentIndex(db, 'flow-4', 5, session.revision)
    expect(outOfRange).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    const stored = await db.sessions.get('flow-4')
    expect(stored?.currentIndex).toBe(0)
    expect(stored?.revision).toBe(session.revision)
  })
})

describe('T05 单元结束统计服务', () => {
  it('区分独立首次完成与提示后完成', async () => {
    const db = await openDb()
    const session = await makeSession(db, 'flow-5', 2)
    const entered = await enterCurrentSlot(db, 'flow-5', clock)
    if (!entered.ok) throw new Error(entered.error.messageZh)
    const first = await submitAnswer(db, { id: 'cmd-1', sessionId: 'flow-5', slotId: session.slots[0].id, expectedRevision: entered.value.revision, answer: { kind: 'choice', optionId: 'a' } }, clock)
    if (!first.ok) throw new Error(first.error.messageZh)
    const advanced = await setCurrentIndex(db, 'flow-5', 1, first.value.revision)
    if (!advanced.ok) throw new Error(advanced.error.messageZh)
    const secondEntered = await enterCurrentSlot(db, 'flow-5', clock)
    if (!secondEntered.ok) throw new Error(secondEntered.error.messageZh)
    const hinted = await revealHint(db, { sessionId: 'flow-5', slotId: session.slots[1].id, hint: 'translation', expectedRevision: secondEntered.value.revision }, clock)
    if (!hinted.ok) throw new Error(hinted.error.messageZh)
    const second = await submitAnswer(db, { id: 'cmd-2', sessionId: 'flow-5', slotId: session.slots[1].id, expectedRevision: hinted.value.revision, answer: { kind: 'order', tokenIds: ['t1', 't2', 't3', 't4', 't5'] } }, clock)
    if (!second.ok) throw new Error(second.error.messageZh)
    const summary = await getSessionSummary(db, 'flow-5')
    expect(summary.ok).toBe(true)
    if (!summary.ok) throw new Error(summary.error.messageZh)
    expect(summary.value).toEqual({
      totalSlots: 2,
      submittedSlots: 2,
      skippedSlots: 0,
      independentFirst: 1,
      assistedFirst: 1,
      failedFirst: 0,
      pending: 0,
    })
  })

  it('首次未通过与跳过分别计数，订正不改变首次结果', async () => {
    const db = await openDb()
    const session = await makeSession(db, 'flow-6', 2)
    const entered = await enterCurrentSlot(db, 'flow-6', clock)
    if (!entered.ok) throw new Error(entered.error.messageZh)
    const wrong = await submitAnswer(db, { id: 'cmd-3', sessionId: 'flow-6', slotId: session.slots[0].id, expectedRevision: entered.value.revision, answer: { kind: 'choice', optionId: 'b' } }, clock)
    if (!wrong.ok) throw new Error(wrong.error.messageZh)
    const skipped = await skipSlot(db, { sessionId: 'flow-6', slotId: session.slots[1].id, expectedRevision: wrong.value.revision }, clock)
    if (!skipped.ok) throw new Error(skipped.error.messageZh)
    const summary = await getSessionSummary(db, 'flow-6')
    expect(summary.ok).toBe(true)
    if (!summary.ok) throw new Error(summary.error.messageZh)
    expect(summary.value).toMatchObject({
      totalSlots: 2,
      submittedSlots: 1,
      skippedSlots: 1,
      independentFirst: 0,
      assistedFirst: 0,
      failedFirst: 1,
      pending: 0,
    })
  })

  it('未完成题目计入待答，未知记录返回 NOT_FOUND', async () => {
    const db = await openDb()
    await makeSession(db, 'flow-7', 2)
    const summary = await getSessionSummary(db, 'flow-7')
    expect(summary.ok).toBe(true)
    if (!summary.ok) throw new Error(summary.error.messageZh)
    expect(summary.value).toMatchObject({ pending: 2 })
    const missing = await getSessionSummary(db, 'missing')
    expect(missing).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })
})
