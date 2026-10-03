import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createRouter, createWebHashHistory, type RouterHistory } from 'vue-router'
import ReviewPage from '../../src/features/review/ReviewPage.vue'
import { createDatabase, deleteDatabase, type GaokaoDatabase } from '../../src/data/db'

const databases: GaokaoDatabase[] = []
const histories: RouterHistory[] = []

afterEach(async () => {
  vi.useRealTimers()
  while (histories.length > 0) histories.pop()!.destroy()
  while (databases.length > 0) await deleteDatabase(databases.pop()!)
})

it('复习列表按个人时区判断到期状态', async () => {
  vi.useFakeTimers({ now: new Date('2026-09-11T16:30:00.000Z'), toFake: ['Date'] })
  const db = createDatabase('gaokao-review-' + crypto.randomUUID())
  await db.open()
  await db.settings.put({ id: 'personal', value: { profileId: 'gaokao-common-training-v1', grade: null, goal: null, defaultMinutes: 10, timeZone: 'UTC', sound: true, animation: true } })
  await db.reviewStates.add({
    profileId: 'gaokao-common-training-v1',
    familyId: 'family-a',
    reviewMode: 'recognition',
    dueDay: '2026-09-12',
    updatedAt: '2026-09-11T16:30:00.000Z',
    data: { stage: 1, lapses: 0 },
  })
  databases.push(db)
  const history = createWebHashHistory()
  histories.push(history)
  const router = createRouter({
    history,
    routes: [{ path: '/review', component: ReviewPage }, { path: '/today', component: { template: '<div />' } }],
  })
  await router.push('/review')
  await router.isReady()
  const page = mount(ReviewPage, { props: { db }, global: { plugins: [router] } })
  await flushPromises()
  await flushPromises()
  expect(page.text()).toContain('未到期')
  expect(page.text()).not.toContain('已到期')
  page.unmount()
})
