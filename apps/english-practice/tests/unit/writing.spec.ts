import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createRouter, createWebHashHistory, type RouterHistory } from 'vue-router'
import samplePack from '../fixtures/sample-pack.json'
import WritingPage from '../../src/features/writing/WritingPage.vue'
import SessionPage from '../../src/features/practice/SessionPage.vue'
import TodayPage from '../../src/features/today/TodayPage.vue'
import OnboardingPage from '../../src/features/onboarding/OnboardingPage.vue'
import LearnPage from '../../src/features/learn/LearnPage.vue'
import type { CoursePack, WritingItem } from '../../src/content/types'
import { createDatabase, deleteDatabase, type GaokaoDatabase } from '../../src/data/db'
import { createSession } from '../../src/services/learning'
import type { Session } from '../../src/data/migrations'
import { countEnglishWords, finalizeWriting, listWritingVersions, loadWritingDraft, saveWritingDraft } from '../../src/services/writing'

const pack = samplePack as unknown as CoursePack
const invitation = pack.items.find((item) => item.id === 'writing-invitation-a') as WritingItem
const continuation = pack.items.find((item) => item.id === 'writing-continuation-a') as WritingItem

const wrappers: VueWrapper[] = []
const histories: RouterHistory[] = []
const databases: GaokaoDatabase[] = []

const openDb = (selectedPack: CoursePack = pack) => {
  const db = createDatabase(`gaokao-writing-${crypto.randomUUID()}`)
  return db.open().then(async () => {
    await db.packs.add({ id: selectedPack.id, version: selectedPack.version, status: 'installed', pack: selectedPack, installedAt: new Date().toISOString(), resourcesReady: true })
    databases.push(db)
    return db
  })
}

const writingOnlyPack = (): CoursePack => {
  const custom = structuredClone(pack)
  custom.units = [{ ...custom.units[0], id: 'unit-writing', itemIds: ['writing-invitation-a'], familyIds: ['application-invitation'], prerequisiteSkillIds: [] }]
  return custom
}

const settle = async () => {
  for (let round = 0; round < 5; round += 1) {
    await flushPromises()
    await new Promise((resolve) => { setTimeout(resolve, 0) })
  }
  await new Promise((resolve) => { setTimeout(resolve, 25) })
  await flushPromises()
}

const waitMs = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms) })

const makeRouter = () => {
  const history = createWebHashHistory()
  histories.push(history)
  return createRouter({
    history,
    routes: [
      { path: '/', redirect: '/today' },
      { path: '/today', name: 'today', component: TodayPage },
      { path: '/onboarding', name: 'onboarding', component: OnboardingPage },
      { path: '/learn', name: 'learn', component: LearnPage },
      { path: '/session/:id', name: 'session', component: SessionPage },
      { path: '/:pathMatch(.*)*', redirect: '/today' },
    ],
  })
}

const makeSession = async (db: GaokaoDatabase, id: string, minutes = 10, unitId = 'unit-writing', source: CoursePack = pack) => {
  void source
  const created = await createSession({ db, unitId, minutes, profileId: 'gaokao-common-training-v1', idGenerator: () => id })
  if (!created.ok || created.value.kind !== 'session') throw new Error('expected session')
  return created.value.session
}

const mountPage = async (db: GaokaoDatabase, session: Session, item: WritingItem) => {
  const wrapper = mount(WritingPage, {
    props: {
      db,
      sessionId: session.id,
      slotId: session.slots[0]!.id,
      item,
      sessionRevision: session.revision,
    },
  })
  wrappers.push(wrapper)
  await settle()
  return wrapper
}

const mountSessionPage = async (db: GaokaoDatabase, sessionId: string) => {
  const router = makeRouter()
  await router.push(`/session/${sessionId}`)
  await router.isReady()
  const wrapper = mount(SessionPage, { props: { db, sessionId }, global: { plugins: [router] } })
  wrappers.push(wrapper)
  await settle()
  return wrapper
}

