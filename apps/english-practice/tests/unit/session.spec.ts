import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import samplePack from '../fixtures/sample-pack.json'
import { createDatabase, deleteDatabase, type GaokaoDatabase } from '../../src/data/db'
import { invalidatePacks } from '../../src/data/pack-reader'
import { completeSession, createSession, createTodaySession, enterCurrentSlot, loadSession, pauseSession, resumeSession, type LearningClock } from '../../src/services/learning'
import type { CoursePack } from '../../src/content/types'

const databases: GaokaoDatabase[] = []
const clock: LearningClock = { now: () => new Date('2026-09-10T00:00:00.000Z') }
const pack = samplePack as unknown as CoursePack

const openDbWithPack = async (selectedPack: CoursePack = pack) => {
  const db = createDatabase(`gaokao-session-${crypto.randomUUID()}`)
  await db.open()
  await db.packs.add({ id: selectedPack.id, version: selectedPack.version, status: 'installed', pack: selectedPack, installedAt: clock.now().toISOString(), resourcesReady: true })
  databases.push(db)
  return db
}

afterEach(async () => {
  while (databases.length > 0) await deleteDatabase(databases.pop()!)
})

describe('T03 learning sessions', () => {
  it('returns a real empty state without a unit', async () => {
    const db = await openDbWithPack()
    const result = await createSession({ db, unitId: null, minutes: 10, profileId: 'gaokao-common-training-v1', clock, idGenerator: () => 'empty' })
    expect(result).toEqual({ ok: true, value: { kind: 'empty', messageZh: '请选择课程' } })
    expect(await db.sessions.count()).toBe(0)
  })

  it('builds fixed slots in unit order and persists the session', async () => {
    const db = await openDbWithPack()
    const result = await createSession({ db, unitId: 'demo-school-club', minutes: 10, profileId: 'gaokao-common-training-v1', clock, idGenerator: () => 'session-1' })
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'session') throw new Error('expected session')
    expect(result.value.session.slots.map((slot) => slot.ref.itemId)).toEqual([
      'vocab-join-a',
      'order-join-a',
      'grammar-meet-a',
      'reading-location-a',
      'cloze-help-a',
    ])
    expect(result.value.session.slots[0].state).toBe('unseen')
    expect((await loadSession(db, 'session-1')).ok).toBe(true)
  })

  it('persists exposure and answering state exactly once', async () => {
    const db = await openDbWithPack()
    const created = await createSession({ db, unitId: 'demo-school-club', minutes: 2, profileId: 'gaokao-common-training-v1', clock, idGenerator: () => 'session-2' })
    if (!created.ok || created.value.kind !== 'session') throw new Error('expected session')
    const first = await enterCurrentSlot(db, 'session-2', clock)
    expect(first.ok).toBe(true)
    const exposure = await db.exposures.get([pack.id, pack.version, 'vocab-join-a'])
    expect(exposure?.firstSeenSessionId).toBe('session-2')
    const firstSeenAt = exposure?.firstSeenAt
    await enterCurrentSlot(db, 'session-2', clock)
    expect((await db.exposures.get([pack.id, pack.version, 'vocab-join-a']))?.firstSeenAt).toBe(firstSeenAt)
    expect((await db.sessions.get('session-2'))?.slots[0].state).toBe('answering')
  })

  it('pauses and resumes idempotently with revision updates', async () => {
    const db = await openDbWithPack()
    const created = await createSession({ db, unitId: 'demo-school-club', minutes: 2, profileId: 'gaokao-common-training-v1', clock, idGenerator: () => 'session-3' })
    if (!created.ok || created.value.kind !== 'session') throw new Error('expected session')
    const paused = await pauseSession(db, 'session-3', clock)
    if (!paused.ok) throw new Error(paused.error.messageZh)
    expect(paused.value).toMatchObject({ state: 'paused', revision: 1 })
    const pausedAgain = await pauseSession(db, 'session-3', clock)
    if (!pausedAgain.ok) throw new Error(pausedAgain.error.messageZh)
    expect(pausedAgain.value).toMatchObject({ state: 'paused', revision: 1 })
    const resumed = await resumeSession(db, 'session-3', clock)
    if (!resumed.ok) throw new Error(resumed.error.messageZh)
    expect(resumed.value).toMatchObject({ state: 'active', revision: 2 })
  })

  it('does not split a non-adjacent shared resource group', async () => {
    const customPack = structuredClone(pack)
    customPack.items[0].resourceId = 'reading-club'
    customPack.items[1].resourceId = 'continuation-club'
    customPack.items[2].resourceId = 'reading-club'
    customPack.items[3].resourceId = 'continuation-club'
    const db = await openDbWithPack(customPack)
    const result = await createSession({ db, unitId: 'demo-school-club', minutes: 1, profileId: 'gaokao-common-training-v1', clock, idGenerator: () => 'session-group' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INSUFFICIENT_SPACE')
  })

  it('restores session and exposure after closing and reconnecting', async () => {
    const name = `gaokao-reconnect-session-${crypto.randomUUID()}`
    const firstDb = createDatabase(name)
    await firstDb.open()
    await firstDb.packs.add({ id: pack.id, version: pack.version, status: 'installed', pack, installedAt: clock.now().toISOString(), resourcesReady: true })
    const created = await createSession({ db: firstDb, unitId: 'demo-school-club', minutes: 2, profileId: 'gaokao-common-training-v1', clock, idGenerator: () => 'session-reconnect' })
    if (!created.ok || created.value.kind !== 'session') throw new Error('expected session')
    await enterCurrentSlot(firstDb, 'session-reconnect', clock)
    firstDb.close()

    const secondDb = createDatabase(name)
    await secondDb.open()
    databases.push(secondDb)
    expect((await loadSession(secondDb, 'session-reconnect')).ok).toBe(true)
    expect((await secondDb.exposures.get([pack.id, pack.version, 'vocab-join-a']))?.firstSeenSessionId).toBe('session-reconnect')
  })

  it('distinguishes unknown sessions and missing content', async () => {
    const db = await openDbWithPack()
    const unknown = await loadSession(db, 'missing')
    if (unknown.ok) throw new Error('expected missing session')
    expect(unknown.error.code).toBe('NOT_FOUND')
    const created = await createSession({ db, unitId: 'demo-school-club', minutes: 2, profileId: 'gaokao-common-training-v1', clock, idGenerator: () => 'session-4' })
    if (!created.ok || created.value.kind !== 'session') throw new Error('expected session')
    await db.packs.clear()
    // CR3：packs 读缓存按 db 实例缓存——直改表后必须失效缓存，与生产写侧不变量一致
    invalidatePacks(db)
    const missing = await loadSession(db, 'session-4')
    if (missing.ok) throw new Error('expected missing content')
    expect(missing.error.code).toBe('CONTENT_MISSING')
  })
})

describe('CR1 会话完成态与草稿清理', () => {
  it('completeSession 置 completed、幂等并清除该会话残留草稿', async () => {
    const db = await openDbWithPack()
    const created = await createSession({ db, unitId: 'demo-school-club', minutes: 2, profileId: 'gaokao-common-training-v1', clock, idGenerator: () => 'session-done' })
    if (!created.ok || created.value.kind !== 'session') throw new Error('expected session')
    await enterCurrentSlot(db, 'session-done', clock)
    await db.drafts.put({ sessionId: 'session-done', itemId: 'vocab-join-a', updatedAt: clock.now().toISOString(), content: '{"kind":"gaps","values":{}}' })
    const done = await completeSession(db, 'session-done', clock)
    expect(done.ok).toBe(true)
    if (!done.ok) return
    expect(done.value.state).toBe('completed')
    expect(done.value.revision).toBeGreaterThan(created.value.session.revision)
    expect(await db.drafts.count()).toBe(0)
    const again = await completeSession(db, 'session-done', clock)
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.value.revision).toBe(done.value.revision)
    expect(again.value.state).toBe('completed')
  })

  it('其他会话的草稿不受 completeSession 影响', async () => {
    const db = await openDbWithPack()
    const created = await createSession({ db, unitId: 'demo-school-club', minutes: 2, profileId: 'gaokao-common-training-v1', clock, idGenerator: () => 'session-keep' })
    if (!created.ok || created.value.kind !== 'session') throw new Error('expected session')
    await db.drafts.put({ sessionId: 'other-session', itemId: 'vocab-join-a', updatedAt: clock.now().toISOString(), content: '{}' })
    const done = await completeSession(db, 'session-keep', clock)
    expect(done.ok).toBe(true)
    expect(await db.drafts.count()).toBe(1)
  })
})

describe('CR4 今日会话同日冻结竞态', () => {
  it('并发调用只创建一个会话且返回同一 id', async () => {
    const db = await openDbWithPack()
    const [first, second] = await Promise.all([
      createTodaySession({ db, minutes: 5, profileId: 'gaokao-common-training-v1', clock, idGenerator: () => 'race-a' }),
      createTodaySession({ db, minutes: 5, profileId: 'gaokao-common-training-v1', clock, idGenerator: () => 'race-b' }),
    ])
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || first.value.kind !== 'session' || !second.ok || second.value.kind !== 'session') throw new Error('expected sessions')
    expect(second.value.session.id).toBe(first.value.session.id)
    expect(await db.sessions.count()).toBe(1)
  })
})
