import 'fake-indexeddb/auto'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import samplePack from '../fixtures/sample-pack.json'
import { createDatabase, deleteDatabase, type GaokaoDatabase } from '../../src/data/db'
import type { CoursePack } from '../../src/content/types'
import { installPreviewPacks, type ContentCatalog } from '../../src/services/content'

const pack = samplePack as unknown as CoursePack
const databases: GaokaoDatabase[] = []

const openDb = () => {
  const db = createDatabase(`gaokao-content-${crypto.randomUUID()}`)
  databases.push(db)
  return db
}

const packTextOf = (value: unknown) => JSON.stringify(value)
const entryOf = (value: CoursePack, path: string) => {
  const text = packTextOf(value)
  return {
    id: value.id,
    version: value.version,
    status: value.status,
    bytes: Buffer.byteLength(text),
    sha256: createHash('sha256').update(text).digest('hex'),
    path,
  }
}

const makeFetcher = (catalog: ContentCatalog, packTexts: Map<string, string>, failures = new Set<string>()) => {
  return async (url: string): Promise<string> => {
    if (failures.has(url)) throw new Error(`下载失败：${url}`)
    if (url.endsWith('content-catalog.json')) return JSON.stringify(catalog)
    const text = packTexts.get(url)
    if (text === undefined) throw new Error(`未知地址：${url}`)
    return text
  }
}

afterEach(async () => {
  while (databases.length > 0) await deleteDatabase(databases.pop()!)
})

