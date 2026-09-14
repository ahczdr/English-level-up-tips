import 'fake-indexeddb/auto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createDatabase, deleteDatabase, type GaokaoDatabase } from '../../src/data/db'
import { downloadPackAssets, getPackAssetBytes, installPreviewPacks } from '../../src/services/content'
import { collectDownloadOverview, estimateDownloadFeasibility, reconcileInstalledPacks, startPackDownload } from '../../src/services/downloads'

const databases: GaokaoDatabase[] = []

const openDb = async (): Promise<GaokaoDatabase> => {
  const db = createDatabase('gaokao-downloads-' + crypto.randomUUID())
  await db.open()
  databases.push(db)
  return db
}

afterEach(async () => {
  while (databases.length > 0) await deleteDatabase(databases.pop() as GaokaoDatabase)
})

const sha256Hex = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const fetchTextByUrl = (bodies: Record<string, string>) => async (url: string): Promise<string> => {
  const body = bodies[url]
  if (body === undefined) throw new Error('404: ' + url)
  return body
}

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PACK_JSON = fs.readFileSync(path.join(APP_ROOT, 'public/content-packs/gaokao-listening/1.0.0/pack.json'), 'utf8')
const AUDIO_FILE = fs.readFileSync(path.join(APP_ROOT, 'public/content-packs/gaokao-listening/1.0.0/assets/listening-preview.m4a'))
const audioArrayBuffer = (): ArrayBuffer => AUDIO_FILE.buffer.slice(AUDIO_FILE.byteOffset, AUDIO_FILE.byteOffset + AUDIO_FILE.byteLength) as ArrayBuffer
const REAL_AUDIO_BYTES = async (): Promise<ArrayBuffer> => audioArrayBuffer()

const installListeningPack = async (db: GaokaoDatabase): Promise<void> => {
  const catalog = { packs: [{ id: 'gaokao-listening', version: '1.0.0', status: 'preview', bytes: new TextEncoder().encode(PACK_JSON).length, sha256: await sha256Hex(PACK_JSON), path: 'content-packs/gaokao-listening/1.0.0/pack.json' }] }
  const installed = await installPreviewPacks({ db, fetchText: fetchTextByUrl({ '/content-catalog.json': JSON.stringify(catalog), '/content-packs/gaokao-listening/1.0.0/pack.json': PACK_JSON }) })
  expect(installed).toMatchObject({ ok: true, value: { installed: 1 } })
}

describe('estimateDownloadFeasibility 空间估算', () => {
  it('剩余空间不足报 INSUFFICIENT_SPACE', async () => {
    Object.defineProperty(navigator, 'storage', { value: { estimate: async () => ({ usage: 90, quota: 100 }) }, configurable: true })
    const result = await estimateDownloadFeasibility(50)
    expect(result).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_SPACE' } })
  })

  it('剩余充足通过；API 缺失视为未知放行', async () => {
    Object.defineProperty(navigator, 'storage', { value: { estimate: async () => ({ usage: 10, quota: 100 }) }, configurable: true })
    expect(await estimateDownloadFeasibility(50)).toMatchObject({ ok: true, value: { remainingBytes: 90 } })
    Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true })
    expect(await estimateDownloadFeasibility(Number.MAX_SAFE_INTEGER)).toMatchObject({ ok: true, value: { remainingBytes: null } })
  })
})

