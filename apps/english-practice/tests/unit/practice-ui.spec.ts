import 'fake-indexeddb/auto'
import type { Component } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createRouter, createWebHashHistory, type RouterHistory } from 'vue-router'
import samplePack from '../fixtures/sample-pack.json'
import AppButton from '../../src/components/AppButton.vue'
import FeedbackPanel from '../../src/components/FeedbackPanel.vue'
import ChoiceTask from '../../src/features/practice/ChoiceTask.vue'
import OrderTask from '../../src/features/practice/OrderTask.vue'
import GapTask from '../../src/features/practice/GapTask.vue'
import SessionPage from '../../src/features/practice/SessionPage.vue'
import OnboardingPage from '../../src/features/onboarding/OnboardingPage.vue'
import LearnPage from '../../src/features/learn/LearnPage.vue'
import TodayPage from '../../src/features/today/TodayPage.vue'
import type { ChoiceItem, CoursePack, GapsItem, Item, OrderItem } from '../../src/content/types'
import type { Answer } from '../../src/domain/answers'
import type { Attempt } from '../../src/services/learning'
import { createSession } from '../../src/services/learning'
import { createDatabase, deleteDatabase, type GaokaoDatabase } from '../../src/data/db'

const pack = samplePack as unknown as CoursePack
const itemById = <T extends Item>(id: string): T => pack.items.find((item) => item.id === id) as T

const wrappers: VueWrapper[] = []
const histories: RouterHistory[] = []
const databases: GaokaoDatabase[] = []

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

const openDb = async (selectedPack: CoursePack = pack) => {
  const db = createDatabase(`gaokao-ui-${crypto.randomUUID()}`)
  await db.open()
  await db.packs.add({ id: selectedPack.id, version: selectedPack.version, status: 'installed', pack: selectedPack, installedAt: new Date().toISOString(), resourcesReady: true })
  databases.push(db)
  return db
}

const customPackWithUnit = (itemIds: string[], familyIds: string[]): CoursePack => {
  const custom = structuredClone(pack)
  custom.units = [{
    ...custom.units[0],
    id: 'unit-custom',
    itemIds,
    familyIds,
    prerequisiteSkillIds: [],
  }]
  return custom
}

const makeSession = async (db: GaokaoDatabase, id: string, minutes: number, unitId = 'demo-school-club') => {
  const created = await createSession({ db, unitId, minutes, profileId: 'gaokao-common-training-v1', idGenerator: () => id })
  if (!created.ok || created.value.kind !== 'session') throw new Error('expected session')
  return created.value.session
}

const mountSession = async (db: GaokaoDatabase, sessionId: string) => {
  const router = makeRouter()
  await router.push(`/session/${sessionId}`)
  await router.isReady()
  const wrapper = mount(SessionPage, { props: { db, sessionId }, global: { plugins: [router] } })
  wrappers.push(wrapper)
  await settle()
  return wrapper
}

const buttons = (wrapper: VueWrapper) => wrapper.findAll('button')
const findButton = (wrapper: VueWrapper, text: string) => buttons(wrapper).find((button) => button.text() === text)
const clickButton = async (wrapper: VueWrapper, text: string) => {
  const button = findButton(wrapper, text)
  if (!button) throw new Error(`未找到按钮：${text}`)
  await button.trigger('click')
}

// fake-indexeddb 的读写跨多个宏任务完成，单次 flushPromises 不足以排空事件循环
const settle = async () => {
  for (let round = 0; round < 5; round += 1) {
    await flushPromises()
    await new Promise((resolve) => { setTimeout(resolve, 0) })
  }
  await new Promise((resolve) => { setTimeout(resolve, 25) })
  await flushPromises()
}

