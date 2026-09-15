import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import App from '../../src/app/App.vue'
import { createAppRouter } from '../../src/app/router'

// CR24：主按钮在加载完成前处于 disabled；与真实用户一致，先等 loadState 结束再点击
const settleToday = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('App UI', () => {
  let router: ReturnType<typeof createAppRouter>
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    router = createAppRouter()
    wrapper = undefined
  })

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount()
    }
  })

  it('renders the primary practice button', async () => {
    wrapper = mount(App, {
      global: {
        plugins: [router],
      },
    })
    await router.push('/today')
    await router.isReady()
    await router.isReady()

    const button = wrapper.get('button')
    expect(button.text()).toBe('开始今日练习')
    expect(button.attributes('type')).toBe('button')
  })

  it('shows empty status after clicking when no content is prepared', async () => {
    wrapper = mount(App, {
      global: {
        plugins: [router],
      },
    })
    await router.push('/today')
    await router.isReady()
    await router.isReady()

    const button = wrapper.get('button')
    await settleToday()
    await button.trigger('click')
    await flushPromises()

    const status = wrapper.get('[role="status"]')
    expect(status.text()).toContain('暂无可用课程')
    expect(status.text()).toContain('请先准备学习内容')
    expect(wrapper.text()).not.toContain('会话')
    expect(wrapper.text()).not.toContain('成绩')
  })

  it('keeps a single status element after repeated clicks', async () => {
    wrapper = mount(App, {
      global: {
        plugins: [router],
      },
    })
    await router.push('/today')
    await router.isReady()
    await router.isReady()

    const button = wrapper.get('button')
    await settleToday()
    await button.trigger('click')
    await button.trigger('click')
    await button.trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[role="status"]')).toHaveLength(1)
    expect(wrapper.findAll('button')).toHaveLength(1)
  })
})

describe('App router', () => {
  it('redirects the root path to /today', async () => {
    const router = createAppRouter()
    await router.push('/')
    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/today')
    expect(window.location.hash).toBe('#/today')
  })

  it('uses hash history provided by createAppRouter', async () => {
    const router = createAppRouter()
    const initialPath = router.currentRoute.value.path
    expect(['/', '/today']).toContain(initialPath)

    await router.push('/today')
    await router.isReady()
    expect(router.currentRoute.value.path).toBe('/today')
    expect(window.location.hash).toBe('#/today')
  })
})