describe('startPackDownload 下载状态机', () => {
  it('absent → downloading → verifying → ready，资源就绪', async () => {
    const db = await openDb()
    await installListeningPack(db)
    const states: string[] = []
    const result = await startPackDownload({ db, packId: 'gaokao-listening', version: '1.0.0', fetchBinary: REAL_AUDIO_BYTES, onStateChange: (state) => states.push(state) })
    expect(result.ok).toBe(true)
    expect(states).toEqual(['downloading', 'verifying'])
    const job = await db.downloadJobs.get(['gaokao-listening', '1.0.0'])
    expect(job?.status).toBe('ready')
    expect((await db.packs.get(['gaokao-listening', '1.0.0']))?.resourcesReady).toBe(true)
  })

  it('hash 不匹配 → failed，但旧 ready 字节保留可读（D09 保持旧 ready 版本可用）', async () => {
    const db = await openDb()
    await installListeningPack(db)
    const first = await startPackDownload({ db, packId: 'gaokao-listening', version: '1.0.0', fetchBinary: REAL_AUDIO_BYTES })
    expect(first.ok).toBe(true)
    // 模拟内容被替换：下载到错误字节
    const second = await startPackDownload({ db, packId: 'gaokao-listening', version: '1.0.0', fetchBinary: async () => new TextEncoder().encode('corrupted').buffer as ArrayBuffer })
    expect(second.ok).toBe(false)
    expect(second.ok ? null : second.error.code).toBe('ASSET_HASH_MISMATCH')
    // 作业标记 failed 并记录失败资产，但旧 assets 字节保留
    const job = await db.downloadJobs.get(['gaokao-listening', '1.0.0'])
    expect(job?.status).toBe('failed')
    expect((job?.data as { failedAssetId?: string }).failedAssetId).toBe('listening-preview')
    expect((job?.data as { assets?: Record<string, unknown> }).assets?.['listening-preview']).toBeDefined()
    // 旧资源仍可读取，resourcesReady 保持 true（旧版本继续可用）
    const readable = await getPackAssetBytes({ db, packId: 'gaokao-listening', version: '1.0.0', assetId: 'listening-preview' })
    expect(readable).toMatchObject({ ok: true })
    expect((await db.packs.get(['gaokao-listening', '1.0.0']))?.resourcesReady).toBe(true)
    // 对账不误标 needs-download（字节仍在）
    const report = await reconcileInstalledPacks({ db })
    expect(report).toMatchObject({ checked: 1, markedNeedsDownload: 0 })
  })

  it('网络中断 → failed，可重试到 ready', async () => {
    const db = await openDb()
    await installListeningPack(db)
    const failed = await startPackDownload({ db, packId: 'gaokao-listening', version: '1.0.0', fetchBinary: async () => { throw new Error('offline') } })
    expect(failed.ok).toBe(false)
    expect(failed.ok ? null : failed.error.code).toBe('DOWNLOAD_FAILED')
    const retry = await startPackDownload({ db, packId: 'gaokao-listening', version: '1.0.0', fetchBinary: REAL_AUDIO_BYTES })
    expect(retry.ok).toBe(true)
  })
})

describe('reconcileInstalledPacks 启动对账', () => {
  it('资源缺失 → needs-download 且 resourcesReady=false；恢复后对账复位', async () => {
    const db = await openDb()
    await installListeningPack(db)
    await startPackDownload({ db, packId: 'gaokao-listening', version: '1.0.0', fetchBinary: REAL_AUDIO_BYTES })
    // 模拟缓存丢失：删除 job 数据
    await db.downloadJobs.delete(['gaokao-listening', '1.0.0'])
    const report = await reconcileInstalledPacks({ db })
    expect(report.markedNeedsDownload).toBe(1)
    expect((await db.packs.get(['gaokao-listening', '1.0.0']))?.resourcesReady).toBe(false)
    const job = await db.downloadJobs.get(['gaokao-listening', '1.0.0'])
    expect(job?.status).toBe('needs-download')
    // 恢复下载后 job 回到 ready；再模拟历史中断导致就绪标志丢失，对账应复位
    await startPackDownload({ db, packId: 'gaokao-listening', version: '1.0.0', fetchBinary: REAL_AUDIO_BYTES })
    await db.packs.update(['gaokao-listening', '1.0.0'], { resourcesReady: false })
    const restored = await reconcileInstalledPacks({ db })
    expect(restored.restoredReady).toBe(1)
    expect((await db.packs.get(['gaokao-listening', '1.0.0']))?.resourcesReady).toBe(true)
  })

  it('就绪包不动；无资产包始终就绪', async () => {
    const db = await openDb()
    await installListeningPack(db)
    const report = await reconcileInstalledPacks({ db })
    expect(report).toMatchObject({ checked: 1, markedNeedsDownload: 0, restoredReady: 0 })
  })
})

