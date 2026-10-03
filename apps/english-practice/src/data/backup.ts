// T13 备份导出与恢复（D09 备份 envelope）
// - envelope: { format, schemaVersion, exportedAt, appVersion, payloadSha256, payload }
// - 摘要：对 payload 做递归键排序的 JSON UTF-8 字节 SHA256，不依赖对象插入顺序
// - payload 覆盖 10 张学习/内容表 + 课程 JSON 快照；排除 downloadJobs 与音频字节
// - 限制：50 MiB、50000 条作答记录；导入先限制体积再解析；校验结构/摘要/版本/外键/ID 重复
// - 恢复：确认后单事务替换全部学习表；任何失败回滚（Dexie 事务原子性），不一边读一边覆盖

import type { GaokaoDatabase } from './db'
import { FALLBACK_PROFILE_ID } from './migrations'

export const BACKUP_FORMAT = 'gaokao-personal-backup'
export const BACKUP_SCHEMA_VERSION = 1
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024
export const MAX_ATTEMPT_RECORDS = 50000

export type BackupErrorCode =
  | 'SIZE_LIMIT'
  | 'INVALID_FORMAT'
  | 'NEWER_SCHEMA'
  | 'UNSUPPORTED_SCHEMA'
  | 'DIGEST_MISMATCH'
  | 'INVALID_PAYLOAD'
  | 'ORPHAN_RECORD'
  | 'DUPLICATE_ID'
  | 'ATTEMPT_LIMIT'
  | 'STORAGE_FAILED'

export type BackupResult<T> = { ok: true; value: T } | { ok: false; error: { code: BackupErrorCode; messageZh: string } }

export interface BackupPayload {
  settings: unknown[]
  packs: unknown[]
  sessions: unknown[]
  attempts: unknown[]
  exposures: unknown[]
  exposureLog: unknown[]
  reviewStates: unknown[]
  drafts: unknown[]
  writingVersions: unknown[]
  achievements: unknown[]
}

export interface BackupEnvelope {
  format: string
  schemaVersion: number
  exportedAt: string
  appVersion: string
  payloadSha256: string
  payload: BackupPayload
}

const BACKUP_TABLES = ['settings', 'packs', 'sessions', 'attempts', 'exposures', 'exposureLog', 'reviewStates', 'drafts', 'writingVersions', 'achievements'] as const

export const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item))
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      Object.defineProperty(sorted, key, {
        value: canonicalize(source[key]),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    return sorted
  }
  return value
}

// R2：拒绝任意深度的 own __proto__/constructor/prototype 键。
// 使用显式栈，避免固定递归深度让恶意 JSON 绕过检查或耗尽调用栈。
const hasDangerousKeys = (value: unknown): boolean => {
  const pending: unknown[] = [value]
  while (pending.length > 0) {
    const current = pending.pop()
    if (Array.isArray(current)) {
      pending.push(...current)
      continue
    }
    if (current === null || typeof current !== 'object') continue
    const source = current as Record<string, unknown>
    for (const key of Object.keys(source)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return true
      pending.push(source[key])
    }
  }
  return false
}

export const canonicalJsonString = (value: unknown): string => JSON.stringify(canonicalize(value))

