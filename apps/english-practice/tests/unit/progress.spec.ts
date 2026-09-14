import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createRouter, createWebHashHistory, type RouterHistory } from 'vue-router'
import { pageToday, summarizeProgress, weekStart, type ProgressAttempt, type ProgressInput } from '../../src/domain/progress'
import { createTodaySession, enterCurrentSlot, submitAnswer } from '../../src/services/learning'
import ProgressPage from '../../src/features/progress/ProgressPage.vue'
import FeedbackPanel from '../../src/components/FeedbackPanel.vue'
import { createDatabase, deleteDatabase, type GaokaoDatabase } from '../../src/data/db'

const databases: GaokaoDatabase[] = []
const wrappers: { unmount: () => void }[] = []
const histories: RouterHistory[] = []

afterEach(async () => {
  vi.useRealTimers()
  while (wrappers.length > 0) (wrappers.pop() as unknown as { unmount: () => void }).unmount()
  for (const history of histories.splice(0)) history.destroy()
  while (databases.length > 0) await deleteDatabase(databases.pop()!)
})

const attempt = (overrides: Partial<ProgressAttempt>): ProgressAttempt => ({
  id: overrides.id ?? crypto.randomUUID(),
  itemId: 'vocab-join-a',
  familyId: 'join-context',
  kind: 'choice',
  level: 'G0',
  phase: 'first',
  studyDay: '2026-09-08',
  createdAt: '2026-09-08T00:00:00.000Z',
  gradeEarned: 1,
  gradePossible: 1,
  assisted: false,
  firstSeenSelf: true,
  ...overrides,
})

const baseInput = (overrides: Partial<ProgressInput> = {}): ProgressInput => ({
  today: '2026-09-09',
  attempts: [],
  totalItems: 8,
  exposedItemIds: [],
  units: [{ unitId: 'demo-school-club', titleZh: '校园社团' }],
  achievements: [],
  writingVersions: [],
  ...overrides,
})