describe('reconcileInstalledPacks 损坏包容错', () => {
  it('pack JSON 损坏（非对象）→ needs-download，不视为无资产包', async () => {
    const db = await openDb()
    await db.packs.add({ id: 'broken-pack', version: '1.0.0', status: 'installed', pack: null, installedAt: new Date().toISOString(), resourcesReady: true })
    databases.push(db)
    const report = await reconcileInstalledPacks({ db })
    expect(report).toMatchObject({ checked: 1, markedNeedsDownload: 1 })
    expect((await db.packs.get(['broken-pack', '1.0.0']))?.resourcesReady).toBe(false)
    const job = await db.downloadJobs.get(['broken-pack', '1.0.0'])
    expect(job?.status).toBe('needs-download')
  })
})

describe('downloadPackAssets MIME 校验（D09）', () => {
  it('响应 MIME 跨类型 → ASSET_MIME_MISMATCH；同家族音频兼容', async () => {
    const db = await openDb()
    await installListeningPack(db)
    const wrong = await downloadPackAssets({ db, packId: 'gaokao-listening', version: '1.0.0', fetchResponse: async () => new Response(audioArrayBuffer(), { headers: { 'content-type': 'text/plain' } }) })
    expect(wrong).toMatchObject({ ok: false, error: { code: 'ASSET_MIME_MISMATCH' } })
    const right = await downloadPackAssets({ db, packId: 'gaokao-listening', version: '1.0.0', fetchResponse: async () => new Response(audioArrayBuffer(), { headers: { 'content-type': 'audio/x-m4a' } }) })
    expect(right).toMatchObject({ ok: true, value: { assets: 1 } })
  })
})

describe('reconcileInstalledPacks 僵尸作业重置（B2）', () => {
  it('首次下载中断残留 downloading/verifying → 重置 needs-download，页面可重试', async () => {
    const db = await openDb()
    await installListeningPack(db)
    for (const status of ['downloading', 'verifying']) {
      await db.downloadJobs.put({ packId: 'gaokao-listening', version: '1.0.0', status, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), data: {} })
      const report = await reconcileInstalledPacks({ db })
      expect(report.resetStaleJobs).toBe(1)
      const job = await db.downloadJobs.get(['gaokao-listening', '1.0.0'])
      expect(job?.status).toBe('needs-download')
      expect((await db.packs.get(['gaokao-listening', '1.0.0']))?.resourcesReady).toBe(false)
    }
  })
})

describe('DB 写入失败（缺口1/2）', () => {
  it('事务失败 → STORAGE_FAILED，resourcesReady 不被误改', async () => {
    const db = await openDb()
    await installListeningPack(db)
    const original = db.downloadJobs.put.bind(db.downloadJobs)
    db.downloadJobs.put = () => Promise.reject(new Error('QuotaExceededError')) as never
    const result = await startPackDownload({ db, packId: 'gaokao-listening', version: '1.0.0', fetchBinary: REAL_AUDIO_BYTES })
    expect(result).toMatchObject({ ok: false, error: { code: 'STORAGE_FAILED' } })
    expect((await db.packs.get(['gaokao-listening', '1.0.0']))?.resourcesReady).toBe(false)
    db.downloadJobs.put = original as never
  })
})

describe('collectDownloadOverview 页面装配', () => {
  it('列出已安装包与作业状态、资产数', async () => {
    const db = await openDb()
    await installListeningPack(db)
    await startPackDownload({ db, packId: 'gaokao-listening', version: '1.0.0', fetchBinary: REAL_AUDIO_BYTES })
    const overview = await collectDownloadOverview({ db })
    expect(overview).toHaveLength(1)
    expect(overview[0]).toMatchObject({ packId: 'gaokao-listening', version: '1.0.0', resourcesReady: true, assetCount: 1, jobStatus: 'ready' })
  })
})
