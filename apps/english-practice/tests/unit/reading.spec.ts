import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createRouter, createWebHashHistory, type RouterHistory } from 'vue-router'
import samplePack from '../fixtures/sample-pack.json'
import PassagePanel from '../../src/components/PassagePanel.vue'
import FeedbackPanel from '../../src/components/FeedbackPanel.vue'
import SessionPage from '../../src/features/practice/SessionPage.vue'
import OnboardingPage from '../../src/features/onboarding/OnboardingPage.vue'
import LearnPage from '../../src/features/learn/LearnPage.vue'
import TodayPage from '../../src/features/today/TodayPage.vue'
import type { Attempt } from '../../src/services/learning'
import { createSession, enterCurrentSlot } from '../../src/services/learning'
import type { CoursePack, Evidence, Resource } from '../../src/content/types'
import { createDatabase, deleteDatabase, type GaokaoDatabase } from '../../src/data/db'

const pack = samplePack as unknown as CoursePack
const readingClub = pack.resources.find((resource) => resource.id === 'reading-club') as Resource
const readingItem = pack.items.find((item) => item.id === 'reading-location-a')!

const wrappers: VueWrapper[] = []
const histories: RouterHistory[] = []
const databases: GaokaoDatabase[] = []

afterEach(async () => {
  while (wrappers.length > 0) wrappers.pop()!.unmount()
  for (const history of histories.splice(0)) history.destroy()
  window.location.hash = ''
  while (databases.length > 0) await deleteDatabase(databases.pop()!)
})

const settle = async () => {
  for (let round = 0; round < 5; round += 1) {
    await flushPromises()
    await new Promise((resolve) => { setTimeout(resolve, 0) })
  }
  await new Promise((resolve) => { setTimeout(resolve, 25) })
  await flushPromises()
}

