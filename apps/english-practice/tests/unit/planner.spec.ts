import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createRouter, createWebHashHistory, type RouterHistory } from 'vue-router'
import samplePack from '../fixtures/sample-pack.json'
import { planToday, suggestLevelUp, type PlanGroup, type PlanTodayInput } from '../../src/domain/planner'
import { collectLevelUpEvidence, createSession, createTodaySession, enterCurrentSlot, previewTodayPlan, revealHint, submitAnswer } from '../../src/services/learning'
import type { CoursePack, Item } from '../../src/content/types'
import { createDatabase, deleteDatabase, type GaokaoDatabase } from '../../src/data/db'
import TodayPage from '../../src/features/today/TodayPage.vue'
import ReviewPage from '../../src/features/review/ReviewPage.vue'
import SessionPage from '../../src/features/practice/SessionPage.vue'
import OnboardingPage from '../../src/features/onboarding/OnboardingPage.vue'
import LearnPage from '../../src/features/learn/LearnPage.vue'

const pack = samplePack as unknown as CoursePack
const profileId = 'gaokao-common-training-v1'

const group = (overrides: Partial<PlanGroup> & { id: string; seconds: number; count?: number }): PlanGroup => {
  const count = overrides.count ?? 1
  const items = Array.from({ length: count }, (_, index) => ({
    id: `${overrides.id}-item-${index}`,
    familyId: overrides.items?.[0]?.familyId ?? `family-${overrides.id}`,
    reviewMode: overrides.items?.[0]?.reviewMode ?? 'recognition',
    level: 'G0' as const,
    estimatedSeconds: Math.floor(overrides.seconds / count),
    packId: 'p1',
    packVersion: '1.0.0',
    unitId: overrides.id,
    unitTitleZh: overrides.id,
  }))
  return {
    packId: 'p1',
    packVersion: '1.0.0',
    unitId: overrides.id,
    unitTitleZh: overrides.id,
    kind: overrides.kind ?? 'new',
    dueDay: overrides.dueDay,
    familiarRetry: overrides.familiarRetry,
    items,
  }
}

const planInput = (overrides: Partial<PlanTodayInput>): PlanTodayInput => ({
  today: '2026-09-10',
  budgetSeconds: 300,
  seed: 'seed-1',
  groups: [],
  dueReviews: [],
  exposedItemIds: [],
  ...overrides,
})

const wrappers: { unmount: () => void }[] = []
const histories: RouterHistory[] = []
const databases: GaokaoDatabase[] = []

const openDb = async (options: { withPack?: boolean } = {}) => {
  const db = createDatabase(`gaokao-planner-${crypto.randomUUID()}`)
  await db.open()
  if (options.withPack !== false) {
    await db.packs.add({ id: pack.id, version: pack.version, status: 'installed', pack, installedAt: new Date().toISOString(), resourcesReady: true })
  }
  databases.push(db)
  return db
}

const mountPage = async (db: GaokaoDatabase, path: string) => {
  const history = createWebHashHistory()
  histories.push(history)
  const router = createRouter({
    history,
    routes: [
      { path: '/', redirect: '/today' },
      { path: '/today', name: 'today', component: TodayPage },
      { path: '/review', name: 'review', component: ReviewPage },
      { path: '/onboarding', name: 'onboarding', component: OnboardingPage },
      { path: '/learn', name: 'learn', component: LearnPage },
      { path: '/session/:id', name: 'session', component: SessionPage },
      { path: '/:pathMatch(.*)*', redirect: '/today' },
    ],
  })
  await router.push(path)
  await router.isReady()
  const component = path.startsWith('/review') ? ReviewPage : TodayPage
  const wrapper = mount(component, { props: { db }, global: { plugins: [router] } })
  wrappers.push(wrapper)
  for (let round = 0; round < 5; round += 1) {
    await flushPromises()
    await new Promise((resolve) => { setTimeout(resolve, 0) })
  }
  return wrapper
}

afterEach(async () => {
  while (wrappers.length > 0) (wrappers.pop() as unknown as { unmount: () => void }).unmount()
  for (const history of histories.splice(0)) history.destroy()
  window.location.hash = ''
  while (databases.length > 0) await deleteDatabase(databases.pop()!)
})