describe('summarizeProgress 成长记录（P06）', () => {
  it('首次错后改对仍保留首次错误，订正不改客观正确率', () => {
    const summary = summarizeProgress(baseInput({
      attempts: [
        attempt({ id: 'a1', gradeEarned: 0, phase: 'first' }),
        attempt({ id: 'a2', gradeEarned: 1, phase: 'correction' }),
      ],
    }))
    expect(summary.objective).toEqual({ attempts: 1, correct: 0, rate: 0 })
  })

  it('重复同题10次不增加独立题数与发现家族', () => {
    const attempts = Array.from({ length: 10 }, (_, index) => attempt({ id: 'r' + index, phase: 'first' }))
    const summary = summarizeProgress(baseInput({ attempts }))
    expect(summary.independentItems).toBe(1)
    expect(summary.discoveredFamilies).toBe(1)
    expect(summary.objective.correct).toBe(10)
  })

  it('提示后完成计入提示完成数，不进独立正确率', () => {
    const summary = summarizeProgress(baseInput({
      attempts: [
        attempt({ id: 'a1', assisted: true }),
        attempt({ id: 'a2' }),
      ],
    }))
    expect(summary.objective).toEqual({ attempts: 1, correct: 1, rate: 1 })
    expect(summary.assistedCompletions).toBe(1)
  })

  it('writing 不进入客观分母与提示完成数', () => {
    const summary = summarizeProgress(baseInput({
      attempts: [
        attempt({ id: 'w1', kind: 'writing', gradeEarned: 1, gradePossible: 1 }),
        attempt({ id: 'a1', assisted: true }),
      ],
    }))
    expect(summary.objective).toEqual({ attempts: 0, correct: 0, rate: 0 })
    expect(summary.assistedCompletions).toBe(1)
  })

  it('学习日按有效任务去重，当天完成获得当日标记', () => {
    const summary = summarizeProgress(baseInput({
      today: '2026-09-09',
      attempts: [
        attempt({ id: 'a1', studyDay: '2026-09-07', createdAt: '2026-09-07T00:00:00.000Z' }),
        attempt({ id: 'a2', studyDay: '2026-09-07', createdAt: '2026-09-07T01:00:00.000Z' }),
        attempt({ id: 'a3', studyDay: '2026-09-09', createdAt: '2026-09-09T00:00:00.000Z' }),
      ],
    }))
    expect(summary.studyDays).toEqual(['2026-09-07', '2026-09-09'])
    expect(summary.todayMarked).toBe(true)
  })

  it('未见题数量=总条目-已曝光', () => {
    const summary = summarizeProgress(baseInput({ totalItems: 8, exposedItemIds: ['vocab-join-a', 'order-join-a'] }))
    expect(summary.unseenCount).toBe(6)
  })

  it('本周与前期按题型+层级分开成序列，不合并画统一曲线', () => {
    const summary = summarizeProgress(baseInput({
      today: '2026-09-09',
      attempts: [
        attempt({ id: 'a1', kind: 'choice', studyDay: '2026-09-08', gradeEarned: 1 }),
        attempt({ id: 'a2', kind: 'choice', studyDay: '2026-09-09', gradeEarned: 0 }),
        attempt({ id: 'a3', kind: 'reading', studyDay: '2026-09-09', gradeEarned: 1 }),
        attempt({ id: 'a4', kind: 'choice', level: 'G1', studyDay: '2026-09-09', gradeEarned: 1 }),
        attempt({ id: 'a5', kind: 'choice', studyDay: '2026-08-30', gradeEarned: 0 }),
      ],
    }))
    const choice = summary.series.find((serie) => serie.kind === 'choice' && serie.level === 'G0')
    const reading = summary.series.find((serie) => serie.kind === 'reading')
    const g1 = summary.series.find((serie) => serie.level === 'G1')
    expect(choice?.thisWeek).toEqual({ attempts: 2, correct: 1 })
    expect(choice?.earlier).toEqual({ attempts: 1, correct: 0 })
    expect(reading?.thisWeek).toEqual({ attempts: 1, correct: 1 })
    expect(reading?.earlier).toEqual({ attempts: 0, correct: 0 })
    expect(g1?.thisWeek).toEqual({ attempts: 1, correct: 1 })
  })

  it('地图节点按实际课程单元生成，首次完成单元的固定 key 只解锁一次', () => {
    const summary = summarizeProgress(baseInput({
      units: [
        { unitId: 'demo-school-club', titleZh: '校园社团' },
        { unitId: 'unit-writing', titleZh: '写作专项' },
      ],
      achievements: [
        { id: 'unit:first:demo-school-club', unlockedAt: '2026-09-08T00:00:00.000Z' },
        { id: 'unit:first:demo-school-club', unlockedAt: '2026-09-09T00:00:00.000Z' },
      ],
    }))
    expect(summary.mapNodes).toHaveLength(2)
    const node = summary.mapNodes.find((candidate) => candidate.unitId === 'demo-school-club')
    expect(node?.achievementId).toBe('unit:first:demo-school-club')
    expect(node?.unlocked).toBe(true)
    expect(node?.unlockedAt).toBe('2026-09-08T00:00:00.000Z')
    expect(summary.mapNodes.find((candidate) => candidate.unitId === 'unit-writing')?.unlocked).toBe(false)
  })

  it('自评只标自评：少于样本阈值显示数量不算正式能力等级', () => {
    const versions = (count: number) => Array.from({ length: count }, (_, index) => ({
      itemId: 'writing-' + index,
      createdAt: '2026-09-08T00:00:00.000Z',
      versionCount: 1,
      checklistCount: 1,
      firstText: '初稿内容',
      latestText: '初稿内容',
    }))
    const below = summarizeProgress(baseInput({ writingVersions: versions(2) }))
    expect(below.selfEvalSamples).toBe(2)
    expect(below.selfEvalFormal).toBe(false)
    const above = summarizeProgress(baseInput({ writingVersions: versions(3) }))
    expect(above.selfEvalSamples).toBe(3)
    expect(above.selfEvalFormal).toBe(true)
  })

  it('作品卡保存初稿与修改稿对比，不虚构进步结论', () => {
    const summary = summarizeProgress(baseInput({
      writingVersions: [{
        itemId: 'writing-invitation-a',
        createdAt: '2026-09-09T00:00:00.000Z',
        versionCount: 2,
        checklistCount: 4,
        firstText: 'Dear Chair, I want to join.',
        latestText: 'Dear Chair, I would like to join the club because I love reading.',
      }],
    }))
    expect(summary.writingCards).toHaveLength(1)
    const card = summary.writingCards[0]
    expect(card?.firstText).toBe('Dear Chair, I want to join.')
    expect(card?.latestText).toBe('Dear Chair, I would like to join the club because I love reading.')
    expect(card?.versionCount).toBe(2)
    expect(card?.conclusion).toBeUndefined()
  })
})