const makeRouter = () => {
  const history = createWebHashHistory()
  histories.push(history)
  return createRouter({
    history,
    routes: [
      { path: '/', redirect: '/today' },
      { path: '/today', component: TodayPage },
      { path: '/onboarding', component: OnboardingPage },
      { path: '/learn', component: LearnPage },
      { path: '/session/:id', component: SessionPage },
      { path: '/:pathMatch(.*)*', redirect: '/today' },
    ],
  })
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

const clickButton = async (wrapper: VueWrapper, text: string) => {
  const button = wrapper.findAll('button').find((candidate) => candidate.text() === text)
  if (!button) throw new Error(`未找到按钮：${text}`)
  await button.trigger('click')
}

const paneElement = (wrapper: VueWrapper, selector: string) =>
  wrapper.get(selector).element as HTMLElement

describe('T06 PassagePanel 阅读材料', () => {
  it('渲染全部段落并保留原始文本', () => {
    const wrapper = mount(PassagePanel, { props: { resource: readingClub, highlights: [] } })
    wrappers.push(wrapper)
    const paragraphs = wrapper.findAll('.passage-paragraph')
    expect(paragraphs.length).toBe(readingClub.paragraphs.length)
    expect(wrapper.get('.passage').text()).toContain('Room 203')
    expect(paragraphs[0].attributes('data-paragraph-id')).toBe(readingClub.paragraphs[0].id)
  })

  it('证据高亮命中片段且原文不变', () => {
    const evidence: Evidence = { resourceId: 'reading-club', paragraphId: 'p1', quote: 'meets in Room 203' }
    const wrapper = mount(PassagePanel, { props: { resource: readingClub, highlights: [evidence] } })
    wrappers.push(wrapper)
    const first = wrapper.findAll('.passage-paragraph')[0]
    expect(first.text()).toBe(readingClub.paragraphs[0].text)
    expect(wrapper.get('.passage-highlight').text()).toBe('meets in Room 203')
  })

  it('无高亮时不渲染 mark 标记', () => {
    const wrapper = mount(PassagePanel, { props: { resource: readingClub, highlights: [] } })
    wrappers.push(wrapper)
    expect(wrapper.findAll('.passage-highlight')).toHaveLength(0)
  })
})

describe('T06 反馈证据跳转', () => {
  it('点击证据发出 jump 事件并携带证据信息', async () => {
    const attempt: Attempt = {
      id: 'attempt-1',
      sessionId: 'session-1',
      profileId: 'profile-a',
      slotId: 'slot-1',
      ref: { packId: pack.id, packVersion: pack.version, itemId: 'reading-location-a' },
      familyId: 'reading-location',
      phase: 'first',
      answer: { kind: 'choice', optionId: 'a' },
      grade: { earned: 1, possible: 1, perGap: { choice: true } },
      assistance: [],
      replayCount: 0,
      audioSpeed: 1,
      createdAt: '2026-09-10T00:00:00.000Z',
      studyDay: '2026-09-10',
      revision: 1,
    }
    const wrapper = mount(FeedbackPanel, { props: { status: 'saved', message: '已保存', attempt, item: readingItem } })
    wrappers.push(wrapper)
    const evidenceButton = wrapper.get('.feedback-evidence')
    expect(evidenceButton.text()).toContain('meets in Room 203')
    await evidenceButton.trigger('click')
    const emitted = wrapper.emitted('jump') as Array<[Evidence]> | undefined
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toEqual({ resourceId: 'reading-club', paragraphId: 'p1', quote: 'meets in Room 203' })
  })
})

describe('T06 练习页阅读布局', () => {
  const customReadingPack = (): CoursePack => {
    const custom = structuredClone(pack)
    custom.units = [{
      ...custom.units[0],
      id: 'unit-reading-one',
      itemIds: ['reading-location-a'],
      familyIds: ['reading-location'],
    }]
    return custom
  }

  it('提交后点击证据跳转文章并高亮，提示前不展示依据', async () => {
    const db = await (async () => {
      const custom = customReadingPack()
      const local = createDatabase(`gaokao-readjump-${crypto.randomUUID()}`)
      await local.open()
      await local.packs.add({ id: custom.id, version: custom.version, status: 'installed', pack: custom, installedAt: new Date().toISOString(), resourcesReady: true })
      databases.push(local)
      const created = await createSession({ db: local, unitId: 'unit-reading-one', minutes: 5, profileId: 'gaokao-common-training-v1', idGenerator: () => 'read-1' })
      if (!created.ok || created.value.kind !== 'session') throw new Error('expected session')
      await enterCurrentSlot(local, 'read-1')
      return local
    })()
    const wrapper = await mountSessionPage(db, 'read-1')
    // 提示前：不展示答案依据
    expect(wrapper.findAll('.passage-highlight')).toHaveLength(0)
    expect(wrapper.findAll('.feedback-evidence')).toHaveLength(0)
    await clickButton(wrapper, '查看提示')
    await settle()
    expect(wrapper.findAll('.passage-highlight')).toHaveLength(0)
    expect(wrapper.text()).toContain('已记录辅助')
    // 提交后出现证据入口
    await clickButton(wrapper, 'In Room 203.')
    await clickButton(wrapper, '提交答案')
    await settle()
    expect(wrapper.text()).toContain('回答正确')
    expect(wrapper.findAll('.feedback-evidence')).toHaveLength(1)
    // 文章窗格此刻隐藏（手机默认题目视图）
    expect(paneElement(wrapper, '.reading-pane-article').style.display).toBe('none')
    // 点击证据：跳到文章窗格并高亮
    await wrapper.get('.feedback-evidence').trigger('click')
    await settle()
    expect(paneElement(wrapper, '.reading-pane-article').style.display).toBe('')
    const mark = wrapper.get('.passage-highlight')
    expect(mark.text()).toBe('meets in Room 203')
    expect(wrapper.get('.passage-paragraph').text()).toBe(readingClub.paragraphs[0].text)
  })

  it('手机文章/题目切换保留滚动位置且不重新挂载', async () => {
    const db = await (async () => {
      const custom = customReadingPack()
      const local = createDatabase(`gaokao-readscroll-${crypto.randomUUID()}`)
      await local.open()
      await local.packs.add({ id: custom.id, version: custom.version, status: 'installed', pack: custom, installedAt: new Date().toISOString(), resourcesReady: true })
      databases.push(local)
      const created = await createSession({ db: local, unitId: 'unit-reading-one', minutes: 5, profileId: 'gaokao-common-training-v1', idGenerator: () => 'read-2' })
      if (!created.ok || created.value.kind !== 'session') throw new Error('expected session')
      await enterCurrentSlot(local, 'read-2')
      return local
    })()
    const wrapper = await mountSessionPage(db, 'read-2')
    expect(paneElement(wrapper, '.reading-pane-task').style.display).toBe('')
    await clickButton(wrapper, '文章')
    expect(paneElement(wrapper, '.reading-pane-article').style.display).toBe('')
    const article = paneElement(wrapper, '.reading-pane-article')
    article.scrollTop = 120
    await clickButton(wrapper, '题目')
    expect(paneElement(wrapper, '.reading-pane-task').style.display).toBe('')
    expect(paneElement(wrapper, '.reading-pane-article').style.display).toBe('none')
    await clickButton(wrapper, '文章')
    const after = paneElement(wrapper, '.reading-pane-article')
    expect(after).toBe(article)
    expect(after.scrollTop).toBe(120)
  })

  it('连续题目共享同一阅读材料时不重复挂载', async () => {
    const custom = structuredClone(pack)
    const base = custom.items.find((candidate) => candidate.id === 'reading-location-a')!
    const second = structuredClone(base) as typeof base
    second.id = 'reading-location-b'
    second.promptZh = 'Where do members gather?'
    custom.items = [...custom.items, second]
    custom.units = [{
      ...custom.units[0],
      id: 'unit-reading-two',
      itemIds: ['reading-location-a', 'reading-location-b'],
      familyIds: ['reading-location'],
    }]
    const local = createDatabase(`gaokao-readshare-${crypto.randomUUID()}`)
    await local.open()
    await local.packs.add({ id: custom.id, version: custom.version, status: 'installed', pack: custom, installedAt: new Date().toISOString(), resourcesReady: true })
    databases.push(local)
    const created = await createSession({ db: local, unitId: 'unit-reading-two', minutes: 5, profileId: 'gaokao-common-training-v1', idGenerator: () => 'read-3' })
    if (!created.ok || created.value.kind !== 'session') throw new Error('expected session')
    await enterCurrentSlot(local, 'read-3')
    const wrapper = await mountSessionPage(local, 'read-3')
    expect(wrapper.findAll('.passage-paragraph')).toHaveLength(readingClub.paragraphs.length)
    const firstVm = wrapper.getComponent(PassagePanel).vm
    await clickButton(wrapper, 'In Room 203.')
    await clickButton(wrapper, '提交答案')
    await settle()
    await clickButton(wrapper, '下一题')
    await settle()
    expect(wrapper.text()).toContain('Where do members gather?')
    const secondVm = wrapper.getComponent(PassagePanel).vm
    // vm 可能被响应式代理包装（无视觉差异但 toBe 不等），用内部实例 uid 判断是否重新挂载
    const uidOf = (vm: unknown): number => ((vm as { _: { uid: number } })._ as { uid: number }).uid
    expect(uidOf(secondVm)).toBe(uidOf(firstVm))
    expect(wrapper.findAll('.passage-paragraph')).toHaveLength(readingClub.paragraphs.length)
  })
})