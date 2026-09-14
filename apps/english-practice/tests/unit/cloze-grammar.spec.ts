import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createRouter, createWebHashHistory, type RouterHistory } from 'vue-router'
import { AnswerError, gradeAnswer, type Answer } from '../../src/domain/answers'
import { createSession, enterCurrentSlot, submitAnswer } from '../../src/services/learning'
import { saveDraft, loadDraft, clearDraft } from '../../src/services/drafts'
import GapTask from '../../src/features/practice/GapTask.vue'
import SessionPage from '../../src/features/practice/SessionPage.vue'
import OnboardingPage from '../../src/features/onboarding/OnboardingPage.vue'
import LearnPage from '../../src/features/learn/LearnPage.vue'
import TodayPage from '../../src/features/today/TodayPage.vue'
import samplePack from '../fixtures/sample-pack.json'
import type { CoursePack, GapsItem } from '../../src/content/types'
import { createDatabase, deleteDatabase, type GaokaoDatabase } from '../../src/data/db'

const pack = samplePack as unknown as CoursePack
const grammar = pack.items.find((item) => item.id === 'grammar-meet-a') as GapsItem
const cloze = pack.items.find((item) => item.id === 'cloze-help-a') as GapsItem

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

const waitMs = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms) })

const mountTask = (item: GapsItem) => {
  const wrapper = mount(GapTask, {
    attachTo: document.body,
    props: {
      item,
      modelValue: null,
      'onUpdate:modelValue': (value: Answer | null) => {
        void wrapper.setProps({ modelValue: value })
      },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

const setupSession = async (sessionId: string, selectedPack: CoursePack) => {
  const db = createDatabase(`gaokao-cg-${crypto.randomUUID()}`)
  await db.open()
  await db.packs.add({ id: selectedPack.id, version: selectedPack.version, status: 'installed', pack: selectedPack, installedAt: new Date().toISOString(), resourcesReady: true })
  databases.push(db)
  const created = await createSession({ db, unitId: 'unit-cg', minutes: 5, profileId: 'gaokao-common-training-v1', idGenerator: () => sessionId })
  if (!created.ok || created.value.kind !== 'session') throw new Error('expected session')
  await enterCurrentSlot(db, sessionId)
  return db
}

const grammarPack = (): CoursePack => {
  const custom = structuredClone(pack)
  custom.units = [{ ...custom.units[0], id: 'unit-cg', itemIds: ['grammar-meet-a'], familyIds: ['present-simple-agreement'] }]
  return custom
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

describe('T07 完形与语法填空判分', () => {
  it('meets 正确；meet 不会被自动改成复数', () => {
    expect(gradeAnswer(grammar, { kind: 'gaps', values: { g1: 'meets' } }).earned).toBe(1)
    expect(gradeAnswer(grammar, { kind: 'gaps', values: { g1: 'meet' } }).earned).toBe(0)
  })

  it('accepted 多个变体逐一按 policy 归一化比较', () => {
    const multi = structuredClone(grammar)
    multi.gaps[0].accepted = ['meets', 'holds']
    expect(gradeAnswer(multi, { kind: 'gaps', values: { g1: 'MEETS ' } }).earned).toBe(1)
    expect(gradeAnswer(multi, { kind: 'gaps', values: { g1: 'holds' } }).earned).toBe(1)
    expect(gradeAnswer(multi, { kind: 'gaps', values: { g1: 'hold' } }).earned).toBe(0)
  })

  it('全部留空拒绝提交，空白按 0 分处理', () => {
    expect(() => gradeAnswer(grammar, { kind: 'gaps', values: { g1: '' } })).toThrow(AnswerError)
    expect(() => gradeAnswer(grammar, { kind: 'gaps', values: {} })).toThrow(AnswerError)
  })

  it('非 uniqueOptions 的局部选项允许跨空出现相同 id（判题器不拒绝，只按对错计分）', () => {
    const custom = structuredClone(cloze)
    custom.gaps[1].options = [{ id: 'a', text: 'help' }, { id: 'd', text: 'ignored' }]
    const grade = gradeAnswer(custom, { kind: 'gaps', values: { g1: 'a', g2: 'a' } })
    expect(grade.earned).toBe(1)
    expect(grade.perGap.g1).toBe(true)
    expect(grade.perGap.g2).toBe(false)
  })

  it('two-gap 完形 a/c 得 2/2，一错一对得 1/2', () => {
    const full = gradeAnswer(cloze, { kind: 'gaps', values: { g1: 'a', g2: 'c' } })
    expect(full.earned).toBe(2)
    expect(full.possible).toBe(2)
    expect(full.perGap).toEqual({ g1: true, g2: true })
    const half = gradeAnswer(cloze, { kind: 'gaps', values: { g1: 'b', g2: 'c' } })
    expect(half.earned).toBe(1)
    expect(half.perGap.g1).toBe(false)
    expect(half.perGap.g2).toBe(true)
  })
})

describe('T07 每空独立选项面板', () => {
  it('各空使用各自局部选项池，相同选项 id 可在不同空同时使用', async () => {
    const custom = structuredClone(cloze)
    custom.gaps[1].options = [{ id: 'a', text: 'help' }, { id: 'd', text: 'ignored' }]
    const wrapper = mountTask(custom)
    await wrapper.findAll('.gap-slot')[0].trigger('click')
    const g1Help = wrapper.findAll('.gap-option').find((option) => option.text().includes('help'))
    await g1Help!.trigger('click')
    await wrapper.findAll('.gap-slot')[1].trigger('click')
    const g2Help = wrapper.findAll('.gap-option').find((option) => option.text().includes('help'))
    await g2Help!.trigger('click')
    const emitted = wrapper.emitted('update:modelValue') as Array<[Answer | null]>
    expect(emitted[emitted.length - 1][0]).toEqual({ kind: 'gaps', values: { g1: 'a', g2: 'a' } })
  })
})

describe('T07 草稿自动保存', () => {
  it('saveDraft/loadDraft 持久化草稿、可覆盖、可清除', async () => {
    const db = createDatabase(`gaokao-cg-draft-${crypto.randomUUID()}`)
    await db.open()
    databases.push(db)
    await saveDraft(db, { sessionId: 's1', itemId: 'grammar-meet-a', answer: { kind: 'gaps', values: { g1: 'mee' } } })
    const first = await loadDraft(db, { sessionId: 's1', itemId: 'grammar-meet-a' })
    expect(first.ok).toBe(true)
    if (first.ok) expect(first.value).toEqual({ kind: 'gaps', values: { g1: 'mee' } })
    await saveDraft(db, { sessionId: 's1', itemId: 'grammar-meet-a', answer: { kind: 'gaps', values: { g1: 'meets' } } })
    const second = await loadDraft(db, { sessionId: 's1', itemId: 'grammar-meet-a' })
    if (second.ok) expect(second.value).toEqual({ kind: 'gaps', values: { g1: 'meets' } })
    await clearDraft(db, { sessionId: 's1', itemId: 'grammar-meet-a' })
    const gone = await loadDraft(db, { sessionId: 's1', itemId: 'grammar-meet-a' })
    if (gone.ok) expect(gone.value).toBeNull()
  })

  it('250ms 防抖窗口内不落盘，跳过后草稿清除', async () => {
    const selectedPack = grammarPack()
    const db = await setupSession('cg-2', selectedPack)
    const wrapper = await mountSessionPage(db, 'cg-2')
    await wrapper.get('.gap-input').setValue('m')
    // 防抖窗口内（<250ms）尚未写入
    expect(await db.drafts.get(['cg-2', 'grammar-meet-a'])).toBeUndefined()
    await waitMs(500)
    await settle()
    expect(await db.drafts.get(['cg-2', 'grammar-meet-a'])).toBeTruthy()
    // 跳过当前题：草稿清除且不产生 Attempt
    await clickButton(wrapper, '跳过此题')
    await settle()
    expect(await db.drafts.get(['cg-2', 'grammar-meet-a'])).toBeUndefined()
    expect(await db.attempts.count()).toBe(0)
  })

  it('输入即自动保存草稿且不计作答，重新挂载后恢复，提交后清除', async () => {
    const selectedPack = grammarPack()
    const db = await setupSession('cg-1', selectedPack)
    const wrapper = await mountSessionPage(db, 'cg-1')
    const input = wrapper.get('.gap-input')
    await input.setValue('mee')
    await waitMs(500)
    await settle()
    const saved = await db.drafts.get(['cg-1', 'grammar-meet-a'])
    expect(saved).toBeTruthy()
    expect(JSON.parse(saved!.content)).toEqual({ kind: 'gaps', values: { g1: 'mee' } })
    expect(await db.attempts.count()).toBe(0)
    // 重新挂载：草稿恢复到输入框
    wrapper.unmount()
    const again = await mountSessionPage(db, 'cg-1')
    expect(again.get('.gap-input').element as HTMLInputElement).toBeTruthy()
    expect((again.get('.gap-input').element as HTMLInputElement).value).toBe('mee')
    // 提交后草稿清除、作答入库
    await again.get('.gap-input').setValue('meets')
    await clickButton(again, '提交答案')
    await settle()
    expect(again.text()).toContain('回答正确')
    expect(await db.attempts.count()).toBe(1)
    expect(await db.drafts.get(['cg-1', 'grammar-meet-a'])).toBeUndefined()
  })
})

describe('T07 软键盘 Next 行为', () => {
  const twoTextItem = (): GapsItem => {
    const custom = structuredClone(grammar)
    custom.segments = [
      { type: 'text', text: 'The club ' },
      { type: 'gap', gapId: 'g1' },
      { type: 'text', text: ' and ' },
      { type: 'gap', gapId: 'g2' },
      { type: 'text', text: ' every Friday.' },
    ]
    custom.gaps = [
      { id: 'g1', label: '1', clue: 'meet', options: [], accepted: ['meets'], explanationZh: '' },
      { id: 'g2', label: '2', clue: 'hold', options: [], accepted: ['holds'], explanationZh: '' },
    ]
    return custom
  }

  it('输入框标注 enterkeyhint=next，Enter/Next 只移动焦点不交卷', async () => {
    const wrapper = mountTask(twoTextItem())
    const inputs = wrapper.findAll('.gap-input')
    expect(inputs).toHaveLength(2)
    expect(inputs[0].attributes('enterkeyhint')).toBe('next')
    expect(inputs[1].attributes('enterkeyhint')).toBe('next')
    await inputs[0].setValue('mee')
    await inputs[0].trigger('keydown', { key: 'Enter' })
    expect(document.activeElement).toBe(inputs[1].element)
    // 不自动提交：GapTask 没有 submit 事件，草稿保留在本地状态
    expect(wrapper.emitted('submit')).toBeUndefined()
    const emitted = wrapper.emitted('update:modelValue') as Array<[Answer | null]>
    expect(emitted[emitted.length - 1][0]).toEqual({ kind: 'gaps', values: { g1: 'mee' } })
  })

  it('最后一空的 Next 保持在当前输入框（不越界）', async () => {
    const wrapper = mountTask(twoTextItem())
    const inputs = wrapper.findAll('.gap-input')
    ;(inputs[1].element as HTMLInputElement).focus()
    await inputs[1].trigger('keydown', { key: 'Enter' })
    expect(document.activeElement).toBe(inputs[1].element)
  })
})

describe('T07 旧会话内容版本隔离', () => {
  it('新版本安装后，未完成旧会话仍按旧版本 accepted 判分', async () => {
    const v1 = grammarPack()
    const v2 = structuredClone(v1)
    v2.version = '9.9.9'
    const changed = v2.items.find((item) => item.id === 'grammar-meet-a') as GapsItem
    changed.gaps[0].accepted = ['holds']
    const db = await setupSession('cg-old', v1)
    await db.packs.add({ id: v2.id, version: v2.version, status: 'installed', pack: v2, installedAt: new Date().toISOString(), resourcesReady: true })
    const result = await submitAnswer(db, {
      id: 'cmd-old',
      sessionId: 'cg-old',
      slotId: 'cg-old:0',
      expectedRevision: 1,
      answer: { kind: 'gaps', values: { g1: 'meets' } },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // 旧会话仍按 v1 的 accepted=['meets'] 判分，而不是新版本的 holds
      expect(result.value.grade.earned).toBe(1)
    }
  })
})

const clickButton = async (wrapper: VueWrapper, text: string) => {
  const button = wrapper.findAll('button').find((candidate) => candidate.text() === text)
  if (!button) throw new Error(`未找到按钮：${text}`)
  await button.trigger('click')
}