describe('weekStart 周起始（周一）', () => {
  it('跨月与年初计算正确', () => {
    expect(weekStart('2026-09-09')).toBe('2026-09-07')
    expect(weekStart('2026-09-07')).toBe('2026-09-07')
    expect(weekStart('2026-01-01')).toBe('2025-12-29')
  })
})

const mountPage = async (db: GaokaoDatabase, today?: string) => {
    const history = createWebHashHistory()
    histories.push(history)
    const router = createRouter({
      history,
      routes: [
        { path: '/', redirect: '/today' },
        { path: '/today', name: 'today', component: { template: '<div />' } },
        { path: '/progress', name: 'progress', component: ProgressPage },
        { path: '/:pathMatch(.*)*', redirect: '/today' },
      ],
    })
    await router.push('/progress')
    await router.isReady()
    const wrapper = mount(ProgressPage, { props: today === undefined ? { db } : { db, today }, global: { plugins: [router] } })
    wrappers.push(wrapper)
    for (let round = 0; round < 5; round += 1) {
      await flushPromises()
      if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0)
      else await new Promise((resolve) => { setTimeout(resolve, 0) })
    }
    return wrapper
}

const mountPageWithToday = async (db: GaokaoDatabase, today: string) => mountPage(db, today)

describe('ProgressPage 成长页', () => {
  it('展示独立正确率、学习日、未见题与地图节点', async () => {
    const db = createDatabase('gaokao-progress-' + crypto.randomUUID())
    await db.open()
    databases.push(db)
    const page = await mountPage(db)
    expect(page.text()).toContain('成长记录')
    expect(page.text()).toContain('未见题')
  })

  it('关闭动画偏好后不渲染奖励闪动，开启时可关闭', async () => {
    const db = createDatabase('gaokao-progress-' + crypto.randomUUID())
    await db.open()
    await db.settings.put({ id: 'personal', value: { profileId: 'gaokao-common-training-v1', grade: null, goal: null, defaultMinutes: 10, timeZone: 'Asia/Shanghai', sound: false, animation: false } })
    databases.push(db)
    const page = await mountPage(db)
    expect(page.find('.reward-flash').exists()).toBe(false)
    const panel = mount(FeedbackPanel, { props: { status: 'saved', message: '已保存', reward: { enabled: true, reduced: false } } })
    wrappers.push(panel)
    expect(panel.find('.reward-flash').exists()).toBe(true)
    await panel.find('.reward-flash .reward-close').trigger('click')
    expect(panel.find('.reward-flash').exists()).toBe(false)
  })
})