const findButton = (wrapper: VueWrapper, text: string) => wrapper.findAll('button').find((button) => button.text() === text)
const clickButton = async (wrapper: VueWrapper, text: string) => {
  const button = findButton(wrapper, text)
  if (!button) throw new Error(`未找到按钮：${text}`)
  await button.trigger('click')
}

afterEach(async () => {
  while (wrappers.length > 0) wrappers.pop()!.unmount()
  for (const history of histories.splice(0)) history.destroy()
  window.location.hash = ''
  while (databases.length > 0) await deleteDatabase(databases.pop()!)
  vi.restoreAllMocks()
})

describe('英文单词计数', () => {
  it('撇号与连字符内部连接计一词，数字不计', () => {
    expect(countEnglishWords("It's a well-known fact. I have 2 cats and 203 books.")).toBe(9)
    expect(countEnglishWords('state-of-the-art')).toBe(1)
  })

  it('纯数字与空文本计零', () => {
    expect(countEnglishWords('203 45 6.5')).toBe(0)
    expect(countEnglishWords('')).toBe(0)
    expect(countEnglishWords('2nd place')).toBe(1)
  })

  it('左弯撇号（U+2018）内部连接同样计一词', () => {
    expect(countEnglishWords("don‘t stop")).toBe(2)
    expect(countEnglishWords('‘Twas the night')).toBe(3)
  })
})

describe('写作草稿保存', () => {
  it('首次保存 revision 0→1 并可回读', async () => {
    const db = await openDb()
    const saved = await saveWritingDraft({ db, sessionId: 'w-1', itemId: invitation.id, content: 'Dear Alex,', outline: 'greet', checklist: ['写明邀请目的'], expectedRevision: 0 })
    expect(saved.ok).toBe(true)
    if (saved.ok) expect(saved.value.revision).toBe(1)
    const loaded = await loadWritingDraft({ db, sessionId: 'w-1', itemId: invitation.id })
    expect(loaded.ok && loaded.value?.content).toBe('Dear Alex,')
    expect(loaded.ok && loaded.value?.checklist).toEqual(['写明邀请目的'])
  })

  it('两页并发编辑：旧 revision 写入被拒绝，重载后可继续', async () => {
    const db = await openDb()
    await saveWritingDraft({ db, sessionId: 'w-2', itemId: invitation.id, content: 'v1', outline: '', checklist: [], expectedRevision: 0 })
    // 两页都基于 revision 1
    const pageA = await saveWritingDraft({ db, sessionId: 'w-2', itemId: invitation.id, content: 'A page', outline: '', checklist: [], expectedRevision: 1 })
    expect(pageA.ok).toBe(true)
    const pageB = await saveWritingDraft({ db, sessionId: 'w-2', itemId: invitation.id, content: 'B page', outline: '', checklist: [], expectedRevision: 1 })
    expect(pageB.ok).toBe(false)
    if (!pageB.ok) expect(pageB.error.code).toBe('STALE_SESSION')
    // B 重载后基于最新 revision 继续
    const reloaded = await loadWritingDraft({ db, sessionId: 'w-2', itemId: invitation.id })
    expect(reloaded.ok && reloaded.value?.revision).toBe(2)
    const again = await saveWritingDraft({ db, sessionId: 'w-2', itemId: invitation.id, content: 'B page v2', outline: '', checklist: [], expectedRevision: 2 })
    expect(again.ok).toBe(true)
  })

  it('同页快速连存串行保序', async () => {
    const db = await openDb()
    await saveWritingDraft({ db, sessionId: 'w-3', itemId: invitation.id, content: 'first', outline: '', checklist: [], expectedRevision: 0 })
    const first = saveWritingDraft({ db, sessionId: 'w-3', itemId: invitation.id, content: 'second', outline: '', checklist: [], expectedRevision: 1 })
    const second = saveWritingDraft({ db, sessionId: 'w-3', itemId: invitation.id, content: 'third', outline: '', checklist: [], expectedRevision: 2 })
    const results = await Promise.all([first, second])
    expect(results.every((result) => result.ok)).toBe(true)
    const loaded = await loadWritingDraft({ db, sessionId: 'w-3', itemId: invitation.id })
    expect(loaded.ok && loaded.value?.content).toBe('third')
    expect(loaded.ok && loaded.value?.revision).toBe(3)
  })
})

