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

describe('错题本过滤（ReviewPage 集成）', () => {
  it('默认只显示待订正；切换已订正后显示订正记录', async () => {
    const { flushPromises, mount } = await import('@vue/test-utils')
    const { createRouter, createWebHashHistory } = await import('vue-router')
    const ReviewPage = (await import('../../src/features/review/ReviewPage.vue')).default
    const db = await openDb()
    const created = await (await import('../../src/services/learning')).createSession({ db, unitId: 'demo-school-club', minutes: 10, profileId })
    if (!created.ok || created.value.kind !== 'session') throw new Error('expected session')
    const session = created.value.session
    // 第一题答错后订正（已订正）；第二题答错（待订正）
    const entered = await enterCurrentSlot(db, session.id)
    if (!entered.ok) throw new Error(entered.error.messageZh)
    const slot1 = session.slots[0]!
    const item1 = pack.items.find((candidate) => candidate.id === slot1.ref.itemId)!
    if (item1.kind !== 'choice') throw new Error('expect choice')
    const wrong1 = item1.options.find((option) => option.id !== item1.answerOptionId)!
    await submitAnswer(db, { id: 'f-1', sessionId: session.id, slotId: slot1.id, expectedRevision: entered.value.revision, answer: { kind: 'choice', optionId: wrong1.id } })
    await (await import('../../src/services/learning')).correctAnswer(db, { id: 'f-1c', sessionId: session.id, slotId: slot1.id, expectedRevision: 2, answer: { kind: 'choice', optionId: item1.answerOptionId } })
    const { setCurrentIndex } = await import('../../src/services/sessionFlow')
    const moved = await setCurrentIndex(db, session.id, 1, 3)
    if (!moved.ok) throw new Error(moved.error.messageZh)
    const entered2 = await enterCurrentSlot(db, session.id)
    if (!entered2.ok) throw new Error(entered2.error.messageZh)
    const slot2 = entered2.value.slots[1]!
    const item2 = pack.items.find((candidate) => candidate.id === slot2.ref.itemId)!
    const answer2 = item2.kind === 'choice'
      ? { kind: 'choice' as const, optionId: item2.options.find((option) => option.id !== item2.answerOptionId)!.id }
      : item2.kind === 'order'
        ? { kind: 'order' as const, tokenIds: [...item2.tokens].reverse().map((token) => token.id) }
        : null
    if (answer2 === null) throw new Error('expect choice or order at slot 2')
    await submitAnswer(db, { id: 'f-2', sessionId: session.id, slotId: slot2.id, expectedRevision: entered2.value.revision, answer: answer2 })

    const router = createRouter({ history: createWebHashHistory(), routes: [{ path: '/review', component: ReviewPage }] })
    await router.push('/review')
    await router.isReady()
    const page = mount(ReviewPage, { props: { db }, global: { plugins: [router] } })
    await flushPromises()
    await flushPromises()
    await flushPromises()
    const text = () => page.text()
    expect(await text()).toContain('错题本（2）')
    expect(await text()).toContain('待订正')
    // 默认 open：列表里只有未订正那行（第二题）；第一题的行不在列表
    const rows = page.findAll('.mistake-row')
    expect(rows.length).toBe(1)
    // 切到 done
    await page.findAll('.mistake-filter-option')[1]!.trigger('click')
    await flushPromises()
    expect(page.findAll('.mistake-row').length).toBe(1)
    // 切到 all
    await page.findAll('.mistake-filter-option')[2]!.trigger('click')
    await flushPromises()
    expect(page.findAll('.mistake-row').length).toBe(2)
    page.unmount()
  })
})

describe('只练错题（createSession itemIds 子集 + 分组按钮）', () => {
  it('分组按钮创建的会话只含该单元未订正错题', async () => {
    const { flushPromises, mount } = await import('@vue/test-utils')
    const { createRouter, createWebHashHistory } = await import('vue-router')
    const ReviewPage = (await import('../../src/features/review/ReviewPage.vue')).default
    const db = await openDb()
    const created = await (await import('../../src/services/learning')).createSession({ db, unitId: 'demo-school-club', minutes: 10, profileId })
    if (!created.ok || created.value.kind !== 'session') throw new Error('expected session')
    const session = created.value.session
    const entered = await enterCurrentSlot(db, session.id)
    if (!entered.ok) throw new Error(entered.error.messageZh)
    // 第 1 题答错并订正（已订正）；第 2 题答错（待订正）
    const slot1 = session.slots[0]!
    const item1 = pack.items.find((candidate) => candidate.id === slot1.ref.itemId)!
    if (item1.kind !== 'choice') throw new Error('expect choice')
    await submitAnswer(db, { id: 's-1', sessionId: session.id, slotId: slot1.id, expectedRevision: entered.value.revision, answer: { kind: 'choice', optionId: item1.options.find((option) => option.id !== item1.answerOptionId)!.id } })
    const { correctAnswer } = await import('../../src/services/learning')
    const { setCurrentIndex } = await import('../../src/services/sessionFlow')
    await correctAnswer(db, { id: 's-1c', sessionId: session.id, slotId: slot1.id, expectedRevision: 2, answer: { kind: 'choice', optionId: item1.answerOptionId } })
    const moved = await setCurrentIndex(db, session.id, 1, 3)
    if (!moved.ok) throw new Error(moved.error.messageZh)
    const entered2 = await enterCurrentSlot(db, session.id)
    if (!entered2.ok) throw new Error(entered2.error.messageZh)
    const slot2 = entered2.value.slots[1]!
    const item2 = pack.items.find((candidate) => candidate.id === slot2.ref.itemId)!
    const answer2 = item2.kind === 'choice'
      ? { kind: 'choice' as const, optionId: item2.options.find((option) => option.id !== item2.answerOptionId)!.id }
      : item2.kind === 'order'
        ? { kind: 'order' as const, tokenIds: [...item2.tokens].reverse().map((token) => token.id) }
        : null
    if (answer2 === null) throw new Error('expect choice or order')
    await submitAnswer(db, { id: 's-2', sessionId: session.id, slotId: slot2.id, expectedRevision: entered2.value.revision, answer: answer2 })

    const router = createRouter({ history: createWebHashHistory(), routes: [
      { path: '/review', component: ReviewPage },
      { path: '/session/:id', component: { template: '<div />' } },
    ] })
    await router.push('/review')
    await router.isReady()
    const page = mount(ReviewPage, { props: { db }, global: { plugins: [router] } })
    await flushPromises()
    await flushPromises()
    await flushPromises()
    const btn = page.findAll('.review-row-action').find((button) => button.text().includes('只练错题'))
    expect(btn?.text()).toContain('只练错题（1）')
    await btn!.trigger('click')
    await flushPromises()
    await flushPromises()
    expect(router.currentRoute.value.path).toMatch(/^\/session\//)
    const last = (await db.sessions.toArray()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]!
    expect(last.slots).toHaveLength(1)
    expect(last.slots[0]!.ref.itemId).toBe(item2.id)
    page.unmount()
  })
})
