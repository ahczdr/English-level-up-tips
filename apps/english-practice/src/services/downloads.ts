// T12 课程下载服务（D09）：状态机 absent→downloading→verifying→ready/failed、
// 空间估算、启动对账。课程 JSON 与音频字节存 IndexedDB（T02/T08 既定），
// 本服务负责状态推进与对账，不改变存储介质。
import type { GaokaoDatabase } from '../data/db'
import type { CoursePack } from '../content/types'
import { downloadPackAssets } from './content'

export type DownloadsErrorCode =
  | 'INSUFFICIENT_SPACE'
  | 'DOWNLOAD_FAILED'
  | 'INVALID_CONTENT'
  | 'STORAGE_FAILED'
  | 'ASSET_HASH_MISMATCH'
  | 'ASSET_MIME_MISMATCH'
  | 'ASSET_MISSING'
export type DownloadsResult<T> = { ok: true; value: T } | { ok: false; error: { code: DownloadsErrorCode; messageZh: string } }

export interface EstimateInput { remainingBytes: number | null }

export async function estimateDownloadFeasibility(requiredBytes: number): Promise<DownloadsResult<EstimateInput>> {
  try {
    const storage = (navigator as { storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> } }).storage
    const estimate = storage?.estimate
    if (typeof estimate !== 'function') {
      // API 缺失（部分浏览器/测试环境）：视为未知，不做拦截
      return { ok: true, value: { remainingBytes: null } }
    }
    const { usage = 0, quota = 0 } = await estimate.call(storage)
    if (quota > 0) {
      const remainingBytes = Math.max(0, quota - usage)
      if (requiredBytes > remainingBytes) {
        return { ok: false, error: { code: 'INSUFFICIENT_SPACE', messageZh: '剩余存储空间不足，请清理空间或删除不再使用的课程后重试' } }
      }
      return { ok: true, value: { remainingBytes } }
    }
    return { ok: true, value: { remainingBytes: null } }
  } catch {
    return { ok: true, value: { remainingBytes: null } }
  }
}

export interface StartPackDownloadInput {
  db: GaokaoDatabase
  packId: string
  version: string
  catalogUrl?: string
  fetchBinary?: (url: string) => Promise<ArrayBuffer>
  onStateChange?: (state: 'downloading' | 'verifying') => void
  now?: () => Date
}

const readPackAssets = (pack: unknown): CoursePack['assets'] => {
  const candidate = pack as { assets?: CoursePack['assets'] } | null
  return Array.isArray(candidate?.assets) ? (candidate?.assets as CoursePack['assets']) : []
}

export async function startPackDownload(input: StartPackDownloadInput): Promise<DownloadsResult<{ assets: number }>> {
  try {
    const record = await input.db.packs.get([input.packId, input.version])
    if (!record || record.status !== 'installed') {
      return { ok: false, error: { code: 'INVALID_CONTENT', messageZh: '课程包未安装，请先在课程列表准备内容' } }
    }
    const assets = readPackAssets(record.pack)
    const requiredBytes = assets.reduce((total, asset) => total + (typeof asset.bytes === 'number' ? asset.bytes : 0), 0)
    const feasibility = await estimateDownloadFeasibility(requiredBytes)
    if (!feasibility.ok) return feasibility
    const existing = await input.db.downloadJobs.get([input.packId, input.version])
    const createdAt = existing?.createdAt ?? input.now?.().toISOString() ?? new Date().toISOString()
    // B1：旧 job 已有资产字节时全部保留（下载中/校验中/失败都不销毁旧 ready 版本）
    const existingAssets = (existing?.data as { assets?: Record<string, { sha256: string; data: ArrayBuffer }> } | undefined)?.assets
    const preservedAssets = existingAssets && Object.keys(existingAssets).length > 0 ? existingAssets : undefined
    await input.db.downloadJobs.put({
      packId: input.packId,
      version: input.version,
      status: 'downloading',
      createdAt,
      updatedAt: input.now?.().toISOString() ?? new Date().toISOString(),
      data: { remainingBytes: feasibility.value.remainingBytes, ...(preservedAssets ? { assets: preservedAssets } : {}) },
    })
    const result = await downloadPackAssets({
      db: input.db,
      packId: input.packId,
      version: input.version,
      catalogUrl: input.catalogUrl,
      fetchBinary: input.fetchBinary,
      now: input.now,
      onStateChange: async (state) => {
        input.onStateChange?.(state)
        if (state === 'verifying') {
          // R1：等待落库（引擎在内容事务前会 await 本回调），保留旧资产字节
          await input.db.downloadJobs.put({
            packId: input.packId,
            version: input.version,
            status: 'verifying',
            createdAt,
            updatedAt: input.now?.().toISOString() ?? new Date().toISOString(),
            data: preservedAssets ? { assets: preservedAssets } : {},
          })
        }
      },
    })
    if (!result.ok) {
      return { ok: false, error: result.error }
    }
    return { ok: true, value: { assets: result.value.assets } }
  } catch {
    return { ok: false, error: { code: 'STORAGE_FAILED', messageZh: '下载状态写入失败，请重试' } }
  }
}