describe('finalizeWriting 版本冻结', () => {
  it('初稿冻结为 v1：slot submitted、revision 推进、不产生 Attempt', async () => {
    const db = await openDb(writingOnlyPack())
    const session = await makeSession(db, 'w-4')
    await saveWritingDraft({ db, sessionId: session.id, itemId: invitation.id, content: 'Dear Alex, please come.', outline: '', checklist: [], expectedRevision: 0 })
    const result = await finalizeWriting({ db, sessionId: session.id, slotId: session.slots[0]!.id, expectedRevision: session.revision })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.version).toBe(1)
    const reloaded = await db.sessions.get(session.id)
    expect(reloaded?.slots[0]?.state).toBe('submitted')
    expect(reloaded?.revision).toBe(session.revision + 1)
    expect(await db.attempts.count()).toBe(0)
    const versions = await listWritingVersions({ db, sessionId: session.id, itemId: invitation.id })
    expect(versions).toHaveLength(1)
    expect(versions[0]?.content).toBe('Dear Alex, please come.')
  })

  it('修改稿追加 v2，首稿内容原样保留；重开后两版本都在', async () => {
    const db = await openDb(writingOnlyPack())
    const session = await makeSession(db, 'w-5')
    await saveWritingDraft({ db, sessionId: session.id, itemId: invitation.id, content: 'draft one body', outline: '', checklist: [], expectedRevision: 0 })
    await finalizeWriting({ db, sessionId: session.id, slotId: session.slots[0]!.id, expectedRevision: session.revision })
    await saveWritingDraft({ db, sessionId: session.id, itemId: invitation.id, content: 'draft two body improved', outline: '', checklist: [], expectedRevision: 1 })
    const second = await finalizeWriting({ db, sessionId: session.id, slotId: session.slots[0]!.id, expectedRevision: session.revision + 1 })
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.value.version).toBe(2)
    const versions = await listWritingVersions({ db, sessionId: session.id, itemId: invitation.id })
    expect(versions).toHaveLength(2)
    expect(versions[0]?.content).toBe('draft one body')
    expect(versions[1]?.content).toBe('draft two body improved')
  })

  it('session revision 过期返回 STALE_SESSION', async () => {
    const db = await openDb(writingOnlyPack())
    const session = await makeSession(db, 'w-6')
    const result = await finalizeWriting({ db, sessionId: session.id, slotId: session.slots[0]!.id, expectedRevision: session.revision - 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('STALE_SESSION')
  })
})