describe('T05 预览内容装载服务', () => {
  it('安装通过摘要与预览校验的课程包', async () => {
    const db = openDb()
    const text = packTextOf(pack)
    const catalog: ContentCatalog = { packs: [entryOf(pack, 'content-packs/demo/0.1.0/pack.json')] }
    const result = await installPreviewPacks({ db, catalogUrl: '/content-catalog.json', fetchText: makeFetcher(catalog, new Map([['/content-packs/demo/0.1.0/pack.json', text]])), now: () => new Date('2026-09-11T00:00:00.000Z') })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.messageZh)
    expect(result.value.installed).toBe(1)
    const record = await db.packs.get([pack.id, pack.version])
    expect(record?.status).toBe('installed')
    expect(record?.resourcesReady).toBe(true)
    expect((record?.pack as CoursePack).id).toBe(pack.id)
    expect(record?.installedAt).toBe('2026-09-11T00:00:00.000Z')
  })

  it('重复装载时跳过已安装的相同版本', async () => {
    const db = openDb()
    const text = packTextOf(pack)
    const entry = entryOf(pack, 'content-packs/demo/0.1.0/pack.json')
    const catalog: ContentCatalog = { packs: [entry] }
    const fetchText = makeFetcher(catalog, new Map([['/content-packs/demo/0.1.0/pack.json', text]]))
    const first = await installPreviewPacks({ db, fetchText })
    expect(first.ok && first.value.installed).toBe(1)
    const second = await installPreviewPacks({ db, fetchText })
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error(second.error.messageZh)
    expect(second.value).toMatchObject({ installed: 0, skippedExisting: 1, rejected: 0 })
  })

  it('摘要不匹配的课程包被拒绝且不安装', async () => {
    const db = openDb()
    const text = packTextOf(pack)
    const entry = { ...entryOf(pack, 'content-packs/demo/0.1.0/pack.json'), sha256: '0'.repeat(64) }
    const catalog: ContentCatalog = { packs: [entry] }
    const result = await installPreviewPacks({ db, fetchText: makeFetcher(catalog, new Map([['/content-packs/demo/0.1.0/pack.json', text]])) })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.messageZh)
    expect(result.value.installed).toBe(0)
    expect(result.value.rejected).toBe(1)
    expect(result.value.messagesZh.join('')).toContain('摘要')
    expect(await db.packs.count()).toBe(0)
  })

  it('未通过预览校验的课程包被拒绝', async () => {
    const db = openDb()
    const broken = structuredClone(pack)
    delete (broken.items[0] as { answerOptionId?: string }).answerOptionId
    const text = packTextOf(broken)
    const entry = entryOf(broken, 'content-packs/demo/0.1.0/pack.json')
    const catalog: ContentCatalog = { packs: [entry] }
    const result = await installPreviewPacks({ db, fetchText: makeFetcher(catalog, new Map([['/content-packs/demo/0.1.0/pack.json', text]])) })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.messageZh)
    expect(result.value.installed).toBe(0)
    expect(result.value.rejected).toBe(1)
    expect(await db.packs.count()).toBe(0)
  })

  it('同一课程包只装载目录中的最新版本', async () => {
    const db = openDb()
    const older = structuredClone(pack)
    const newer = structuredClone(pack)
    newer.version = '0.2.0'
    const oldText = packTextOf(older)
    const newText = packTextOf(newer)
    const catalog: ContentCatalog = {
      packs: [
        entryOf(older, 'content-packs/demo/0.1.0/pack.json'),
        entryOf(newer, 'content-packs/demo/0.2.0/pack.json'),
      ],
    }
    const result = await installPreviewPacks({ db, fetchText: makeFetcher(catalog, new Map([
      ['/content-packs/demo/0.1.0/pack.json', oldText],
      ['/content-packs/demo/0.2.0/pack.json', newText],
    ])) })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.messageZh)
    expect(result.value).toMatchObject({ installed: 1, skippedOldVersion: 1 })
    expect(await db.packs.get([newer.id, '0.2.0'])).toBeTruthy()
    expect(await db.packs.get([older.id, '0.1.0'])).toBeFalsy()
  })

  it('含音频资产的课程包标记为资源未就绪', async () => {
    const db = openDb()
    const withAsset = structuredClone(pack)
    withAsset.assets = [{ id: 'asset-demo', path: 'assets/demo.mp3', mime: 'audio/mpeg', bytes: 3, sha256: 'a'.repeat(64) }]
    const text = packTextOf(withAsset)
    const catalog: ContentCatalog = { packs: [entryOf(withAsset, 'content-packs/demo/0.1.0/pack.json')] }
    const result = await installPreviewPacks({ db, fetchText: makeFetcher(catalog, new Map([['/content-packs/demo/0.1.0/pack.json', text]])) })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.messageZh)
    expect(result.value.installed).toBe(1)
    const record = await db.packs.get([withAsset.id, withAsset.version])
    expect(record?.resourcesReady).toBe(false)
  })

  it('目录读取失败时整体返回错误且不写入', async () => {
    const db = openDb()
    const result = await installPreviewPacks({ db, fetchText: async () => { throw new Error('网络不可用') } })
    expect(result).toMatchObject({ ok: false, error: { code: 'DOWNLOAD_FAILED' } })
    expect(await db.packs.count()).toBe(0)
  })

  it('单个课程包读取失败不影响其他课程包', async () => {
    const db = openDb()
    const other = structuredClone(pack)
    other.id = 'gaokao-other-demo'
    const otherText = packTextOf(other)
    const catalog: ContentCatalog = {
      packs: [
        entryOf(pack, 'content-packs/demo/0.1.0/pack.json'),
        entryOf(other, 'content-packs/other/0.1.0/pack.json'),
      ],
    }
    const failures = new Set(['/content-packs/demo/0.1.0/pack.json'])
    const result = await installPreviewPacks({ db, fetchText: makeFetcher(catalog, new Map([
      ['/content-packs/demo/0.1.0/pack.json', packTextOf(pack)],
      ['/content-packs/other/0.1.0/pack.json', otherText],
    ]), failures) })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.messageZh)
    expect(result.value.installed).toBe(1)
    expect(result.value.rejected).toBe(1)
    expect(await db.packs.count()).toBe(1)
  })
})
