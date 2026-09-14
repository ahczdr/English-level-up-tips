import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createRouter, createWebHashHistory, type RouterHistory } from 'vue-router'
import listeningPack from '../fixtures/listening-pack.json'
import AudioPlayer from '../../src/components/AudioPlayer.vue'
import SessionPage from '../../src/features/practice/SessionPage.vue'
import TodayPage from '../../src/features/today/TodayPage.vue'
import OnboardingPage from '../../src/features/onboarding/OnboardingPage.vue'
import LearnPage from '../../src/features/learn/LearnPage.vue'
import type { CoursePack } from '../../src/content/types'
import { createDatabase, deleteDatabase, type GaokaoDatabase } from '../../src/data/db'
import { createSession, recordReplay, setAudioSpeed } from '../../src/services/learning'
import { downloadPackAssets, getPackAssetBytes } from '../../src/services/content'

const pack = listeningPack as unknown as CoursePack
const STUB_BYTES = new Uint8Array(8).fill(7)

const wrappers: VueWrapper[] = []
const histories: RouterHistory[] = []
const databases: GaokaoDatabase[] = []

const openDb = async (resourcesReady = false) => {
  const db = createDatabase(`gaokao-audio-${crypto.randomUUID()}`)
  await db.open()
  await db.packs.add({ id: pack.id, version: pack.version, status: 'installed', pack, installedAt: new Date().toISOString(), resourcesReady })
  databases.push(db)
  return db
}

const fetchStubBytes = async (): Promise<ArrayBuffer> => STUB_BYTES.slice().buffer

const makeSession = async (db: GaokaoDatabase, id: string) => {
  const created = await createSession({ db, unitId: 'unit-listening', minutes: 5, profileId: 'gaokao-common-training-v1', idGenerator: () => id })
  if (!created.ok || created.value.kind !== 'session') throw new Error('expected session')
  return created.value.session
}

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
      { path: '/today', name: 'today', component: TodayPage },
      { path: '/onboarding', name: 'onboarding', component: OnboardingPage },
      { path: '/learn', name: 'learn', component: LearnPage },
      { path: '/session/:id', name: 'session', component: SessionPage },
      { path: '/:pathMatch(.*)*', redirect: '/today' },
    ],
  })
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

let playSpy: ReturnType<typeof vi.spyOn> | null = null
let pauseSpy: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => {
  playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockReturnValue(undefined)
})

afterEach(async () => {
  // 先卸载组件（内部会调用 pause），再还原 spy，避免 jsdom 未实现的 pause 真身被调用
  while (wrappers.length > 0) wrappers.pop()!.unmount()
  playSpy?.mockRestore()
  pauseSpy?.mockRestore()
  playSpy = null
  pauseSpy = null
  vi.restoreAllMocks()
  for (const history of histories.splice(0)) history.destroy()
  window.location.hash = ''
  while (databases.length > 0) await deleteDatabase(databases.pop()!)
})