describe('WritingPage 写作视图', () => {
  it('渲染审题要求、提纲、正文与自评表；续写展示两个段首句', async () => {
    const db = await openDb(writingOnlyPack())
    const session = await makeSession(db, 'w-7')
    const page = await mountPage(db, session, continuation)
    expect(page.text()).toContain('保留原文人物')
    expect(page.text()).toContain('Tom invited Lily to sit beside him.')
    expect(page.text()).toContain('When the meeting ended, Lily stayed for a moment.')
    expect(page.findAll('textarea').length).toBeGreaterThanOrEqual(2)
    expect(page.text()).toContain('人物和时间一致')
    const invite = await mountPage(db, await makeSession(db, 'w-7b', 10, 'unit-writing'), invitation)
    expect(invite.text()).toContain('邀请朋友')
    expect(invite.text()).not.toContain('Tom invited Lily')
  })

  it('输入 500ms 自动保存并显示信息性字数', async () => {
    const db = await openDb(writingOnlyPack())
    const session = await makeSession(db, 'w-8')
    const page = await mountPage(db, session, invitation)
    const body = page.findAll('textarea').at(-1)!
    await body.setValue("It's a well-known fact. I have 2 cats and 203 books.")
    expect(page.find('.writing-count').text()).toContain('9 词')
    await waitMs(800)
    await settle()
    const loaded = await loadWritingDraft({ db, sessionId: session.id, itemId: invitation.id })
    expect(loaded.ok && loaded.value?.revision).toBe(1)
    expect(page.text()).toContain('已保存')
  })

  it('存储失败时保留文本并出现复制按钮', async () => {
    const db = await openDb(writingOnlyPack())
    const session = await makeSession(db, 'w-9')
    const page = await mountPage(db, session, invitation)
    const putSpy = vi.spyOn(db.drafts, 'put').mockRejectedValueOnce(new Error('quota'))
    const body = page.findAll('textarea').at(-1)!
    await body.setValue('persistent text')
    await waitMs(800)
    await settle()
    expect(putSpy).toHaveBeenCalled()
    expect(page.text()).toContain('保存失败')
    expect(findButton(page, '复制正文')).toBeTruthy()
    expect((page.findAll('textarea').at(-1)!.element as HTMLTextAreaElement).value).toBe('persistent text')
  })

  it('提交初稿先冲刷未落盘正文（无需等 500ms）', async () => {
    const db = await openDb(writingOnlyPack())
    const session = await makeSession(db, 'w-10')
    const page = await mountPage(db, session, invitation)
    const body = page.findAll('textarea').at(-1)!
    await body.setValue('flushed immediately')
    await clickButton(page, '提交初稿')
    await settle()
    const versions = await listWritingVersions({ db, sessionId: session.id, itemId: invitation.id })
    expect(versions[0]?.content).toBe('flushed immediately')
    expect(page.emitted('finalized')).toHaveLength(1)
    expect(page.text()).toContain('已提交')
  })

  it('范文显式请求记录 model-answer 辅助并展示范文', async () => {
    const db = await openDb(writingOnlyPack())
    const session = await makeSession(db, 'w-11')
    const page = await mountPage(db, session, invitation)
    await clickButton(page, '查看范文')
    await settle()
    expect(page.text()).toContain('I would like to invite you')
    const reloaded = await db.sessions.get(session.id)
    expect(reloaded?.slots[0]?.assistance.includes('model-answer')).toBe(true)
  })

  it('自动保存失败时提交被中止：不冻结旧稿、slot 不 submitted', async () => {
    const db = await openDb(writingOnlyPack())
    const session = await makeSession(db, 'w-15')
    const page = await mountPage(db, session, invitation)
    // 第一次自动保存成功落盘
    await page.findAll('textarea').at(-1)!.setValue('older draft text')
    await waitMs(800)
    await settle()
    // 随后存储故障：finalize 前的冲刷必须失败并中止提交
    vi.spyOn(db.drafts, 'put').mockRejectedValueOnce(new Error('quota'))
    await page.findAll('textarea').at(-1)!.setValue('newer unsaved text')
    await clickButton(page, '提交初稿')
    await settle()
    expect(page.find('.writing-finalize-error').exists()).toBe(true)
    expect(page.find('.writing-finalize-error').text()).toContain('中止提交')
    expect(await listWritingVersions({ db, sessionId: session.id, itemId: invitation.id })).toHaveLength(0)
    const reloaded = await db.sessions.get(session.id)
    expect(reloaded?.slots[0]?.state).not.toBe('submitted')
    expect(reloaded?.revision).toBe(session.revision)
  })

  it('范文已记录时重开组件直接展示且不破坏 revision：提交仍成功', async () => {
    const db = await openDb(writingOnlyPack())
    const session = await makeSession(db, 'w-16')
    const page = await mountPage(db, session, invitation)
    await clickButton(page, '查看范文')
    await settle()
    page.unmount()
    const reopened = await mountPage(db, session, invitation)
    // model-answer 已在 assistance 中：重开即展示范文，不再出现请求按钮
    expect(reopened.text()).toContain('I would like to invite you')
    expect(findButton(reopened, '查看范文')).toBeFalsy()
    await reopened.findAll('textarea').at(-1)!.setValue('submit after rehint')
    await clickButton(reopened, '提交初稿')
    await settle()
    expect(reopened.find('.writing-finalize-error').exists()).toBe(false)
    expect(await listWritingVersions({ db, sessionId: session.id, itemId: invitation.id })).toHaveLength(1)
  })

  it('提交遇 STALE 后自动重同步：再次点击即成功', async () => {
    const db = await openDb(writingOnlyPack())
    const session = await makeSession(db, 'w-17')
    const page = await mountPage(db, session, invitation)
    // 模拟另一页面推进了 session.revision
    await db.sessions.update(session.id, { revision: 7 })
    await clickButton(page, '提交初稿')
    await settle()
    expect(page.find('.writing-finalize-error').text()).toContain('已在其他页面更新')
    expect(await listWritingVersions({ db, sessionId: session.id, itemId: invitation.id })).toHaveLength(0)
    // 本地已重同步到 7：重试直接成功
    await clickButton(page, '提交初稿')
    await settle()
    expect(page.text()).toContain('已提交 1 个版本')
    const reloaded = await db.sessions.get(session.id)
    expect(reloaded?.revision).toBe(8)
    expect(reloaded?.slots[0]?.state).toBe('submitted')
  })

  it('两个版本后展示句段对比', async () => {
    const db = await openDb(writingOnlyPack())
    const session = await makeSession(db, 'w-12')
    const page = await mountPage(db, session, invitation)
    await page.findAll('textarea').at(-1)!.setValue('version one text')
    await clickButton(page, '提交初稿')
    await settle()
    await page.findAll('textarea').at(-1)!.setValue('version two text improved')
    await clickButton(page, '提交修改稿')
    await settle()
    expect(page.text()).toContain('version one text')
    expect(page.text()).toContain('version two text improved')
  })
})