// 任务组件按 D01 约定只 emit 不自持状态，有状态断言时需要父级回灌 modelValue
const mountTask = (component: Component, props: Record<string, unknown>) => {
  const wrapper = mount(component, {
    props: {
      ...props,
      modelValue: null,
      'onUpdate:modelValue': (value: Answer | null) => {
        void wrapper.setProps({ modelValue: value })
      },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

afterEach(async () => {
  while (wrappers.length > 0) wrappers.pop()!.unmount()
  for (const history of histories.splice(0)) history.destroy()
  window.location.hash = ''
  while (databases.length > 0) await deleteDatabase(databases.pop()!)
})

describe('AppButton 触控按钮', () => {
  it('以真实按钮渲染插槽内容', () => {
    const wrapper = mount(AppButton, { slots: { default: '开始练习' } })
    wrappers.push(wrapper)
    const button = wrapper.get('button')
    expect(button.text()).toBe('开始练习')
    expect(button.attributes('type')).toBe('button')
  })

  it('点击监听正常透传', async () => {
    const clicks: number[] = []
    const wrapper = mount(AppButton, { slots: { default: '确定' }, attrs: { onClick: () => clicks.push(1) } })
    wrappers.push(wrapper)
    await wrapper.get('button').trigger('click')
    expect(clicks).toHaveLength(1)
  })
})

describe('ChoiceTask 单选题组件', () => {
  it('点击选择且不自动提交，再次点击其他选项可切换', async () => {
    const item = itemById<ChoiceItem>('vocab-join-a')
    const wrapper = mountTask(ChoiceTask, { item })
    wrappers.push(wrapper)
    const options = buttons(wrapper)
    expect(options).toHaveLength(3)
    await options[0].trigger('click')
    const emitted = wrapper.emitted('update:modelValue') as Array<[Answer | null]> | undefined
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toEqual({ kind: 'choice', optionId: 'a' })
    expect(wrapper.emitted('submit')).toBeFalsy()
    await options[1].trigger('click')
    const after = wrapper.emitted('update:modelValue') as Array<[Answer | null]>
    expect(after[after.length - 1][0]).toEqual({ kind: 'choice', optionId: 'b' })
  })

  it('键盘 Enter 与 Space 可选择选项', async () => {
    const item = itemById<ChoiceItem>('vocab-join-a')
    const wrapper = mountTask(ChoiceTask, { item })
    wrappers.push(wrapper)
    await buttons(wrapper)[0].trigger('keydown', { key: 'Enter' })
    const emitted = wrapper.emitted('update:modelValue') as Array<[Answer | null]> | undefined
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toEqual({ kind: 'choice', optionId: 'a' })
    await buttons(wrapper)[1].trigger('keydown', { key: ' ' })
    const after = wrapper.emitted('update:modelValue') as Array<[Answer | null]>
    expect(after[after.length - 1][0]).toEqual({ kind: 'choice', optionId: 'b' })
  })

  it('禁用时不响应任何选择', async () => {
    const item = itemById<ChoiceItem>('vocab-join-a')
    const wrapper = mount(ChoiceTask, { props: { item, modelValue: null, disabled: true } })
    wrappers.push(wrapper)
    await buttons(wrapper)[0].trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeFalsy()
  })

  it('选中状态通过 aria-pressed 标记', async () => {
    const item = itemById<ChoiceItem>('vocab-join-a')
    const wrapper = mountTask(ChoiceTask, { item })
    wrappers.push(wrapper)
    await buttons(wrapper)[0].trigger('click')
    expect(buttons(wrapper)[0].attributes('aria-pressed')).toBe('true')
    expect(buttons(wrapper)[1].attributes('aria-pressed')).toBe('false')
  })
})

describe('OrderTask 组句组件', () => {
  it('仅通过点击完成组句', async () => {
    const item = itemById<OrderItem>('order-join-a')
    const wrapper = mountTask(OrderTask, { item })
    wrappers.push(wrapper)
    const pool = () => wrapper.findAll('.token-option')
    expect(pool()).toHaveLength(5)
    for (let index = 0; index < 5; index += 1) {
      await pool()[0].trigger('click')
    }
    const emitted = wrapper.emitted('update:modelValue') as Array<[Answer | null]> | undefined
    expect(emitted).toBeTruthy()
    expect(emitted![emitted!.length - 1][0]).toEqual({ kind: 'order', tokenIds: ['t1', 't2', 't3', 't4', 't5'] })
    expect(pool()).toHaveLength(0)
  })

  it('点击已选词块可撤销', async () => {
    const item = itemById<OrderItem>('order-join-a')
    const wrapper = mountTask(OrderTask, { item })
    wrappers.push(wrapper)
    await wrapper.findAll('.token-option')[0].trigger('click')
    expect(wrapper.findAll('.token-chip')).toHaveLength(1)
    await wrapper.get('.token-word').trigger('click')
    expect(wrapper.findAll('.token-chip')).toHaveLength(0)
    const emitted = wrapper.emitted('update:modelValue') as Array<[Answer | null]>
    expect(emitted[emitted.length - 1][0]).toEqual({ kind: 'order', tokenIds: [] })
  })

  it('重排按钮可移动已选词块', async () => {
    const item = itemById<OrderItem>('order-join-a')
    const wrapper = mountTask(OrderTask, { item })
    wrappers.push(wrapper)
    await wrapper.findAll('.token-option')[0].trigger('click')
    await wrapper.findAll('.token-option')[0].trigger('click')
    const chips = wrapper.findAll('.token-chip')
    expect(chips).toHaveLength(2)
    expect(chips[1].get('.token-word').text()).toBe('want')
    await chips[1].get('.token-move-left').trigger('click')
    const emitted = wrapper.emitted('update:modelValue') as Array<[Answer | null]>
    expect(emitted[emitted.length - 1][0]).toEqual({ kind: 'order', tokenIds: ['t2', 't1'] })
  })

  it('禁用时不响应点击', async () => {
    const item = itemById<OrderItem>('order-join-a')
    const wrapper = mount(OrderTask, { props: { item, modelValue: null, disabled: true } })
    wrappers.push(wrapper)
    await wrapper.findAll('.token-option')[0].trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeFalsy()
  })
})

describe('GapTask 填空组件', () => {
  it('选项模式：点击空位后从该空选项中选择', async () => {
    const item = itemById<GapsItem>('cloze-help-a')
    const wrapper = mountTask(GapTask, { item })
    wrappers.push(wrapper)
    expect(wrapper.findAll('.gap-slot')).toHaveLength(2)
    await wrapper.findAll('.gap-slot')[0].trigger('click')
    const options = wrapper.findAll('.gap-option')
    expect(options).toHaveLength(2)
    await options[0].trigger('click')
    const emitted = wrapper.emitted('update:modelValue') as Array<[Answer | null]> | undefined
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toEqual({ kind: 'gaps', values: { g1: 'a' } })
  })

  it('选项模式：可清除并更换已选选项', async () => {
    const item = itemById<GapsItem>('cloze-help-a')
    const wrapper = mountTask(GapTask, { item })
    wrappers.push(wrapper)
    await wrapper.findAll('.gap-slot')[0].trigger('click')
    await wrapper.findAll('.gap-option')[0].trigger('click')
    await wrapper.get('.gap-clear').trigger('click')
    const emitted = wrapper.emitted('update:modelValue') as Array<[Answer | null]>
    expect(emitted[emitted.length - 1][0]).toEqual({ kind: 'gaps', values: {} })
    await wrapper.findAll('.gap-slot')[0].trigger('click')
    await wrapper.findAll('.gap-option')[1].trigger('click')
    const after = wrapper.emitted('update:modelValue') as Array<[Answer | null]>
    expect(after[after.length - 1][0]).toEqual({ kind: 'gaps', values: { g1: 'b' } })
  })

  it('唯一共享选项不重复占用（点击已占用选项提供移动确认）', async () => {
    const item = itemById<GapsItem>('gap-reading-plan-a')
    const wrapper = mountTask(GapTask, { item })
    wrappers.push(wrapper)
    await wrapper.findAll('.gap-slot')[0].trigger('click')
    await wrapper.findAll('.gap-option')[0].trigger('click')
    await wrapper.findAll('.gap-slot')[1].trigger('click')
    // T06：已占用选项不再禁用，显示所在空并提供移动确认
    const reused = wrapper.findAll('.gap-option').find((option) => option.text().includes('Start with a small task.'))
    expect(reused).toBeTruthy()
    expect(reused!.attributes('disabled')).toBeUndefined()
    expect(reused!.text()).toContain('已用于第 1 空')
    await reused!.trigger('click')
    expect(wrapper.get('.gap-move-confirm').text()).toContain('从第 1 空移动到第 2 空')
    await wrapper.findAll('button').find((candidate) => candidate.text() === '确认移动')!.trigger('click')
    const emitted = wrapper.emitted('update:modelValue') as Array<[Answer | null]>
    expect(emitted[emitted.length - 1][0]).toEqual({ kind: 'gaps', values: { g2: 'a' } })
  })

  it('文本模式：显示提示词并随输入更新答案', async () => {
    const item = itemById<GapsItem>('grammar-meet-a')
    const wrapper = mountTask(GapTask, { item })
    wrappers.push(wrapper)
    expect(wrapper.get('.gap-clue').text()).toContain('meet')
    const input = wrapper.get('.gap-input')
    expect(input.attributes('autocomplete')).toBe('off')
    await input.setValue('meets')
    const emitted = wrapper.emitted('update:modelValue') as Array<[Answer | null]> | undefined
    expect(emitted).toBeTruthy()
    expect(emitted![emitted!.length - 1][0]).toEqual({ kind: 'gaps', values: { g1: 'meets' } })
  })
})

const makeAttempt = (grade: Attempt['grade'], phase: 'first' | 'correction' = 'first', assistance: string[] = []): Attempt => ({
  id: 'attempt-1',
  sessionId: 'session-1',
  profileId: 'profile-a',
  slotId: 'slot-1',
  ref: { packId: pack.id, packVersion: pack.version, itemId: 'vocab-join-a' },
  familyId: 'join-context',
  phase,
  answer: { kind: 'choice', optionId: 'a' },
  grade,
  assistance,
  replayCount: 0,
  audioSpeed: 1,
  createdAt: '2026-09-11T00:00:00.000Z',
  studyDay: '2026-09-11',
  revision: 1,
})

describe('FeedbackPanel 反馈组件', () => {
  it('错误反馈通过 role=alert 播报', () => {
    const wrapper = mount(FeedbackPanel, { props: { status: 'error', message: '保存失败，请重试' } })
    wrappers.push(wrapper)
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('保存失败，请重试')
  })

  it('保存中与已保存状态通过 role=status 显示', () => {
    const saving = mount(FeedbackPanel, { props: { status: 'saving' } })
    wrappers.push(saving)
    expect(saving.get('[role="status"]').text()).toContain('保存中')
    const saved = mount(FeedbackPanel, { props: { status: 'saved', message: '已保存' } })
    wrappers.push(saved)
    expect(saved.get('[role="status"]').text()).toContain('已保存')
  })

  it('展示判定结果与中文解析', () => {
    const item = itemById<ChoiceItem>('vocab-join-a')
    const wrapper = mount(FeedbackPanel, { props: { status: 'saved', message: '已保存', attempt: makeAttempt({ earned: 1, possible: 1, perGap: { choice: true } }), item } })
    wrappers.push(wrapper)
    expect(wrapper.text()).toContain('回答正确')
    expect(wrapper.text()).toContain('join 在这里表示加入团体。')
  })

  it('多空题逐空展示对错', () => {
    const item = itemById<GapsItem>('cloze-help-a')
    const wrapper = mount(FeedbackPanel, { props: { status: 'saved', message: '已保存', attempt: makeAttempt({ earned: 1, possible: 2, perGap: { g1: true, g2: false } }), item } })
    wrappers.push(wrapper)
    const rows = wrapper.findAll('.gap-result')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('对')
    expect(rows[1].text()).toContain('错')
  })
})

describe('OnboardingPage 学习设置页', () => {
  it('保存年级、目标与时长设置并提示已保存到本机', async () => {
    const db = await openDb()
    const router = makeRouter()
    await router.push('/onboarding')
    await router.isReady()
    const wrapper = mount(OnboardingPage, { props: { db }, global: { plugins: [router] } })
    wrappers.push(wrapper)
    await settle()
    await wrapper.get('select').setValue('高二')
    await wrapper.get('input').setValue('补基础词汇')
    await clickButton(wrapper, '15 分钟')
    await clickButton(wrapper, '保存设置')
    await settle()
    const stored = await db.settings.get('personal')
    expect(stored?.value).toMatchObject({ grade: '高二', goal: '补基础词汇', defaultMinutes: 15, profileId: 'gaokao-common-training-v1' })
    expect(wrapper.text()).toContain('已保存到本机')
  })

  it('起点练习样本不足时显示说明且允许跳过', async () => {
    const db = await openDb()
    const router = makeRouter()
    await router.push('/onboarding')
    await router.isReady()
    const wrapper = mount(OnboardingPage, { props: { db }, global: { plugins: [router] } })
    wrappers.push(wrapper)
    await settle()
    expect(wrapper.text()).toContain('样本不足')
    await clickButton(wrapper, '跳过')
    await settle()
    expect(router.currentRoute.value.path).toBe('/today')
  })
})

describe('LearnPage 课程页', () => {
  it('无课程时引导准备内容，失败时显示明确错误', async () => {
    const db = createDatabase(`gaokao-ui-empty-${crypto.randomUUID()}`)
    databases.push(db)
    const router = makeRouter()
    await router.push('/learn')
    await router.isReady()
    const wrapper = mount(LearnPage, { props: { db }, global: { plugins: [router] } })
    wrappers.push(wrapper)
    await settle()
    expect(wrapper.text()).toContain('暂无可用课程')
    expect(findButton(wrapper, '准备课程内容')).toBeTruthy()
    await clickButton(wrapper, '准备课程内容')
    await settle()
    expect(wrapper.text()).toContain('内容准备失败')
  })

  it('列出已安装单元并标注未审核内容', async () => {
    const db = await openDb()
    const router = makeRouter()
    await router.push('/learn')
    await router.isReady()
    const wrapper = mount(LearnPage, { props: { db }, global: { plugins: [router] } })
    wrappers.push(wrapper)
    await settle()
    const cards = wrapper.findAll('.unit-card')
    expect(cards).toHaveLength(1)
    expect(cards[0].text()).toContain('校园社团：协议演示')
    expect(cards[0].text()).toContain('未审核')
    expect(cards[0].text()).toContain('共 8 题')
  })

  it('选择单元和时长后创建练习并进入练习页', async () => {
    const db = await openDb()
    const router = makeRouter()
    await router.push('/learn')
    await router.isReady()
    const wrapper = mount(LearnPage, { props: { db }, global: { plugins: [router] } })
    wrappers.push(wrapper)
    await settle()
    await wrapper.get('.unit-card').trigger('click')
    await clickButton(wrapper, '5 分钟')
    await clickButton(wrapper, '开始练习')
    await settle()
    expect(router.currentRoute.value.path).toMatch(/^\/session\//)
    expect(await db.sessions.count()).toBe(1)
  })
})

describe('SessionPage 练习页', () => {
  it('渲染当前题目并记录首次呈现，未提交前不显示成绩', async () => {
    const db = await openDb()
    await makeSession(db, 'ui-1', 2)
    const wrapper = await mountSession(db, 'ui-1')
    expect(wrapper.text()).toContain('在 Join the school reading club. 中，join 的意思是什么？')
    expect(wrapper.text()).toContain('预览内容（未审核）')
    expect(wrapper.text()).toContain('第 1 / 2 题')
    expect(wrapper.text()).not.toContain('回答正确')
    const exposures = await db.exposures.toArray()
    expect(exposures).toHaveLength(1)
    expect(exposures[0].firstSeenSessionId).toBe('ui-1')
  })

  it('提交后显示已保存与判定，重复点击不产生重复记录', async () => {
    const db = await openDb()
    await makeSession(db, 'ui-2', 2)
    const wrapper = await mountSession(db, 'ui-2')
    await clickButton(wrapper, '加入')
    const submit = findButton(wrapper, '提交答案')
    await submit!.trigger('click')
    await submit!.trigger('click')
    await settle()
    expect(wrapper.text()).toContain('已保存')
    expect(wrapper.text()).toContain('回答正确')
    expect(await db.attempts.count()).toBe(1)
  })

  it('答错后可订正且首次成绩不被覆盖', async () => {
    const db = await openDb()
    await makeSession(db, 'ui-3', 2)
    const wrapper = await mountSession(db, 'ui-3')
    await clickButton(wrapper, '离开')
    await clickButton(wrapper, '提交答案')
    await settle()
    expect(wrapper.text()).toContain('回答有误')
    expect(wrapper.text()).toContain('离开与此处加入的意思相反。')
    await clickButton(wrapper, '订正')
    await clickButton(wrapper, '加入')
    await clickButton(wrapper, '提交订正')
    await settle()
    expect(wrapper.text()).toContain('订正已保存')
    const records = await db.attempts.toArray()
    expect(records).toHaveLength(2)
    const first = records.find((record) => record.phase === 'first')
    expect((first?.payload as Attempt).grade.earned).toBe(0)
    expect((first?.payload as Attempt).grade.possible).toBe(1)
  })

  it('刷新后从当前位置继续（状态恢复）', async () => {
    const db = await openDb()
    await makeSession(db, 'ui-4', 2)
    const first = await mountSession(db, 'ui-4')
    await clickButton(first, '加入')
    await clickButton(first, '提交答案')
    await settle()
    await clickButton(first, '下一题')
    await settle()
    expect(first.text()).toContain('点词组句：我想加入这个俱乐部。')
    first.unmount()
    const second = await mountSession(db, 'ui-4')
    expect(second.text()).toContain('点词组句：我想加入这个俱乐部。')
    expect(second.text()).toContain('第 2 / 2 题')
    expect(second.text()).not.toContain('在 Join the school reading club. 中')
  })

  it('多空题存在未答空位时先确认再提交', async () => {
    const custom = customPackWithUnit(['cloze-help-a'], ['cloze-help-context'])
    const db = await openDb(custom)
    await makeSession(db, 'ui-5', 5, 'unit-custom')
    const wrapper = await mountSession(db, 'ui-5')
    await wrapper.findAll('.gap-slot')[0].trigger('click')
    await wrapper.findAll('.gap-option').find((option) => option.text() === 'help')!.trigger('click')
    await clickButton(wrapper, '提交答案')
    await settle()
    expect(wrapper.text()).toContain('仍有未答空位')
    await clickButton(wrapper, '确认提交')
    await settle()
    expect(wrapper.text()).toContain('已保存')
    const rows = wrapper.findAll('.gap-result')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('对')
    expect(rows[1].text()).toContain('错')
  })

  it('写作题渲染写作视图（审题要求与正文输入）并可跳过', async () => {
    const custom = customPackWithUnit(['writing-invitation-a'], ['application-invitation'])
    const db = await openDb(custom)
    await makeSession(db, 'ui-6', 10, 'unit-custom')
    const wrapper = await mountSession(db, 'ui-6')
    // T09：写作占位已替换为 WritingPage（审题要求 + 提纲 + 正文 + 自评表）
    expect(wrapper.text()).toContain('审题要求')
    expect(wrapper.findAll('textarea').length).toBeGreaterThanOrEqual(2)
    expect(wrapper.text()).not.toContain('写作任务将在后续任务提供')
    await clickButton(wrapper, '跳过此题')
    await settle()
    expect(wrapper.text()).toContain('已跳过 1 题')
  })

  it('单元结束显示独立首次与提示后完成数量', async () => {
    const db = await openDb()
    await makeSession(db, 'ui-7', 2)
    const wrapper = await mountSession(db, 'ui-7')
    await clickButton(wrapper, '加入')
    await clickButton(wrapper, '提交答案')
    await settle()
    await clickButton(wrapper, '下一题')
    await settle()
    await clickButton(wrapper, '查看提示')
    await settle()
    expect(wrapper.text()).toContain('want to do 表示想做某事。')
    expect(wrapper.text()).toContain('已记录辅助')
    const pool = () => wrapper.findAll('.token-option')
    for (let index = 0; index < 5; index += 1) {
      await pool()[0].trigger('click')
    }
    await clickButton(wrapper, '提交答案')
    await settle()
    await clickButton(wrapper, '下一题')
    await settle()
    const summary = wrapper.get('.unit-summary')
    expect(summary.text()).toContain('独立首次完成 1 题')
    expect(summary.text()).toContain('提示后完成 1 题')
    expect(findButton(wrapper, '回到今日')).toBeTruthy()
  })

  it('完整单元流程：阅读材料可见且文本填空可提交', async () => {
    const db = await openDb()
    await makeSession(db, 'ui-8', 5)
    const wrapper = await mountSession(db, 'ui-8')
    await clickButton(wrapper, '加入')
    await clickButton(wrapper, '提交答案')
    await settle()
    await clickButton(wrapper, '下一题')
    await settle()
    const pool = () => wrapper.findAll('.token-option')
    for (let index = 0; index < 5; index += 1) {
      await pool()[0].trigger('click')
    }
    await clickButton(wrapper, '提交答案')
    await settle()
    await clickButton(wrapper, '下一题')
    await settle()
    await wrapper.get('.gap-input').setValue('meets')
    await clickButton(wrapper, '提交答案')
    await settle()
    expect(wrapper.text()).toContain('回答正确')
    await clickButton(wrapper, '下一题')
    await settle()
    expect(wrapper.get('.passage').text()).toContain('Room 203')
    await clickButton(wrapper, 'In Room 203.')
    await clickButton(wrapper, '提交答案')
    await settle()
    await clickButton(wrapper, '下一题')
    await settle()
    expect(wrapper.get('.unit-summary').text()).toContain('独立首次完成 4 题')
  })

  it('暂停后回到今日页，可从继续入口恢复', async () => {
    const db = await openDb()
    await makeSession(db, 'ui-9', 2)
    const wrapper = await mountSession(db, 'ui-9')
    await clickButton(wrapper, '暂停')
    await settle()
    const router = makeRouter()
    await router.push('/today')
    await router.isReady()
    const today = mount(TodayPage, { props: { db }, global: { plugins: [router] } })
    wrappers.push(today)
    await settle()
    expect(today.text()).toContain('继续上次练习')
    await clickButton(today, '继续上次练习')
    await settle()
    expect(router.currentRoute.value.path).toBe('/session/ui-9')
  })

  it('退出确认仅在存在未保存输入时出现', async () => {
    const db = await openDb()
    await makeSession(db, 'ui-10', 2)
    const wrapper = await mountSession(db, 'ui-10')
    await clickButton(wrapper, '返回')
    await settle()
    expect(wrapper.text()).not.toContain('仍有未提交的作答内容')
    const again = await mountSession(db, 'ui-10')
    await clickButton(again, '加入')
    await clickButton(again, '返回')
    await settle()
    expect(again.text()).toContain('仍有未提交的作答内容')
    await clickButton(again, '继续作答')
    await settle()
    expect(again.text()).toContain('在 Join the school reading club. 中')
    await clickButton(again, '返回')
    await settle()
    await clickButton(again, '确认离开')
    await settle()
    // 验收补强：确认离开必须真实导航回今日页（hash 路由）
    expect(window.location.hash).toBe('#/today')
  })
})

describe('TodayPage 今日页', () => {
  it('无课程时保留空态提示并引导前往课程列表', async () => {
    const db = createDatabase(`gaokao-ui-today-${crypto.randomUUID()}`)
    databases.push(db)
    const router = makeRouter()
    await router.push('/today')
    await router.isReady()
    const wrapper = mount(TodayPage, { props: { db }, global: { plugins: [router] } })
    wrappers.push(wrapper)
    await settle()
    await clickButton(wrapper, '开始今日练习')
    await settle()
    expect(wrapper.text()).toContain('暂无可用课程，请先准备学习内容。')
    const link = wrapper.get('.learn-link')
    expect(link.text()).toContain('前往课程列表')
  })

  it('有课程时开始今日练习进入课程页', async () => {
    const db = await openDb()
    const router = makeRouter()
    await router.push('/today')
    await router.isReady()
    const wrapper = mount(TodayPage, { props: { db }, global: { plugins: [router] } })
    wrappers.push(wrapper)
    await settle()
    await clickButton(wrapper, '开始今日练习')
    await settle()
    expect(router.currentRoute.value.path).toBe('/learn')
  })

  it('显示可继续的未完成练习', async () => {
    const db = await openDb()
    await makeSession(db, 'ui-11', 2)
    const router = makeRouter()
    await router.push('/today')
    await router.isReady()
    const wrapper = mount(TodayPage, { props: { db }, global: { plugins: [router] } })
    wrappers.push(wrapper)
    await settle()
    const resume = findButton(wrapper, '继续上次练习')
    expect(resume).toBeTruthy()
    await resume!.trigger('click')
    await settle()
    expect(router.currentRoute.value.path).toBe('/session/ui-11')
  })
})