import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import samplePack from '../fixtures/sample-pack.json'
import { createDatabase, deleteDatabase, type GaokaoDatabase } from '../../src/data/db'
import { collectMistakes } from '../../src/services/mistakes'
import { enterCurrentSlot, submitAnswer } from '../../src/services/learning'
import type { CoursePack } from '../../src/content/types'

const pack = samplePack as unknown as CoursePack
const profileId = 'gaokao-common-training-v1'
const databases: GaokaoDatabase[] = []

const openDb = async () => {
  const db = createDatabase(`gaokao-mistakes-${crypto.randomUUID()}`)
  await db.open()
  await db.packs.add({ id: pack.id, version: pack.version, status: 'installed', pack, installedAt: new Date().toISOString(), resourcesReady: true })
  databases.push(db)
  return db
}

afterEach(async () => {
  while (databases.length > 0) await deleteDatabase(databases.pop()!)
})

describe('错题本（collectMistakes）', () => {
  it('首答错误入本、订正满分标已订正、首答正确不入本', async () => {
    const db = await openDb()
    const created = await (await import('../../src/services/learning')).createSession({ db, unitId: 'demo-school-club', minutes: 10, profileId })
    if (!created.ok || created.value.kind !== 'session') throw new Error('expected session')
    const session = created.value.session
    const wrongSlot = session.slots[0]!
    const entered = await enterCurrentSlot(db, session.id)
    if (!entered.ok) throw new Error(entered.error.messageZh)
    const wrongItem = pack.items.find((item) => item.id === wrongSlot.ref.itemId)!
    if (wrongItem.kind !== 'choice') throw new Error('expect choice first')
    const wrongOption = wrongItem.options.find((option) => option.id !== wrongItem.answerOptionId)!
    // 第 1 题答错
    await submitAnswer(db, { id: 'm-wrong', sessionId: session.id, slotId: wrongSlot.id, expectedRevision: entered.value.revision, answer: { kind: 'choice', optionId: wrongOption.id } })
    let rows = await collectMistakes(db, profileId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ itemId: wrongItem.id, corrected: false })
    // 订正满分 → corrected
    await (await import('../../src/services/learning')).correctAnswer(db, { id: 'm-fix', sessionId: session.id, slotId: wrongSlot.id, expectedRevision: 2, answer: { kind: 'choice', optionId: wrongItem.answerOptionId } })
    rows = await collectMistakes(db, profileId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.corrected).toBe(true)
  })

  it('包卸载（不在已安装集合）后错题不再列出，避免给出无法重练的入口', async () => {
    const db = await openDb()
    const created = await (await import('../../src/services/learning')).createSession({ db, unitId: 'demo-school-club', minutes: 10, profileId })
    if (!created.ok || created.value.kind !== 'session') throw new Error('expected session')
    const entered = await enterCurrentSlot(db, created.value.session.id)
    if (!entered.ok) throw new Error(entered.error.messageZh)
    const slot = created.value.session.slots[0]!
    const item = pack.items.find((candidate) => candidate.id === slot.ref.itemId)!
    if (item.kind !== 'choice') throw new Error('expect choice')
    const wrong = item.options.find((option) => option.id !== item.answerOptionId)!
    await submitAnswer(db, { id: 'm-2', sessionId: created.value.session.id, slotId: slot.id, expectedRevision: entered.value.revision, answer: { kind: 'choice', optionId: wrong.id } })
    expect((await collectMistakes(db, profileId)).length).toBe(1)
    await db.packs.clear()
    expect(await collectMistakes(db, profileId)).toEqual([])
  })
})