describe('SessionPage 写作接入', () => {
  it('写作项渲染写作视图，提交初稿后可推进且不进入客观成绩', async () => {
    const db = await openDb(writingOnlyPack())
    const session = await makeSession(db, 'w-13', 10)
    const page = await mountSessionPage(db, session.id)
    expect(page.text()).not.toContain('写作任务将在后续任务提供')
    expect(page.findAll('textarea').length).toBeGreaterThan(0)
    await page.findAll('textarea').at(-1)!.setValue('submitted body')
    await clickButton(page, '提交初稿')
    await settle()
    await clickButton(page, '下一题')
    await settle()
    expect(page.text()).toContain('单元结束')
    expect(await db.attempts.count()).toBe(0)
  })

  it('连续输入后立即离开：确认前等待最后一次写入落盘', async () => {
    const db = await openDb(writingOnlyPack())
    const session = await makeSession(db, 'w-14', 10)
    const page = await mountSessionPage(db, session.id)
    await page.findAll('textarea').at(-1)!.setValue('leaving right away')
    // 防抖窗口内（<500ms）点击返回：未保存状态触发确认框
    await clickButton(page, '返回')
    await settle()
    expect(page.text()).toContain('已输入内容会自动保存为草稿')
    await clickButton(page, '确认离开')
    await settle()
    // 离开前 flushPending 已把最后一次输入写入草稿
    const row = await db.drafts.get([session.id, invitation.id])
    expect(row && (JSON.parse(row.content) as { content: string }).content).toBe('leaving right away')
  })
})
