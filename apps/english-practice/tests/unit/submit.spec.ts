import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import samplePack from '../fixtures/sample-pack.json'
import { createDatabase, deleteDatabase, type GaokaoDatabase } from '../../src/data/db'
import { createSession, correctAnswer, enterCurrentSlot, revealHint, skipSlot, submitAnswer, type LearningClock } from '../../src/services/learning'
import type { CoursePack } from '../../src/content/types'

const pack = samplePack as unknown as CoursePack
const clock: LearningClock = { now: () => new Date('2026-09-10T00:00:00.000Z') }
const databases: GaokaoDatabase[] = []

const openDb = async (id: string = crypto.randomUUID()) => {
  const db = createDatabase(id.startsWith('gaokao-') ? id : `gaokao-submit-${id}`)
  await db.open()
  await db.packs.add({ id: pack.id, version: pack.version, status: 'installed', pack, installedAt: clock.now().toISOString(), resourcesReady: true })
  databases.push(db)
  return db
}

const makeSession = async (db: GaokaoDatabase, id: string) => {
  const result = await createSession({ db, unitId: 'demo-school-club', minutes: 2, profileId: 'gaokao-common-training-v1', clock, idGenerator: () => id })
  if (!result.ok || result.value.kind !== 'session') throw new Error('expected session')
  const entered = await enterCurrentSlot(db, id, clock)
  if (!entered.ok) throw new Error(entered.error.messageZh)
  return entered.value
}

afterEach(async () => {
  while (databases.length > 0) await deleteDatabase(databases.pop()!)
})

describe('T04 transactional submit actions', () => {
  it('is idempotent by command id and rejects a second first answer', async () => {
    const db = await openDb()
    const session = await makeSession(db, 'submit-1')
    const slot = session.slots[0]
    const command = { id: 'c1', sessionId: session.id, slotId: slot.id, expectedRevision: session.revision, answer: { kind: 'choice' as const, optionId: 'a' } }
    const first = await submitAnswer(db, command, clock)
    expect(first.ok).toBe(true)
    const replay = await submitAnswer(db, command, clock)
    expect(replay).toEqual(first)
    const second = await submitAnswer(db, { ...command, id: 'c2', expectedRevision: session.revision + 1 }, clock)
    expect(second).toMatchObject({ ok: false, error: { code: 'ALREADY_SUBMITTED' } })
    expect(await db.attempts.count()).toBe(1)
    expect((await db.sessions.get(session.id))?.revision).toBe(session.revision + 1)
  })

  it('keeps the first result and review schedule when a correction is submitted', async () => {
    const db = await openDb()
    const session = await makeSession(db, 'submit-2')
    const slot = session.slots[0]
    const wrong = await submitAnswer(db, { id: 'wrong', sessionId: session.id, slotId: slot.id, expectedRevision: session.revision, answer: { kind: 'choice', optionId: 'b' } }, clock)
    expect(wrong.ok).toBe(true)
    const before = await db.reviewStates.toArray()
    const corrected = await correctAnswer(db, { id: 'correction', sessionId: session.id, slotId: slot.id, expectedRevision: session.revision + 1, answer: { kind: 'choice', optionId: 'a' } }, clock)
    expect(corrected).toMatchObject({ ok: true, value: { phase: 'correction', grade: { earned: 1 } } })
    expect(await db.reviewStates.toArray()).toEqual(before)
    const first = await db.attempts.get('wrong')
    expect((first?.payload as { phase: string; grade: { earned: number } }).grade.earned).toBe(0)
  })

  it('records assistance before grading and never schedules a hint-assisted pass independently', async () => {
    const db = await openDb()
    const session = await makeSession(db, 'submit-3')
    const slot = session.slots[0]
    const hinted = await revealHint(db, { sessionId: session.id, slotId: slot.id, hint: 'translation', expectedRevision: session.revision }, clock)
    expect(hinted).toMatchObject({ ok: true, value: { revision: session.revision + 1 } })
    const submitted = await submitAnswer(db, { id: 'hinted', sessionId: session.id, slotId: slot.id, expectedRevision: session.revision + 1, answer: { kind: 'choice', optionId: 'a' } }, clock)
    expect(submitted).toMatchObject({ ok: true, value: { assistance: ['translation'] } })
    expect((await db.reviewStates.toArray())[0].data).toMatchObject({ stage: 0, lapses: 1 })
  })

  it('skipping changes only the slot and does not create a review state', async () => {
    const db = await openDb()
    const session = await makeSession(db, 'submit-4')
    const skipped = await skipSlot(db, { sessionId: session.id, slotId: session.slots[0].id, expectedRevision: session.revision }, clock)
    expect(skipped.ok && skipped.value.slots[0].state).toBe('skipped')
    expect(await db.reviewStates.count()).toBe(0)
  })

  it('returns stale revision and rolls back a review-state failure', async () => {
    const db = await openDb()
    const session = await makeSession(db, 'submit-5')
    const slot = session.slots[0]
    const stale = await submitAnswer(db, { id: 'stale', sessionId: session.id, slotId: slot.id, expectedRevision: 0, answer: { kind: 'choice', optionId: 'a' } }, clock)
    expect(stale).toMatchObject({ ok: false, error: { code: 'STALE_SESSION' } })
    const originalPut = db.reviewStates.put.bind(db.reviewStates)
    db.reviewStates.put = (async () => { throw new Error('injected review failure') }) as unknown as typeof db.reviewStates.put
    const failed = await submitAnswer(db, { id: 'rollback', sessionId: session.id, slotId: slot.id, expectedRevision: session.revision, answer: { kind: 'choice', optionId: 'a' } }, clock)
    db.reviewStates.put = originalPut
    expect(failed).toMatchObject({ ok: false, error: { code: 'STORAGE_FAILED' } })
    expect(await db.attempts.count()).toBe(0)
    expect((await db.sessions.get(session.id))?.revision).toBe(session.revision)
    expect(await db.reviewStates.count()).toBe(0)
  })

  it('serializes two connections competing for the same first submission', async () => {
    const db = await openDb('gaokao-submit-concurrent')
    const secondDb = createDatabase('gaokao-submit-concurrent')
    await secondDb.open()
    databases.push(secondDb)
    const session = await makeSession(db, 'submit-concurrent')
    const slot = session.slots[0]
    const results = await Promise.all([
      submitAnswer(db, { id: 'concurrent-a', sessionId: session.id, slotId: slot.id, expectedRevision: session.revision, answer: { kind: 'choice', optionId: 'a' } }, clock),
      submitAnswer(secondDb, { id: 'concurrent-b', sessionId: session.id, slotId: slot.id, expectedRevision: session.revision, answer: { kind: 'choice', optionId: 'a' } }, clock),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok).map((result) => !result.ok && result.error.code)).toContain('STALE_SESSION')
    expect(await db.attempts.count()).toBe(1)
  })
})