export interface ReconcileReport { checked: number; markedNeedsDownload: number; restoredReady: number; resetStaleJobs: number }

// 启动对账（D09）：资源字节存 IndexedDB（T08 既定介质），恢复启动时交叉检查
// 作业内资产字节的存在性；缺失标 needs-download；僵尸 downloading/verifying
// 重置为 needs-download（保留已存字节）；不自动删除也不自动重下。
export async function reconcileInstalledPacks(input: { db: GaokaoDatabase; now?: () => Date }): Promise<ReconcileReport> {
  const report: ReconcileReport = { checked: 0, markedNeedsDownload: 0, restoredReady: 0, resetStaleJobs: 0 }
  const rows = (await input.db.packs.toArray()).filter((row) => row.status === 'installed')
  for (const record of rows) {
    report.checked += 1
    const assets = readPackAssets(record.pack)
    // pack JSON 损坏（非对象/缺 id）：视为不可用，走 needs-download 而非「无资产包」
    const packValid = Boolean(record.pack) && typeof record.pack === 'object' && typeof (record.pack as { id?: unknown }).id === 'string'
    let job = await input.db.downloadJobs.get([record.id, record.version])
    // B2：中断残留的非终态作业重置为 needs-download（保留已存字节，旧版本继续可用）
    if (job && (job.status === 'downloading' || job.status === 'verifying')) {
      const nowIso = input.now?.().toISOString() ?? new Date().toISOString()
      await input.db.downloadJobs.put({
        packId: record.id,
        version: record.version,
        status: 'needs-download',
        createdAt: job.createdAt,
        updatedAt: nowIso,
        data: job.data,
      })
      report.resetStaleJobs += 1
      job = await input.db.downloadJobs.get([record.id, record.version])
    }
    // 以实际存储字节为准（含 B1 保留的旧字节），不以作业状态字段为准
    const assetsReady = packValid && (assets.length === 0 || assets.every((asset) => Boolean((job?.data as { assets?: Record<string, unknown> } | undefined)?.assets?.[asset.id])))
    if (assetsReady && !record.resourcesReady) {
      await input.db.packs.update([record.id, record.version], { resourcesReady: true })
      report.restoredReady += 1
      continue
    }
    if (!assetsReady && record.resourcesReady) {
      await input.db.packs.update([record.id, record.version], { resourcesReady: false })
      const nowIso = input.now?.().toISOString() ?? new Date().toISOString()
      await input.db.downloadJobs.put({
        packId: record.id,
        version: record.version,
        status: 'needs-download',
        createdAt: job?.createdAt ?? nowIso,
        updatedAt: nowIso,
        data: { reason: 'asset-missing' },
      })
      report.markedNeedsDownload += 1
    }
  }
  return report
}

export interface DownloadOverviewRow {
  packId: string
  version: string
  titleZh: string
  resourcesReady: boolean
  packValid: boolean
  assetCount: number
  totalBytes: number
  jobStatus: string | null
}

export async function collectDownloadOverview(input: { db: GaokaoDatabase }): Promise<DownloadOverviewRow[]> {
  const rows = (await input.db.packs.toArray()).filter((row) => row.status === 'installed')
  const overview: DownloadOverviewRow[] = []
  for (const record of rows) {
    const pack = record.pack as { titleZh?: string } | null
    const assets = readPackAssets(record.pack)
    const packValid = Boolean(record.pack) && typeof record.pack === 'object' && typeof (record.pack as { id?: unknown }).id === 'string'
    const job = await input.db.downloadJobs.get([record.id, record.version])
    overview.push({
      packId: record.id,
      version: record.version,
      titleZh: typeof pack?.titleZh === 'string' ? pack.titleZh : record.id,
      resourcesReady: record.resourcesReady,
      packValid,
      assetCount: assets.length,
      totalBytes: assets.reduce((total, asset) => total + (typeof asset.bytes === 'number' ? asset.bytes : 0), 0),
      jobStatus: job?.status ?? null,
    })
  }
  return overview
}