export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const recordKeyOf = (row: unknown, path: string[]): string => {
  let cursor: unknown = row
  for (const segment of path) {
    if (cursor === null || typeof cursor !== 'object') return ''
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return typeof cursor === 'string' || typeof cursor === 'number' ? String(cursor) : ''
}

export interface ExportBackupValue { envelope: BackupEnvelope; json: string; sizeBytes: number }

export async function exportBackup(input: { db: GaokaoDatabase; appVersion?: string; now?: () => Date }): Promise<BackupResult<ExportBackupValue>> {
  try {
    const payload: BackupPayload = {
      settings: [],
      packs: [],
      sessions: [],
      attempts: [],
      exposures: [],
      exposureLog: [],
      reviewStates: [],
      drafts: [],
      writingVersions: [],
      achievements: [],
    }
    // R1：只读事务快照——避免逐表 toArray 之间并发写导致撕裂（静默丢最新数据）
    await input.db.transaction('r', [input.db.settings, input.db.packs, input.db.sessions, input.db.attempts, input.db.exposures, input.db.exposureLog, input.db.reviewStates, input.db.drafts, input.db.writingVersions, input.db.achievements], async () => {
      payload.settings = await input.db.settings.toArray()
      payload.packs = await input.db.packs.toArray()
      payload.sessions = await input.db.sessions.toArray()
      payload.attempts = await input.db.attempts.toArray()
      payload.exposures = await input.db.exposures.toArray()
      payload.exposureLog = await input.db.exposureLog.toArray()
      payload.reviewStates = await input.db.reviewStates.toArray()
      payload.drafts = await input.db.drafts.toArray()
      payload.writingVersions = await input.db.writingVersions.toArray()
      payload.achievements = await input.db.achievements.toArray()
    })
    const payloadSha256 = await sha256Hex(canonicalJsonString(payload))
    const envelope: BackupEnvelope = {
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: input.now?.().toISOString() ?? new Date().toISOString(),
      appVersion: input.appVersion ?? '0.1.0',
      payloadSha256,
      payload,
    }
    const json = JSON.stringify(envelope)
    return { ok: true, value: { envelope, json, sizeBytes: new TextEncoder().encode(json).length } }
  } catch {
    return { ok: false, error: { code: 'STORAGE_FAILED', messageZh: '备份读取失败，请稍后再试' } }
  }
}

const fail = (code: BackupErrorCode, messageZh: string): BackupResult<never> => ({ ok: false, error: { code, messageZh } })

const validatePayload = (payload: BackupPayload, maxAttempts: number): BackupResult<null> => {
  // 旧版备份（exposureLog 引入前）没有该键：按空表接受，恢复侧从 exposures 重建
  if ((payload as unknown as Record<string, unknown>).exposureLog === undefined) {
    ;(payload as unknown as Record<string, unknown>).exposureLog = []
  }
  // R2：拒绝未知顶层键与危险键（收紧静默容忍）
  const payloadKeys = Object.keys(payload as unknown as Record<string, unknown>)
  for (const key of payloadKeys) {
    if (!(BACKUP_TABLES as readonly string[]).includes(key)) {
      return fail('INVALID_PAYLOAD', '备份内容无效：未知字段 ' + key)
    }
  }
  if (hasDangerousKeys(payload)) {
    return fail('INVALID_PAYLOAD', '备份内容无效：包含不安全的原型键')
  }
  for (const key of BACKUP_TABLES) {
    if (!Array.isArray((payload as unknown as Record<string, unknown>)[key])) {
      return fail('INVALID_PAYLOAD', '备份内容无效：缺少 ' + key)
    }
  }
  if (payload.attempts.length > maxAttempts) {
    return fail('ATTEMPT_LIMIT', '作答记录超过上限（' + String(maxAttempts) + ' 条），拒绝导入以避免静默丢数据')
  }
  // ID 重复检查（主键级）
  const keyPaths: Array<[keyof BackupPayload, string[]]> = [
    ['settings', ['id']],
    ['packs', ['id', 'version']],
    ['sessions', ['id']],
    ['attempts', ['id']],
    ['exposures', ['packId', 'packVersion', 'itemId']],
    ['exposureLog', ['profileId', 'packId', 'packVersion', 'itemId']],
    ['reviewStates', ['profileId', 'familyId', 'reviewMode']],
    ['drafts', ['sessionId', 'itemId']],
    ['writingVersions', ['id']],
    ['achievements', ['id']],
  ]
  for (const [table, path] of keyPaths) {
    const seen = new Set<string>()
    for (const row of payload[table] as unknown[]) {
      const key = path.map((segment) => recordKeyOf(row, [segment])).join('|')
      if (seen.has(key)) {
        return fail('DUPLICATE_ID', '备份存在重复记录：' + String(table) + '（' + key + '）')
      }
      seen.add(key)
    }
  }
  const sessionIds = new Set((payload.sessions as Array<Record<string, unknown>>).map((row) => recordKeyOf(row, ['id'])))
  // 外键检查：所有会话引用必须落在 sessions 内
  const refs: Array<[keyof BackupPayload, string]> = [
    ['attempts', 'sessionId'],
    ['exposures', 'firstSeenSessionId'],
    ['exposureLog', 'firstSeenSessionId'],
    ['drafts', 'sessionId'],
    ['writingVersions', 'sessionId'],
  ]
  for (const [table, field] of refs) {
    for (const row of payload[table] as Array<Record<string, unknown>>) {
      const sessionId = recordKeyOf(row, [field])
      if (sessionId !== '' && !sessionIds.has(sessionId)) {
        return fail('ORPHAN_RECORD', '备份存在孤立记录：' + String(table) + '.' + field + '=' + sessionId + ' 不在 sessions 中')
      }
    }
  }
  // 课程快照行必须带 id/version
  for (const row of payload.packs as Array<Record<string, unknown>>) {
    if (recordKeyOf(row, ['id']) === '' || recordKeyOf(row, ['version']) === '') {
      return fail('INVALID_PAYLOAD', '备份内容无效：packs 缺少 id/version')
    }
  }
  return { ok: true, value: null }
}

export async function validateBackupJson(input: { text: string; maxSizeBytes?: number; maxAttempts?: number }): Promise<BackupResult<BackupEnvelope>> {
  const maxSizeBytes = input.maxSizeBytes ?? MAX_BACKUP_BYTES
  const maxAttempts = input.maxAttempts ?? MAX_ATTEMPT_RECORDS
  // D09：先限制体积再解析
  const sizeBytes = new TextEncoder().encode(input.text).length
  if (sizeBytes > maxSizeBytes) {
    return fail('SIZE_LIMIT', '备份文件超过 ' + String(Math.round(maxSizeBytes / (1024 * 1024))) + ' MiB 限制，拒绝导入')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(input.text)
  } catch {
    return fail('INVALID_FORMAT', '不是有效的备份文件（JSON 解析失败）')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('INVALID_FORMAT', '不是有效的备份文件')
  }
  const envelope = parsed as Record<string, unknown>
  if (envelope.format !== BACKUP_FORMAT) {
    return fail('INVALID_FORMAT', '不是有效的备份文件（format 不匹配）')
  }
  if (typeof envelope.schemaVersion !== 'number') {
    return fail('INVALID_FORMAT', '不是有效的备份文件（缺少 schemaVersion）')
  }
  if (envelope.schemaVersion > BACKUP_SCHEMA_VERSION) {
    return fail('NEWER_SCHEMA', '备份来自更新版本的应用，请先升级应用后再导入')
  }
  if (envelope.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    return fail('UNSUPPORTED_SCHEMA', '不支持的备份版本：' + String(envelope.schemaVersion))
  }
  if (typeof envelope.payloadSha256 !== 'string' || envelope.payload === null || typeof envelope.payload !== 'object') {
    return fail('INVALID_FORMAT', '不是有效的备份文件（缺少 payload/摘要）')
  }
  const recomputed = await sha256Hex(canonicalJsonString(envelope.payload))
  if (recomputed !== envelope.payloadSha256) {
    return fail('DIGEST_MISMATCH', '备份内容校验失败（摘要不匹配），文件可能被篡改或损坏')
  }
  const payloadCheck = validatePayload(envelope.payload as BackupPayload, maxAttempts)
  if (!payloadCheck.ok) return payloadCheck
  if (typeof envelope.exportedAt !== 'string' || typeof envelope.appVersion !== 'string') {
    return fail('INVALID_FORMAT', '不是有效的备份文件（缺少 exportedAt/appVersion）')
  }
  return { ok: true, value: envelope as unknown as BackupEnvelope }
}

export interface RestoreReport { counts: Record<string, number>; audioPacksNeedingDownload: number; audioPacksReadyFromCache: number }

// 单事务恢复：clear + bulkAdd 全部备份表；任何失败 Dexie 回滚整个事务（原库不变）。
// 恢复后音频口径如实（CR9）：downloadJobs 中已保留的字节仍有效，按字节存在性重算
// resourcesReady——齐全即 ready（提示「已保留」），缺失才计入「需补下载」。
export async function restoreBackup(input: { db: GaokaoDatabase; envelope: BackupEnvelope; now?: () => Date }): Promise<BackupResult<RestoreReport>> {
  const payload = input.envelope.payload
  try {
    const counts: Record<string, number> = {}
    let audioPacksNeedingDownload = 0
    let audioPacksReadyFromCache = 0
    const legacyExposureLog = payload.exposureLog.length === 0
    await input.db.transaction('rw', [input.db.settings, input.db.packs, input.db.sessions, input.db.attempts, input.db.exposures, input.db.exposureLog, input.db.reviewStates, input.db.drafts, input.db.writingVersions, input.db.achievements, input.db.downloadJobs], async () => {
      for (const key of BACKUP_TABLES) {
        const table = input.db[key] as unknown as { clear: () => Promise<void>; bulkAdd: (rows: unknown[]) => Promise<void> }
        await table.clear()
        const rows = payload[key]
        if (rows.length > 0) await table.bulkAdd(rows)
        counts[key] = rows.length
      }
      // CR55：回填用集合级 modify 一次完成（此前逐行 update，最坏 10 万次事务内写）。
      // 旧版备份（DB schema v1 时期）的 attempts/exposures 无 profileId：按所属会话回填，
      // 找不到会话的行落默认 profile，保证 CR2 的 profile 过滤对恢复数据同样成立
      const sessionRows = await input.db.sessions.toArray()
      const profileOf = new Map(sessionRows.map((row) => [row.id, row.profileId]))
      await input.db.attempts.toCollection().modify((row: { profileId?: string; sessionId: string }) => {
        if (row.profileId === undefined) row.profileId = profileOf.get(row.sessionId) ?? FALLBACK_PROFILE_ID
      })
      await input.db.exposures.toCollection().modify((row: { profileId?: string; firstSeenSessionId: string }) => {
        if (row.profileId === undefined) row.profileId = profileOf.get(row.firstSeenSessionId) ?? FALLBACK_PROFILE_ID
      })
      await input.db.exposureLog.toCollection().modify((row: { profileId?: string; firstSeenSessionId: string }) => {
        if (row.profileId === undefined) row.profileId = profileOf.get(row.firstSeenSessionId) ?? FALLBACK_PROFILE_ID
      })
      // 旧版备份没有 per-profile 曝光账本：从已回填 profileId 的 exposures 重建
      if (legacyExposureLog) {
        const rows = await input.db.exposures.toArray()
        counts.exposureLog = rows.length
        if (rows.length > 0) {
          await input.db.exposureLog.bulkAdd(rows.map((row) => ({
            profileId: row.profileId,
            packId: row.packId,
            packVersion: row.packVersion,
            itemId: row.itemId,
            familyId: row.familyId,
            firstSeenAt: row.firstSeenAt,
            studyDay: row.studyDay,
            firstSeenSessionId: row.firstSeenSessionId,
          })))
        }
      }
      // CR9：音频口径如实——备份不含字节，但本机 downloadJobs 旧字节仍在。
      // 按字节存在性重算 resourcesReady：齐全 → ready（已保留），缺失 → 需补下载。
      const packs = await input.db.packs.toArray()
      for (const row of packs) {
        const pack = row.pack as { assets?: Array<{ id: string }> } | undefined
        const assets = pack && typeof pack === 'object' && Array.isArray(pack.assets) ? pack.assets : []
        if (assets.length === 0) {
          await input.db.packs.update([row.id, row.version], { resourcesReady: true })
          continue
        }
        const job = await input.db.downloadJobs.get([row.id, row.version])
        const storedAssets = (job?.data as { assets?: Record<string, unknown> } | undefined)?.assets
        const allPresent = assets.every((asset) => Boolean(storedAssets?.[asset.id]))
        await input.db.packs.update([row.id, row.version], { resourcesReady: allPresent })
        if (allPresent) audioPacksReadyFromCache += 1
        else audioPacksNeedingDownload += 1
      }
    })
    return { ok: true, value: { counts, audioPacksNeedingDownload, audioPacksReadyFromCache } }
  } catch (error) {
    console.error('[backup] restore failed:', error)
    return { ok: false, error: { code: 'STORAGE_FAILED', messageZh: '恢复失败，原数据未受影响，请重试或先导出当前记录' } }
  }
}
