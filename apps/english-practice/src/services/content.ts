import type { GaokaoDatabase } from '../data/db'
import { e2eFixtureFor } from '../data/e2e-fixtures'
import type { CoursePack } from '../content/types'
import { validatePack } from '../content/validate'

export type ContentErrorCode = 'DOWNLOAD_FAILED' | 'INVALID_CONTENT' | 'STORAGE_FAILED' | 'ASSET_HASH_MISMATCH' | 'ASSET_MIME_MISMATCH' | 'ASSET_MISSING'
export type ContentResult<T> = { ok: true; value: T } | { ok: false; error: { code: ContentErrorCode; messageZh: string } }

export interface ContentCatalogEntry {
  id: string
  version: string
  status: string
  bytes: number
  sha256: string
  path: string
}

export interface ContentCatalog {
  packs: ContentCatalogEntry[]
}

export interface InstallPreviewPacksInput {
  db: GaokaoDatabase
  catalogUrl?: string
  fetchText?: (url: string) => Promise<string>
  now?: () => Date
}

export interface InstallPreviewPacksReport {
  installed: number
  skippedExisting: number
  skippedOldVersion: number
  rejected: number
  messagesZh: string[]
}

const DEFAULT_CATALOG_URL = '/content-catalog.json'

const compareSemver = (left: string, right: string): number => {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

const sha256Hex = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const resolvePackUrl = (catalogUrl: string, packPath: string): string => {
  if (/^https?:\/\//.test(catalogUrl)) return new URL(packPath, catalogUrl).toString()
  const baseDir = catalogUrl.slice(0, catalogUrl.lastIndexOf('/') + 1)
  return `${baseDir}${packPath}`
}

export async function installPreviewPacks(input: InstallPreviewPacksInput): Promise<ContentResult<InstallPreviewPacksReport>> {
  const catalogUrl = input.catalogUrl ?? DEFAULT_CATALOG_URL
  // R10：默认网络读取 8s 超时（SW 未接管前的首次访问也有保护）；注入 fetchText 不受影响。
  // T14：VITE_E2E=true 构建下，catalog/pack.json 命中固定 fixtures（音频仍走真实 HTTP）；生产构建恒走网络。
  const fetchText = input.fetchText ?? (async (url: string) => {
    const fixture = await e2eFixtureFor(url)
    if (fixture !== null) return fixture
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.text()
    } finally {
      clearTimeout(timer)
    }
  })
  const now = input.now ?? (() => new Date())
  const report: InstallPreviewPacksReport = {
    installed: 0,
    skippedExisting: 0,
    skippedOldVersion: 0,
    rejected: 0,
    messagesZh: [],
  }

  let catalog: ContentCatalog
  try {
    catalog = JSON.parse(await fetchText(catalogUrl)) as ContentCatalog
    if (!catalog || !Array.isArray(catalog.packs)) throw new Error('catalog format is invalid')
  } catch {
    return { ok: false, error: { code: 'DOWNLOAD_FAILED', messageZh: '课程目录读取失败，请检查网络或内容配置' } }
  }

  const latest = new Map<string, ContentCatalogEntry>()
  for (const entry of catalog.packs) {
    if (typeof entry?.id !== 'string' || typeof entry?.version !== 'string') continue
    const current = latest.get(entry.id)
    if (!current || compareSemver(entry.version, current.version) > 0) latest.set(entry.id, entry)
  }
  for (const entry of catalog.packs) {
    if (latest.get(entry.id) !== entry) report.skippedOldVersion += 1
  }

  for (const entry of latest.values()) {
    try {
      const existing = await input.db.packs.get([entry.id, entry.version])
      if (existing) {
        report.skippedExisting += 1
        continue
      }
      const packUrl = resolvePackUrl(catalogUrl, entry.path)
      let text: string
      try {
        text = await fetchText(packUrl)
      } catch {
        report.rejected += 1
        report.messagesZh.push(`课程包读取失败：${entry.id}@${entry.version}`)
        continue
      }
      const bytes = new TextEncoder().encode(text).length
      if (bytes !== entry.bytes) {
        report.rejected += 1
        report.messagesZh.push(`课程包字节数不匹配：${entry.id}@${entry.version}`)
        continue
      }
      const sha256 = await sha256Hex(text)
      if (sha256 !== entry.sha256) {
        report.rejected += 1
        report.messagesZh.push(`课程包摘要不匹配：${entry.id}@${entry.version}`)
        continue
      }
      const parsed: unknown = JSON.parse(text)
      const validation = validatePack(parsed, 'preview')
      if (!validation.ok) {
        report.rejected += 1
        report.messagesZh.push(`课程包未通过预览校验：${entry.id}@${entry.version}：${validation.errors[0]?.messageZh ?? '结构无效'}`)
        continue
      }
      const pack = parsed as CoursePack
      await input.db.packs.add({
        id: pack.id,
        version: pack.version,
        status: 'installed',
        pack,
        installedAt: now().toISOString(),
        resourcesReady: pack.assets.length === 0,
      })
      report.installed += 1
    } catch {
      report.rejected += 1
      report.messagesZh.push(`课程包安装失败：${entry.id}@${entry.version}`)
    }
  }
  return { ok: true, value: report }
}

export interface DownloadPackAssetsInput {
  db: GaokaoDatabase
  packId: string
  version: string
  catalogUrl?: string
  fetchBinary?: (url: string) => Promise<ArrayBuffer>
  /** 可注入 Response 级请求（测试缝/需要 MIME 校验时使用；默认 fetch 自动记录 MIME） */
  fetchResponse?: (url: string) => Promise<Response>
  now?: () => Date
  /** 状态机钩子（T12）：进入下载阶段/进入校验阶段各回调一次；返回 Promise 时被等待，保证状态先于终态落库 */
  onStateChange?: (state: 'downloading' | 'verifying') => void | Promise<void>
}

export type DownloadPackAssetsResult = { ok: true; value: { assets: number } } | { ok: false; error: { code: ContentErrorCode; messageZh: string } }

const sha256HexBytes = async (data: ArrayBuffer): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function downloadPackAssets(input: DownloadPackAssetsInput): Promise<DownloadPackAssetsResult> {
  const now = input.now ?? (() => new Date())
  // 默认路径记录响应 MIME 供校验（D09：逐个检查 MIME、bytes、sha256）；自定义 fetchBinary 无 MIME，跳过该检查
  const servedMimeByUrl = new Map<string, string>()
  const doFetch = input.fetchResponse ?? ((url: string) => fetch(url))
  const fetchBinary = input.fetchBinary ?? (async (url: string) => {
    const response = await doFetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
    if (mime !== '') servedMimeByUrl.set(url, mime)
    return response.arrayBuffer()
  })
  try {
    const record = await input.db.packs.get([input.packId, input.version])
    if (!record || record.status !== 'installed') {
      return { ok: false, error: { code: 'INVALID_CONTENT', messageZh: '课程包未安装，无法下载音频' } }
    }
    const pack = record.pack as CoursePack
    if (pack.assets.length === 0) {
      await input.db.packs.update([input.packId, input.version], { resourcesReady: true })
      return { ok: true, value: { assets: 0 } }
    }
    const catalogUrl = input.catalogUrl ?? DEFAULT_CATALOG_URL
    const existing = await input.db.downloadJobs.get([input.packId, input.version])
    const markFailed = async (messageZh: string, failedAssetId: string): Promise<void> => {
      // B1（D09「保持旧 ready 版本可用」）：旧 job 已有 assets 字节时合并保留，
      // 仅在没有任何旧数据可保留时才置 resourcesReady=false
      const preservedAssets = existing?.data as { assets?: Record<string, { sha256: string; data: ArrayBuffer }> } | undefined
      const hasPreserved = Boolean(preservedAssets?.assets && Object.keys(preservedAssets.assets).length > 0)
      await input.db.downloadJobs.put({
        packId: input.packId,
        version: input.version,
        status: 'failed',
        createdAt: existing?.createdAt ?? now().toISOString(),
        updatedAt: now().toISOString(),
        data: hasPreserved
          ? { failedAssetId, messageZh, assets: preservedAssets!.assets }
          : { failedAssetId, messageZh },
      })
      if (!hasPreserved) {
        await input.db.packs.update([input.packId, input.version], { resourcesReady: false })
      }
    }
    await input.onStateChange?.('downloading')
    const fetched: Array<{ asset: CoursePack['assets'][number]; data: ArrayBuffer; servedMime?: string }> = []
    for (const asset of pack.assets) {
      const url = resolvePackUrl(catalogUrl, `content-packs/${input.packId}/${input.version}/${asset.path}`)
      let data: ArrayBuffer
      try {
        data = await fetchBinary(url)
      } catch {
        await markFailed('音频下载失败', asset.id)
        return { ok: false, error: { code: 'DOWNLOAD_FAILED', messageZh: `音频下载失败：${asset.id}` } }
      }
      fetched.push({ asset, data, servedMime: servedMimeByUrl.get(url) })
    }
    await input.onStateChange?.('verifying')
    const assets: Record<string, { sha256: string; data: ArrayBuffer }> = {}
    for (const { asset, data, servedMime } of fetched) {
      if (servedMime !== undefined) {
        const declared = asset.mime.toLowerCase()
        // D09：逐个检查 MIME。同类音频家族（audio/*）视为兼容，避免服务器别名误杀；跨类型直接拒绝
        const mimeCompatible = servedMime === declared || (servedMime.startsWith('audio/') && declared.startsWith('audio/'))
        if (!mimeCompatible) {
          await markFailed('音频资源类型不匹配', asset.id)
          return { ok: false, error: { code: 'ASSET_MIME_MISMATCH', messageZh: `音频资源类型不匹配：${asset.id}` } }
        }
      }
      if (data.byteLength !== asset.bytes) {
        await markFailed('音频字节数不匹配', asset.id)
        return { ok: false, error: { code: 'ASSET_HASH_MISMATCH', messageZh: `音频字节数不匹配：${asset.id}` } }
      }
      const sha256 = await sha256HexBytes(data)
      if (sha256 !== asset.sha256) {
        await markFailed('音频摘要不匹配', asset.id)
        return { ok: false, error: { code: 'ASSET_HASH_MISMATCH', messageZh: `音频摘要不匹配：${asset.id}` } }
      }
      assets[asset.id] = { sha256, data }
    }
    await input.db.transaction('rw', input.db.downloadJobs, input.db.packs, async () => {
      await input.db.downloadJobs.put({
        packId: input.packId,
        version: input.version,
        status: 'ready',
        createdAt: existing?.createdAt ?? now().toISOString(),
        updatedAt: now().toISOString(),
        data: { assets },
      })
      await input.db.packs.update([input.packId, input.version], { resourcesReady: true })
    })
    return { ok: true, value: { assets: pack.assets.length } }
  } catch {
    return { ok: false, error: { code: 'STORAGE_FAILED', messageZh: '音频存储失败，请重试' } }
  }
}

export interface GetPackAssetBytesInput {
  db: GaokaoDatabase
  packId: string
  version: string
  assetId: string
}

export type GetPackAssetBytesResult = { ok: true; value: { data: ArrayBuffer; mime: string } } | { ok: false; error: { code: ContentErrorCode; messageZh: string } }

export async function getPackAssetBytes(input: GetPackAssetBytesInput): Promise<GetPackAssetBytesResult> {
  try {
    const job = await input.db.downloadJobs.get([input.packId, input.version])
    // B1：以实际存储字节为准（ready 或保留旧字节的 failed 作业均可读），不以状态字段为准
    const storedBytes = (job?.data as { assets?: Record<string, { sha256: string; data: ArrayBuffer }> } | undefined)?.assets?.[input.assetId]
    if (!job || !storedBytes) {
      return { ok: false, error: { code: 'ASSET_MISSING', messageZh: '音频未下载' } }
    }
    const record = await input.db.packs.get([input.packId, input.version])
    const pack = record?.pack as CoursePack | undefined
    const asset = pack?.assets.find((candidate) => candidate.id === input.assetId)
    if (!asset) {
      return { ok: false, error: { code: 'ASSET_MISSING', messageZh: '音频资产不存在' } }
    }
    const stored = storedBytes
    if (!stored) {
      return { ok: false, error: { code: 'ASSET_MISSING', messageZh: '音频未下载' } }
    }
    return { ok: true, value: { data: stored.data, mime: asset.mime } }
  } catch {
    return { ok: false, error: { code: 'STORAGE_FAILED', messageZh: '音频读取失败' } }
  }
}