describe('T11 评审修复回归', () => {
  it('pageToday 采用设置时区的学习日（UTC 与上海日跨界窗口）', () => {
    // 上海时间 2026-09-12 00:30（UTC 仍为 2026-09-11）：学习日必须取上海日
    expect(pageToday(new Date('2026-09-11T16:30:00.000Z'), 'Asia/Shanghai')).toBe('2026-09-12')
    expect(pageToday(new Date('2026-09-11T15:30:00.000Z'), 'Asia/Shanghai')).toBe('2026-09-11')
    expect(pageToday(new Date('2026-09-11T15:30:00.000Z'), 'UTC')).toBe('2026-09-11')
  })

  it('todayMarked 注入学习日路径渲染当日标记', async () => {
    const db = createDatabase('gaokao-progress-' + crypto.randomUUID())
    await db.open()
    const packRecord = (await import('../fixtures/sample-pack.json')).default
    await db.packs.add({ id: packRecord.id, version: packRecord.version, status: 'installed', installedAt: new Date().toISOString(), resourcesReady: true, pack: packRecord })
    await db.attempts.add({
      id: 'tz-1',
      sessionId: 's1',
      slotId: 's1:vocab-join-a',
      phase: 'first',
      profileId: 'gaokao-common-training-v1',
      familyId: 'join-context',
      studyDay: '2026-09-12',
      createdAt: '2026-09-11T16:30:00.000Z',
      payload: { grade: { earned: 1, possible: 1 }, assistance: [], ref: { packId: 'p1', packVersion: '1.0.0', itemId: 'vocab-join-a' } },
    })
    await db.exposures.add({ packId: 'p1', packVersion: '1.0.0', itemId: 'vocab-join-a', profileId: 'gaokao-common-training-v1', familyId: 'join-context', firstSeenAt: '2026-09-11T16:30:00.000Z', studyDay: '2026-09-12', firstSeenSessionId: 's1' })
    databases.push(db)
    const page = await mountPageWithToday(db, '2026-09-12')
    expect(page.text()).toContain('今日已标记')
  })

  it('学习日口径包含提示后完成与写作任务', () => {
    const summary = summarizeProgress(baseInput({
      today: '2026-09-10',
      attempts: [attempt({ id: 'a1', assisted: true, studyDay: '2026-09-09', createdAt: '2026-09-09T00:00:00.000Z', gradeEarned: 1 })],
      writingVersions: [{ itemId: 'w1', createdAt: '2026-09-08T00:00:00.000Z', versionCount: 1, checklistCount: 1, firstText: 'x', latestText: 'x' }],
    }))
    expect(summary.studyDays).toEqual(['2026-09-08', '2026-09-09'])
  })

  it('自评样本按任务计数：同任务多版本不重复累加', () => {
    const summary = summarizeProgress(baseInput({
      writingVersions: [
        { itemId: 'w1', createdAt: '2026-09-08T00:00:00.000Z', versionCount: 3, checklistCount: 4, firstText: 'a', latestText: 'b' },
      ],
    }))
    expect(summary.selfEvalSamples).toBe(1)
    expect(summary.selfEvalFormal).toBe(false)
  })

  it('作品卡跨会话合并：版本数按记录数，初稿取最早创建', async () => {
    const db = createDatabase('gaokao-progress-' + crypto.randomUUID())
    await db.open()
    await db.settings.put({ id: 'personal', value: { profileId: 'gaokao-common-training-v1', grade: null, goal: null, defaultMinutes: 10, timeZone: 'Asia/Shanghai', sound: true, animation: true } })
    await db.writingVersions.bulkAdd([
      { id: 's2:w1:v1', sessionId: 's2', itemId: 'w1', createdAt: '2026-09-09T00:00:00.000Z', content: JSON.stringify({ content: '第二会话初稿', outline: '', checklist: [true], version: 1 }) },
      { id: 's1:w1:v1', sessionId: 's1', itemId: 'w1', createdAt: '2026-09-08T00:00:00.000Z', content: JSON.stringify({ content: '第一会话初稿', outline: '', checklist: [true, false], version: 1 }) },
    ])
    databases.push(db)
    const page = await mountPageWithToday(db, '2026-09-10')
    expect(page.text()).toContain('共 2 个版本')
    expect(page.text()).toContain('初稿：第一会话初稿')
    expect(page.text()).toContain('修改稿：第二会话初稿')
  })

  it('今日会话独立通过解锁条目所属单元成就，且首次时间不被覆盖', async () => {
    const db = createDatabase('gaokao-progress-' + crypto.randomUUID())
    await db.open()
    const packRecord = (await import('../fixtures/sample-pack.json')).default
    await db.packs.add({ id: packRecord.id, version: packRecord.version, status: 'installed', installedAt: new Date().toISOString(), resourcesReady: true, pack: packRecord })
    databases.push(db)
    const clock = { now: () => new Date('2026-09-10T00:00:00.000Z') }
    const passSlot = async (tag: string, slotIndex: number, profile: string) => {
      const created = await createTodaySession({ db, minutes: 5, profileId: profile, clock })
      if (!created.ok || created.value.kind !== 'session') throw new Error('expected session')
      const entered = await enterCurrentSlot(db, created.value.session.id, clock)
      if (!entered.ok) throw new Error(entered.error.messageZh)
      return submitAnswer(db, { id: tag, sessionId: created.value.session.id, slotId: entered.value.slots[slotIndex].id, expectedRevision: entered.value.revision, answer: { kind: 'choice', optionId: 'a' } }, clock)
    }
    const first = await passSlot('t11-1', 0, 'p-first')
    console.log('FIRST RESULT', JSON.stringify(first))
    expect(first).toMatchObject({ ok: true })
    const achievements = await db.achievements.toArray()
    expect(achievements.filter((row) => row.id === 'unit:first:demo-school-club')).toHaveLength(1)
    const unlockedAt = achievements.find((row) => row.id === 'unit:first:demo-school-club')?.unlockedAt
    // 第二个条目独立通过：同单元成就不重复、首次时间不被覆盖
    const second = await passSlot('t11-2', 3, 'p-second')
    expect(second).toMatchObject({ ok: true })
    const after = await db.achievements.toArray()
    expect(after.filter((row) => row.id === 'unit:first:demo-school-club')).toHaveLength(1)
    expect(after.find((row) => row.id === 'unit:first:demo-school-club')?.unlockedAt).toBe(unlockedAt)
  })
})