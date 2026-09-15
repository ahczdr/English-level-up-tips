import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import TodayPage from '../../src/features/today/TodayPage.vue'
import SettingsPage from '../../src/features/settings/SettingsPage.vue'
import OnboardingPage from '../../src/features/onboarding/OnboardingPage.vue'
import { createDatabase, deleteDatabase, type GaokaoDatabase } from '../../src/data/db'

// onboarding 可达性：SettingsPage 补齐年级/目标/默认时长字段；TodayPage 首启引导卡片
const databases: GaokaoDatabase[] = []

afterEach(async () => {
  while (databases.length > 0) await deleteDatabase(databases.pop()!)
})

const openDb = async () => {
  const db = createDatabase(`gaokao-setup-${crypto.randomUUID()}`)
  await db.open()
  databases.push(db)
  return db
}

const makeRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/today', component: TodayPage },
      { path: '/onboarding', component: { template: '<div />' } },
      { path: '/backup', component: { template: '<div />' } },
      { path: '/settings', component: SettingsPage },
    ],
  })

describe('SettingsPage 练习偏好字段', () => {
  it('空库显示默认值，保存后写入合并的 personal 记录', async () => {
    const db = await openDb()
    const router = makeRouter()
    const wrapper = mount(SettingsPage, { props: { db }, global: { plugins: [router] } })
    await flushPromises()
    const gradeSelect = wrapper.find('[data-testid="settings-grade"]')
    expect((gradeSelect.element as HTMLSelectElement).value).toBe('')
    await gradeSelect.setValue('高二')
    await wrapper.find('[data-testid="settings-goal"]').setValue('补基础语法')
    await wrapper.findAll('.duration-option')[2].trigger('click')
    await flushPromises()
    const row = await db.settings.get('personal')
    expect(row?.value).toMatchObject({
      profileId: 'gaokao-common-training-v1',
      grade: '高二',
      goal: '补基础语法',
      defaultMinutes: 15,
      sound: true,
      timeZone: 'Asia/Shanghai',
    })
  })

  it('已有设置回显各字段，保存保留未改动的音效与时区', async () => {
    const db = await openDb()
    await db.settings.put({
      id: 'personal',
      value: { profileId: 'gaokao-common-training-v1', grade: '高一', goal: '词汇', defaultMinutes: 25, timeZone: 'UTC', sound: false, animation: true },
    })
    const router = makeRouter()
    const wrapper = mount(SettingsPage, { props: { db }, global: { plugins: [router] } })
    await flushPromises()
    expect((wrapper.find('[data-testid="settings-grade"]').element as HTMLSelectElement).value).toBe('高一')
    expect((wrapper.find('[data-testid="settings-goal"]').element as HTMLInputElement).value).toBe('词汇')
    await wrapper.find('[data-testid="settings-grade"]').setValue('高三')
    await flushPromises()
    const row = await db.settings.get('personal')
    expect(row?.value).toMatchObject({ grade: '高三', defaultMinutes: 25, sound: false, timeZone: 'UTC' })
  })
})

describe('TodayPage 首启设置引导', () => {
  it('无 personal 记录时显示学习设置入口；保存后不再出现', async () => {
    const db = await openDb()
    const router = makeRouter()
    const first = mount(TodayPage, { props: { db }, global: { plugins: [router] } })
    // loadState 跨多个 IndexedDB 宏任务，等待 needsSetup 生效而非单次 flush
    await vi.waitFor(() => expect(first.find('.today-setup-link').exists()).toBe(true))
    first.unmount()
    await db.settings.put({
      id: 'personal',
      value: { profileId: 'gaokao-common-training-v1', grade: null, goal: null, defaultMinutes: 10, timeZone: 'Asia/Shanghai', sound: true, animation: true },
    })
    const second = mount(TodayPage, { props: { db }, global: { plugins: [router] } })
    // 冲洗足够多宏任务确保 loadState 完整跑完（含 settings.get），再断言入口已消失
    for (let i = 0; i < 6; i += 1) {
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(second.find('.today-setup-link').exists()).toBe(false)
    second.unmount()
  })
})

describe('CR20 onboarding 跳过与合并保存', () => {
  it('跳过也落 personal 记录，返回今日页后引导卡不再重现', async () => {
    const db = await openDb()
    const router = makeRouter()
    await router.push('/onboarding')
    await router.isReady()
    const wrapper = mount(OnboardingPage, { props: { db }, global: { plugins: [router] } })
    await flushPromises()
    const skipButton = wrapper.findAll('button').find((button) => button.text() === '跳过')
    expect(skipButton).toBeDefined()
    await skipButton!.trigger('click')
    await flushPromises()
    expect(await db.settings.get('personal')).toBeDefined()
    const today = mount(TodayPage, { props: { db }, global: { plugins: [router] } })
    for (let i = 0; i < 6; i += 1) {
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(today.find('.today-setup-link').exists()).toBe(false)
    today.unmount()
  })

  it('onboarding 保存只覆盖本页字段，不重置音效与时区（读-合并-写）', async () => {
    const db = await openDb()
    await db.settings.put({
      id: 'personal',
      value: { profileId: 'gaokao-common-training-v1', grade: '高一', goal: '词汇', defaultMinutes: 25, timeZone: 'UTC', sound: false, animation: true },
    })
    const router = makeRouter()
    await router.push('/onboarding')
    await router.isReady()
    const wrapper = mount(OnboardingPage, { props: { db }, global: { plugins: [router] } })
    await flushPromises()
    await wrapper.find('select').setValue('高三')
    const saveButton = wrapper.findAll('button').find((button) => button.text() === '保存设置')
    expect(saveButton).toBeDefined()
    await saveButton!.trigger('click')
    await flushPromises()
    const row = await db.settings.get('personal')
    expect(row?.value).toMatchObject({ grade: '高三', defaultMinutes: 25, timeZone: 'UTC', sound: false, animation: true })
  })
})

describe('CR27 设置保存失败反馈', () => {
  it('保存失败时提示失败，不残留「偏好已保存」', async () => {
    const failingDb = {
      settings: {
        get: async () => undefined,
        put: async () => {
          throw new Error('quota exceeded')
        },
      },
    } as unknown as GaokaoDatabase
    const router = makeRouter()
    const wrapper = mount(SettingsPage, { props: { db: failingDb }, global: { plugins: [router] } })
    await flushPromises()
    await wrapper.find('[data-testid="settings-grade"]').setValue('高一')
    await flushPromises()
    const message = wrapper.find('.settings-message').text()
    expect(message).not.toBe('偏好已保存')
    expect(message).toContain('保存失败')
  })
})