describe('音频资产下载与读取', () => {
  it('下载后存入 downloadJobs 并置 resourcesReady', async () => {
    const db = await openDb(false)
    const result = await downloadPackAssets({ db, packId: pack.id, version: pack.version, fetchBinary: fetchStubBytes })
    expect(result.ok).toBe(true)
    const job = await db.downloadJobs.get([pack.id, pack.version])
    expect(job?.status).toBe('ready')
    const stored = (job?.data as { assets: Record<string, { sha256: string; data: ArrayBuffer }> }).assets['listening-preview']
    expect(new Uint8Array(stored.data)).toEqual(STUB_BYTES)
    const record = await db.packs.get([pack.id, pack.version])
    expect(record?.resourcesReady).toBe(true)
  })

  it('摘要不匹配时拒绝并标记失败，不置 ready', async () => {
    const db = await openDb(false)
    const result = await downloadPackAssets({ db, packId: pack.id, version: pack.version, fetchBinary: async () => new Uint8Array([1, 2, 3]).buffer })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('ASSET_HASH_MISMATCH')
    const job = await db.downloadJobs.get([pack.id, pack.version])
    expect(job?.status).toBe('failed')
    const record = await db.packs.get([pack.id, pack.version])
    expect(record?.resourcesReady).toBe(false)
  })

  it('网络失败时返回 DOWNLOAD_FAILED 且状态 failed', async () => {
    const db = await openDb(false)
    const result = await downloadPackAssets({ db, packId: pack.id, version: pack.version, fetchBinary: async () => { throw new Error('offline') } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('DOWNLOAD_FAILED')
    const job = await db.downloadJobs.get([pack.id, pack.version])
    expect(job?.status).toBe('failed')
  })

  it('下载后可按 assetId 读取字节；未下载时返回 ASSET_MISSING', async () => {
    const db = await openDb(false)
    await downloadPackAssets({ db, packId: pack.id, version: pack.version, fetchBinary: fetchStubBytes })
    const bytes = await getPackAssetBytes({ db, packId: pack.id, version: pack.version, assetId: 'listening-preview' })
    expect(bytes.ok).toBe(true)
    if (bytes.ok) {
      expect(new Uint8Array(bytes.value.data)).toEqual(STUB_BYTES)
      expect(bytes.value.mime).toBe('audio/mp4')
    }
    const missing = await getPackAssetBytes({ db, packId: pack.id, version: pack.version, assetId: 'nope' })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('ASSET_MISSING')
  })
})

describe('回放与速度命令', () => {
  it('recordReplay 递增 slot.replayCount 并推进 revision', async () => {
    const db = await openDb(true)
    const session = await makeSession(db, 'au-1')
    const slot = session.slots[0]!
    const result = await recordReplay(db, { sessionId: session.id, slotId: slot.id, expectedRevision: session.revision })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.revision).toBe(session.revision + 1)
      expect(result.value.slots[0]?.replayCount).toBe(1)
    }
  })

  it('recordReplay 持旧 revision 返回 STALE_SESSION', async () => {
    const db = await openDb(true)
    const session = await makeSession(db, 'au-2')
    const slot = session.slots[0]!
    const result = await recordReplay(db, { sessionId: session.id, slotId: slot.id, expectedRevision: session.revision - 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('STALE_SESSION')
  })

  it('setAudioSpeed 接受 0.75 与 1，拒绝其他速度', async () => {
    const db = await openDb(true)
    const session = await makeSession(db, 'au-3')
    const slot = session.slots[0]!
    const slow = await setAudioSpeed(db, { sessionId: session.id, slotId: slot.id, expectedRevision: session.revision, speed: 0.75 })
    expect(slow.ok).toBe(true)
    if (slow.ok) expect(slow.value.slots[0]?.audioSpeed).toBe(0.75)
    const normal = await setAudioSpeed(db, { sessionId: session.id, slotId: slot.id, expectedRevision: slow.ok ? slow.value.revision : 0, speed: 1 })
    expect(normal.ok).toBe(true)
    if (normal.ok) expect(normal.value.slots[0]?.audioSpeed).toBe(1)
    const weird = await setAudioSpeed(db, { sessionId: session.id, slotId: slot.id, expectedRevision: normal.ok ? normal.value.revision : 0, speed: 1.5 })
    expect(weird.ok).toBe(false)
    if (!weird.ok) expect(weird.error.code).toBe('INVALID_ANSWER')
  })
})

describe('AudioPlayer 组件状态机', () => {
  it('点击播放调用 play，成功后出现暂停按钮', async () => {
    const wrapper = mount(AudioPlayer, { props: { bytes: STUB_BYTES.slice().buffer, mime: 'audio/mp4', speed: 1 } })
    wrappers.push(wrapper)
    await clickButton(wrapper, '播放')
    await flushPromises()
    expect(playSpy).toHaveBeenCalled()
    expect(findButton(wrapper, '暂停')).toBeTruthy()
  })

  it('play 被拒绝时显示重试，不触发提交类事件', async () => {
    playSpy?.mockRejectedValue(new DOMException('blocked', 'NotAllowedError'))
    const wrapper = mount(AudioPlayer, { props: { bytes: STUB_BYTES.slice().buffer, mime: 'audio/mp4', speed: 1 } })
    wrappers.push(wrapper)
    await clickButton(wrapper, '播放')
    await flushPromises()
    expect(findButton(wrapper, '重试')).toBeTruthy()
    // 播放被拒绝不产生任何进度/提交类组件事件（原生 click 冒泡不算）
    expect(wrapper.emitted('replay')).toBeUndefined()
    expect(wrapper.emitted('speed')).toBeUndefined()
    expect(wrapper.emitted('ended')).toBeUndefined()
  })

  it('重播归零进度、再次播放并发出 replay', async () => {
    const wrapper = mount(AudioPlayer, { props: { bytes: STUB_BYTES.slice().buffer, mime: 'audio/mp4', speed: 1 } })
    wrappers.push(wrapper)
    await clickButton(wrapper, '播放')
    await flushPromises()
    const audio = wrapper.find('audio').element as HTMLAudioElement
    audio.currentTime = 12
    await clickButton(wrapper, '重播')
    await flushPromises()
    expect(audio.currentTime).toBe(0)
    expect(wrapper.emitted('replay')).toHaveLength(1)
  })

  it('0.75×/1× 切换 playbackRate 并发出 speed', async () => {
    const wrapper = mount(AudioPlayer, { props: { bytes: STUB_BYTES.slice().buffer, mime: 'audio/mp4', speed: 1 } })
    wrappers.push(wrapper)
    await clickButton(wrapper, '0.75×')
    await flushPromises()
    const audio = wrapper.find('audio').element as HTMLAudioElement
    expect(audio.playbackRate).toBe(0.75)
    expect(wrapper.emitted('speed')?.[0]).toEqual([0.75])
    await clickButton(wrapper, '1×')
    await flushPromises()
    expect(audio.playbackRate).toBe(1)
    expect(wrapper.emitted('speed')?.[1]).toEqual([1])
  })

  it('bytes 为空时显示音频未下载', () => {
    const wrapper = mount(AudioPlayer, { props: { bytes: null, mime: 'audio/mp4', speed: 1 } })
    wrappers.push(wrapper)
    expect(wrapper.text()).toContain('音频未下载')
    expect(findButton(wrapper, '播放')).toBeFalsy()
  })

  it('卸载时停止播放', async () => {
    const wrapper = mount(AudioPlayer, { props: { bytes: STUB_BYTES.slice().buffer, mime: 'audio/mp4', speed: 1 } })
    await clickButton(wrapper, '播放')
    await flushPromises()
    wrapper.unmount()
    expect(pauseSpy).toHaveBeenCalled()
  })
})

describe('SessionPage 听力接入', () => {
  it('完整听力流程：播放、字幕显式开启、两次作答、字幕开启后的答对计辅助', async () => {
    const db = await openDb(true)
    await downloadPackAssets({ db, packId: pack.id, version: pack.version, fetchBinary: fetchStubBytes })
    const session = await makeSession(db, 'au-4')
    const wrapper = await mountSession(db, session.id)
    expect(findButton(wrapper, '播放')).toBeTruthy()
    await clickButton(wrapper, '播放')
    await flushPromises()
    expect(playSpy).toHaveBeenCalled()
    // 字幕显式开启：revealHint('transcript') 落辅助状态
    await clickButton(wrapper, '字幕')
    await settle()
    expect(wrapper.text()).toContain('We meet in Room 203 every Friday after class.')
    const reloaded = await import('../../src/services/learning').then((m) => m.loadSession(db, session.id))
    expect(reloaded.ok && reloaded.value.slots[0]?.assistance.includes('transcript')).toBe(true)
    // 作答第一题（正确答案 a）
    await clickButton(wrapper, 'In Room 203.')
    await clickButton(wrapper, '提交答案')
    await settle()
    expect(wrapper.text()).toContain('回答正确')
    await clickButton(wrapper, '下一题')
    await settle()
    expect(findButton(wrapper, '播放')).toBeTruthy()
    await clickButton(wrapper, 'A book he likes.')
    await clickButton(wrapper, '提交答案')
    await settle()
    await clickButton(wrapper, '下一题')
    await settle()
    expect(wrapper.text()).toContain('单元结束')
    const summary = await import('../../src/services/sessionFlow').then((m) => m.getSessionSummary(db, session.id))
    expect(summary.ok && summary.value.assistedFirst).toBe(1)
    expect(summary.ok && summary.value.independentFirst).toBe(1)
  })

  it('play 抛 NotAllowedError 时 Attempt 数不增加，可继续作答', async () => {
    const db = await openDb(true)
    await downloadPackAssets({ db, packId: pack.id, version: pack.version, fetchBinary: fetchStubBytes })
    const session = await makeSession(db, 'au-5')
    const wrapper = await mountSession(db, session.id)
    playSpy?.mockRejectedValue(new DOMException('blocked', 'NotAllowedError'))
    await clickButton(wrapper, '播放')
    await flushPromises()
    expect(wrapper.text()).toContain('重试')
    expect(await db.attempts.count()).toBe(0)
    // 作答不受影响
    await clickButton(wrapper, 'In Room 203.')
    await clickButton(wrapper, '提交答案')
    await settle()
    expect(await db.attempts.count()).toBe(1)
  })

  it('字节缺失时显示下载引导，可跳过且不计听力错误', async () => {
    const db = await openDb(true)
    const session = await makeSession(db, 'au-6')
    const wrapper = await mountSession(db, session.id)
    expect(wrapper.text()).toContain('音频未下载')
    expect(findButton(wrapper, '下载音频')).toBeTruthy()
    await clickButton(wrapper, '跳过此题')
    await settle()
    expect(await db.attempts.count()).toBe(0)
    // 跳过后进入下一题：同样无字节，仍是下载引导（不是播放器）
    expect(wrapper.text()).toContain('音频未下载')
  })

  it('下载音频按钮在缺字节时补下载并出现播放', async () => {
    const db = await openDb(true)
    const session = await makeSession(db, 'au-7')
    const wrapper = await mountSession(db, session.id)
    // SessionPage 走默认 fetch：在 jsdom 中 mock 全局 fetch 返回桩字节
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(STUB_BYTES.slice().buffer))
    try {
      await clickButton(wrapper, '下载音频')
      await settle()
      expect(findButton(wrapper, '播放')).toBeTruthy()
      const stored = await getPackAssetBytes({ db, packId: pack.id, version: pack.version, assetId: 'listening-preview' })
      expect(stored.ok).toBe(true)
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