describe('planToday 今日规划', () => {
  it('5 分钟装不下预计 360 秒的七选五组，可选短组', () => {
    const result = planToday(planInput({
      budgetSeconds: 300,
      groups: [group({ id: 'seven-match', seconds: 360 }), group({ id: 'short', seconds: 120 })],
    }))
    expect(result.groups.map((candidate) => candidate.unitId)).toEqual(['short'])
    expect(result.totalSeconds).toBe(120)
    expect(result.needsLongerSession).toBe(false)
  })

  it('没有任何可装下的组时给真实空态', () => {
    const result = planToday(planInput({
      budgetSeconds: 300,
      groups: [group({ id: 'big', seconds: 360 })],
    }))
    expect(result.groups).toHaveLength(0)
    expect(result.needsLongerSession).toBe(true)
  })

  it('10 个过期组只装入预算内部分，其余仍到期（输入不改写）', () => {
    const dueReviews = Array.from({ length: 10 }, (_, index) => ({
      familyId: `family-${index}`,
      reviewMode: 'recognition',
      dueDay: `2026-09-${String(index + 1).padStart(2, '0')}`,
    }))
    const groups = dueReviews.map((review) => group({
      id: `u-${review.familyId}`,
      seconds: 100,
      kind: 'review',
      dueDay: review.dueDay,
      items: [{ familyId: review.familyId, reviewMode: review.reviewMode } as PlanGroup['items'][number]],
    }))
    const result = planToday(planInput({ budgetSeconds: 350, groups, dueReviews }))
    expect(result.groups).toHaveLength(3)
    expect(result.groups.map((candidate) => candidate.dueDay)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03'])
    expect(dueReviews).toEqual(Array.from({ length: 10 }, (_, index) => ({
      familyId: `family-${index}`,
      reviewMode: 'recognition',
      dueDay: `2026-09-${String(index + 1).padStart(2, '0')}`,
    })))
    expect(result.totalSeconds).toBe(300)
  })

  it('同一输入规划完全确定（冻结抽题的函数基础）', () => {
    const input = planInput({
      budgetSeconds: 600,
      groups: [group({ id: 'a', seconds: 100 }), group({ id: 'b', seconds: 100 })],
      dueReviews: [
        { familyId: 'f1', reviewMode: 'recognition', dueDay: '2026-09-09' },
        { familyId: 'f2', reviewMode: 'recognition', dueDay: '2026-09-09' },
      ],
    })
    const first = planToday(input)
    const second = planToday(input)
    expect(first).toEqual(second)
  })

  it('新内容超过 5 题上限的组被跳过（不拆组），新词句最多 5 个', () => {
    const result = planToday(planInput({
      budgetSeconds: 900,
      groups: [group({ id: 'three', seconds: 150, count: 3 }), group({ id: 'another-three', seconds: 150, count: 3 })],
    }))
    expect(result.groups.map((candidate) => candidate.unitId)).toEqual(['three'])
    expect(result.newCount).toBe(3)
  })

  it('复习积压时新内容可为 0', () => {
    const dueReviews = [
      { familyId: 'f1', reviewMode: 'recognition', dueDay: '2026-09-09' },
      { familyId: 'f2', reviewMode: 'recognition', dueDay: '2026-09-09' },
    ]
    const groups = [
      group({ id: 'review-1', seconds: 150, count: 2, kind: 'review', dueDay: '2026-09-09', items: [{ familyId: 'f1', reviewMode: 'recognition' } as PlanGroup['items'][number]] }),
      group({ id: 'review-2', seconds: 150, count: 2, kind: 'review', dueDay: '2026-09-09', items: [{ familyId: 'f2', reviewMode: 'recognition' } as PlanGroup['items'][number]] }),
      group({ id: 'new-1', seconds: 120, count: 2 }),
    ]
    const result = planToday(planInput({ budgetSeconds: 300, groups, dueReviews }))
    expect(result.reviewCount).toBe(4)
    expect(result.newCount).toBe(0)
  })

  it('全部已曝光的复习组标记熟题复习，未见组不标', () => {
    const seen = group({ id: 'seen', seconds: 100, count: 2, kind: 'review', dueDay: '2026-09-09', items: [{ familyId: 'f1', reviewMode: 'recognition' } as PlanGroup['items'][number]] })
    const fresh = group({ id: 'fresh', seconds: 100, count: 2, kind: 'review', dueDay: '2026-09-09', items: [{ familyId: 'f2', reviewMode: 'recognition' } as PlanGroup['items'][number]] })
    const result = planToday(planInput({
      budgetSeconds: 300,
      groups: [seen, fresh],
      dueReviews: [
        { familyId: 'f1', reviewMode: 'recognition', dueDay: '2026-09-09' },
        { familyId: 'f2', reviewMode: 'recognition', dueDay: '2026-09-09' },
      ],
      exposedItemIds: seen.items.map((item) => item.id),
    }))
    expect(result.groups.find((candidate) => candidate.unitId === 'seen')?.familiarRetry).toBe(true)
    expect(result.groups.find((candidate) => candidate.unitId === 'fresh')?.familiarRetry ?? false).toBe(false)
  })
})

describe('suggestLevelUp 分层建议（P03）', () => {
  it('达标时建议升层', () => {
    const suggestion = suggestLevelUp({ firstAttempts: 12, distinctDays: 3, families: 4, accuracy: 0.85, consecutiveFirstErrors: 0 }, 'G0')
    expect(suggestion.kind).toBe('up')
    if (suggestion.kind === 'up') expect(suggestion.toLevel).toBe('G1')
  })

  it('样本不足显示数量并待复测', () => {
    const suggestion = suggestLevelUp({ firstAttempts: 4, distinctDays: 2, families: 2, accuracy: 0.9, consecutiveFirstErrors: 0 }, 'G0')
    expect(suggestion.kind).toBe('hold')
    if (suggestion.kind === 'hold') expect(suggestion.sampleShown).toContain('4/10')
  })

  it('连续 3 次首次错误给基础支持而不是升层', () => {
    const suggestion = suggestLevelUp({ firstAttempts: 15, distinctDays: 4, families: 5, accuracy: 0.9, consecutiveFirstErrors: 3 }, 'G0')
    expect(suggestion.kind).toBe('support')
  })

  it('学习日或家族数不足时保持待复测', () => {
    const singleDay = suggestLevelUp({ firstAttempts: 12, distinctDays: 1, families: 4, accuracy: 1, consecutiveFirstErrors: 0 }, 'G0')
    expect(singleDay.kind).toBe('hold')
    const fewFamilies = suggestLevelUp({ firstAttempts: 12, distinctDays: 3, families: 2, accuracy: 1, consecutiveFirstErrors: 0 }, 'G0')
    expect(fewFamilies.kind).toBe('hold')
  })
})

describe('createTodaySession 今日会话服务', () => {
  it('到期复习组优先进入今日会话，抽题结果持久化冻结', async () => {
    const db = await openDb()
    const vocab = pack.items.find((item) => item.id === 'vocab-join-a') as Item
    await db.reviewStates.put({
      profileId,
      familyId: vocab.familyId,
      reviewMode: vocab.reviewMode,
      dueDay: '2026-09-09',
      updatedAt: '2026-09-08T00:00:00.000Z',
      data: { stage: 0, dueDay: '2026-09-09', lastAppliedDay: '2026-09-08', lapses: 0 },
    })
    const created = await createTodaySession({ db, minutes: 5, profileId, clock: { now: () => new Date('2026-09-10T00:00:00.000Z') } })
    expect(created.ok).toBe(true)
    if (!created.ok || created.value.kind !== 'session') return
    const session = created.value.session
    expect(session.studyDay).toBe('2026-09-10')
    expect(session.slots[0]?.ref.itemId).toBe('vocab-join-a')
    const reloaded = await db.sessions.get(session.id)
    expect(reloaded?.slots.map((slot) => slot.ref.itemId)).toEqual(session.slots.map((slot) => slot.ref.itemId))
  })

  it('预算装不下任何组时返回 INSUFFICIENT_SPACE', async () => {
    const custom = structuredClone(pack)
    custom.units = [{ ...custom.units[0], id: 'unit-gap-only', itemIds: ['gap-reading-plan-a'], familyIds: ['cloze-help-context'], prerequisiteSkillIds: [] }]
    const db = createDatabase(`gaokao-planner-${crypto.randomUUID()}`)
    await db.open()
    await db.packs.add({ id: custom.id, version: custom.version, status: 'installed', pack: custom, installedAt: new Date().toISOString(), resourcesReady: true })
    databases.push(db)
    const created = await createTodaySession({ db, minutes: 5, profileId })
    expect(created).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_SPACE' } })
  })

  it('无任何课程内容时返回 CONTENT_MISSING', async () => {
    const db = await openDb({ withPack: false })
    const created = await createTodaySession({ db, minutes: 10, profileId })
    expect(created).toMatchObject({ ok: false, error: { code: 'CONTENT_MISSING' } })
  })

  it('previewTodayPlan 返回可展示的计划摘要', async () => {
    const db = await openDb()
    const preview = await previewTodayPlan({ db, minutes: 5, profileId, clock: { now: () => new Date('2026-09-10T00:00:00.000Z') } })
    expect(preview.ok).toBe(true)
    if (preview.ok) {
      expect(preview.value.plan.groups.length).toBeGreaterThan(0)
      expect(preview.value.today).toBe('2026-09-10')
    }
  })
})

describe('今日与复习页面', () => {
  it('TodayPage 渲染今日计划卡并可一键开始（进入会话页）', async () => {
    const db = await openDb()
    const page = await mountPage(db, '/today')
    expect(page.text()).toContain('今日计划')
    const start = page.findAll('button').find((button) => button.text() === '开始今日计划')
    expect(start).toBeTruthy()
    await start!.trigger('click')
    for (let round = 0; round < 6; round += 1) {
      await flushPromises()
      await new Promise((resolve) => { setTimeout(resolve, 0) })
    }
    expect(window.location.hash).toContain('#/session/')
  })

  it('ReviewPage 列出到期复习并显示空态', async () => {
    const empty = await mountPage(await openDb(), '/review')
    expect(empty.text()).toContain('暂无到期复习')
    empty.unmount()
    const db = await openDb()
    await db.reviewStates.put({
      profileId,
      familyId: 'join-context',
      reviewMode: 'recognition',
      dueDay: '2026-09-09',
      updatedAt: '2026-09-08T00:00:00.000Z',
      data: { stage: 0, dueDay: '2026-09-09', lastAppliedDay: '2026-09-08', lapses: 0 },
    })
    const page = await mountPage(db, '/review')
    expect(page.text()).toContain('join-context')
    expect(page.text()).toContain('已到期')
  })
})
describe('collectLevelUpEvidence P03 证据忠实性', () => {
  const clock = { now: () => new Date('2026-09-10T00:00:00.000Z') }

  const firstSession = async (db: GaokaoDatabase) => {
    const created = await createSession({ db, unitId: 'demo-school-club', minutes: 5, profileId })
    if (!created.ok || created.value.kind !== 'session') throw new Error('expected session')
    const entered = await enterCurrentSlot(db, created.value.session.id, clock)
    if (!entered.ok) throw new Error(entered.error.messageZh)
    return entered.value
  }

  it('提示后正确与熟题重试不进有效独立样本', async () => {
    const db = await openDb()
    const a = await firstSession(db)
    await submitAnswer(db, { id: 'ev-a-1', sessionId: a.id, slotId: a.slots[0].id, expectedRevision: a.revision, answer: { kind: 'choice', optionId: 'b' } }, clock)
    const b = await firstSession(db)
    await submitAnswer(db, { id: 'ev-b-1', sessionId: b.id, slotId: b.slots[0].id, expectedRevision: b.revision, answer: { kind: 'choice', optionId: 'a' } }, clock)
    const c = await firstSession(db)
    await revealHint(db, { sessionId: c.id, slotId: c.slots[3].id, hint: 'translation', expectedRevision: c.revision }, clock)
    await submitAnswer(db, { id: 'ev-c-1', sessionId: c.id, slotId: c.slots[3].id, expectedRevision: c.revision + 1, answer: { kind: 'choice', optionId: 'a' } }, clock)
    const evidence = await collectLevelUpEvidence(db, profileId)
    expect(evidence.ok).toBe(true)
    if (!evidence.ok) return
    expect(evidence.value.evidence.firstAttempts).toBe(1)
    expect(evidence.value.evidence.accuracy).toBe(0)
  })

  it('连续首次错误只统计有效独立首次，提示后正确不打断也不计入', async () => {
    const db = await openDb()
    const a = await firstSession(db)
    await submitAnswer(db, { id: 'st-a-1', sessionId: a.id, slotId: a.slots[0].id, expectedRevision: a.revision, answer: { kind: 'choice', optionId: 'b' } }, clock)
    const b = await firstSession(db)
    await revealHint(db, { sessionId: b.id, slotId: b.slots[0].id, hint: 'translation', expectedRevision: b.revision }, clock)
    await submitAnswer(db, { id: 'st-b-1', sessionId: b.id, slotId: b.slots[0].id, expectedRevision: b.revision + 1, answer: { kind: 'choice', optionId: 'a' } }, clock)
    const c = await firstSession(db)
    await submitAnswer(db, { id: 'st-c-1', sessionId: c.id, slotId: c.slots[3].id, expectedRevision: c.revision, answer: { kind: 'choice', optionId: 'b' } }, clock)
    const evidence = await collectLevelUpEvidence(db, profileId)
    expect(evidence.ok).toBe(true)
    if (!evidence.ok) return
    expect(evidence.value.evidence.consecutiveFirstErrors).toBe(2)
  })
})

describe('createTodaySession 同日冻结与 unitId', () => {
  const clock = { now: () => new Date('2026-09-10T00:00:00.000Z') }

  it('同日重复开始复用同一会话与抽题（不重新抽题）', async () => {
    const db = await openDb()
    const first = await createTodaySession({ db, minutes: 5, profileId, clock })
    expect(first.ok).toBe(true)
    if (!first.ok || first.value.kind !== 'session') return
    const second = await createTodaySession({ db, minutes: 5, profileId, clock })
    expect(second.ok).toBe(true)
    if (!second.ok || second.value.kind !== 'session') return
    expect(second.value.session.id).toBe(first.value.session.id)
    expect(second.value.session.slots.map((slot) => slot.ref.itemId)).toEqual(first.value.session.slots.map((slot) => slot.ref.itemId))
  })

  it('会话已完成或跨日则另建新会话', async () => {
    const db = await openDb()
    const first = await createTodaySession({ db, minutes: 5, profileId, clock })
    if (!first.ok || first.value.kind !== 'session') return
    await db.sessions.update(first.value.session.id, { state: 'completed' })
    const again = await createTodaySession({ db, minutes: 5, profileId, clock })
    expect(again.ok).toBe(true)
    if (!again.ok || again.value.kind !== 'session') return
    expect(again.value.session.id).not.toBe(first.value.session.id)
    const nextDay = await createTodaySession({ db, minutes: 5, profileId, clock: { now: () => new Date('2026-09-11T00:00:00.000Z') } })
    expect(nextDay.ok).toBe(true)
    if (!nextDay.ok || nextDay.value.kind !== 'session') return
    expect(nextDay.value.session.studyDay).toBe('2026-09-11')
    expect(nextDay.value.session.id).not.toBe(again.value.session.id)
  })

  it('今日会话 unitId 为 null：独立通过按条目所属单元解锁且幂等', async () => {
    const db = await openDb()
    const created = await createTodaySession({ db, minutes: 5, profileId, clock })
    expect(created.ok).toBe(true)
    if (!created.ok || created.value.kind !== 'session') return
    const session = created.value.session
    expect(session.unitId).toBeNull()
    const entered = await enterCurrentSlot(db, session.id, clock)
    expect(entered.ok).toBe(true)
    if (!entered.ok) return
    const submitted = await submitAnswer(db, { id: 'ach-1', sessionId: session.id, slotId: entered.value.slots[0].id, expectedRevision: entered.value.revision, answer: { kind: 'choice', optionId: 'a' } }, clock)
    expect(submitted.ok).toBe(true)
    const unitAchievements = await db.achievements.toArray().then((rows) => rows.filter((row) => row.id.startsWith('unit:first:')))
    expect(unitAchievements).toHaveLength(1)
    expect(unitAchievements[0]?.id).toBe('unit:first:demo-school-club')
  })
})
