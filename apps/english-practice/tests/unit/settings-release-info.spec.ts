import 'fake-indexeddb/auto'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from '../../src/features/settings/SettingsPage.vue'
import { db as defaultDb } from '../../src/data/db'

// T16：从手机页面确认版本——应用版本 + 构建 SHA + 内容包版本渲染在设置页

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/backup', component: { template: '<div />' } }],
})

describe('SettingsPage 版本区（T16）', () => {
  beforeEach(async () => {
    await defaultDb.settings.clear()
    vi.stubGlobal('__APP_VERSION__', '0.1.0')
    vi.stubGlobal('__BUILD_SHA__', 'a'.repeat(64))
  })

  it('渲染应用版本与构建 SHA', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ packs: [] }), { status: 200 })))
    const wrapper = mount(SettingsPage, { global: { plugins: [router] } })
    await flushPromises()
    const about = wrapper.find('.settings-release-info')
    expect(about.exists()).toBe(true)
    expect(about.text()).toContain('0.1.0')
    expect(about.text()).toContain('aaaaaaaa')
  })

  it('渲染内容包版本清单（catalog）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ packs: [{ id: 'gaokao-listening', version: '1.0.1', sha256: 'b'.repeat(64) }] }), { status: 200 })))
    const wrapper = mount(SettingsPage, { global: { plugins: [router] } })
    await flushPromises()
    const about = wrapper.find('.settings-release-info')
    expect(about.text()).toContain('gaokao-listening')
    expect(about.text()).toContain('1.0.1')
    expect(about.text()).toContain('bbbbbbbb')
  })

  it('catalog 请求失败 → 显示获取失败而不是崩溃或伪造', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const wrapper = mount(SettingsPage, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('.settings-release-info').text()).toContain('版本信息不可用')
  })

  it('R1：catalog 失败时仍显示构建期 appVersion/buildSha（离线行可记版本）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const wrapper = mount(SettingsPage, { global: { plugins: [router] } })
    await flushPromises()
    const text = wrapper.find('.settings-release-info').text()
    expect(text).toContain('0.1.0')
    expect(text).toContain('aaaaaaaa')
  })
})