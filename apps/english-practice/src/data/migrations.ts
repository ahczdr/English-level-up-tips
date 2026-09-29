import Dexie, { type Table } from 'dexie'

export interface ItemRef { packId: string; packVersion: string; itemId: string }
export type SlotState = 'unseen' | 'answering' | 'submitted' | 'skipped'
export interface Slot { id: string; ref: ItemRef; state: SlotState; assistance: string[]; replayCount: number; audioSpeed: number }
export type SessionState = 'active' | 'paused' | 'completed'
export interface Session { id: string; profileId: string; unitId: string | null; slots: Slot[]; currentIndex: number; revision: number; state: SessionState; createdAt: string; updatedAt: string; studyDay: string; timeZone?: string }
export interface Exposure { packId: string; packVersion: string; itemId: string; familyId: string; profileId: string; firstSeenAt: string; studyDay: string; firstSeenSessionId: string }
// CR46/CR50：per-profile 曝光账本。legacy exposures 主键 [packId+packVersion+itemId] 不含 profileId，
// 跨 profile 互相覆盖、跨版本互不命中；exposureLog 主键含 profileId，独立判定/计划/证据全部改读此表
export interface ExposureLogRecord { profileId: string; packId: string; packVersion: string; itemId: string; familyId: string; firstSeenAt: string; studyDay: string; firstSeenSessionId: string }
export interface InstalledPack { id: string; version: string; status: string; pack: unknown; installedAt: string; resourcesReady: boolean }
export interface SettingRecord { id: string; value: unknown }
export interface AttemptRecord { id: string; sessionId: string; slotId: string; phase: string; familyId: string; profileId: string; studyDay: string; createdAt: string; payload: unknown }
export interface ReviewStateRecord { profileId: string; familyId: string; reviewMode: string; dueDay: string; updatedAt: string; data: unknown }
export interface DraftRecord { sessionId: string; itemId: string; updatedAt: string; content: string }
export interface WritingVersionRecord { id: string; sessionId: string; itemId: string; createdAt: string; studyDay?: string; content: string }
export interface AchievementRecord { id: string; profileId: string; unlockedAt: string; data: unknown }
export interface DownloadJobRecord { packId: string; version: string; status: string; createdAt: string; updatedAt: string; data: unknown }

export interface GaokaoDatabaseSchema {
  settings: Table<SettingRecord, string>
  packs: Table<InstalledPack, [string, string]>
  sessions: Table<Session, string>
  attempts: Table<AttemptRecord, string>
  exposures: Table<Exposure, [string, string, string]>
  exposureLog: Table<ExposureLogRecord, [string, string, string, string]>
  reviewStates: Table<ReviewStateRecord, [string, string, string]>
  drafts: Table<DraftRecord, [string, string]>
  writingVersions: Table<WritingVersionRecord, string>
  achievements: Table<AchievementRecord, string>
  downloadJobs: Table<DownloadJobRecord, [string, string]>
}

// v2 迁移的默认回填值：与 settings.DEFAULT_PERSONAL_SETTINGS.profileId 同值（值复制避免模块环）
export const FALLBACK_PROFILE_ID = 'gaokao-common-training-v1'

export function configureSchema(db: Dexie) {
  db.version(1).stores({
    settings: '&id',
    packs: '[id+version], status',
    sessions: 'id,state,studyDay',
    attempts: 'id,[sessionId+slotId+phase],familyId,studyDay',
    exposures: '[packId+packVersion+itemId],familyId',
    reviewStates: '[profileId+familyId+reviewMode],dueDay',
    drafts: '[sessionId+itemId]',
    writingVersions: 'id,[sessionId+itemId]',
    achievements: 'id',
    downloadJobs: '[packId+version]',
  })
  // CR2：attempts/exposures 补 profileId 列与索引；attempts 补 sessionId 索引（原为全表扫描回退）。
  // 旧数据按所属会话回填 profileId；找不到会话的孤儿行落默认 profile，不丢数据。
  db.version(2).stores({
    attempts: 'id,[sessionId+slotId+phase],sessionId,familyId,studyDay,profileId',
    exposures: '[packId+packVersion+itemId],familyId,profileId',
  }).upgrade(async (tx) => {
    const sessionRows = await tx.table('sessions').toArray()
    const profileOf = new Map<string, string>()
    for (const row of sessionRows as Array<{ id?: unknown; profileId?: unknown }>) {
      if (typeof row.id === 'string') profileOf.set(row.id, typeof row.profileId === 'string' ? row.profileId : FALLBACK_PROFILE_ID)
    }
    await tx.table('attempts').toCollection().modify((row: { sessionId?: unknown; profileId?: unknown }) => {
      row.profileId = typeof row.sessionId === 'string' ? (profileOf.get(row.sessionId) ?? FALLBACK_PROFILE_ID) : FALLBACK_PROFILE_ID
    })
    await tx.table('exposures').toCollection().modify((row: { firstSeenSessionId?: unknown; profileId?: unknown }) => {
      row.profileId = typeof row.firstSeenSessionId === 'string' ? (profileOf.get(row.firstSeenSessionId) ?? FALLBACK_PROFILE_ID) : FALLBACK_PROFILE_ID
    })
  })
  // T16/R2 口径注记：Dexie 不支持跨版本改主键（"Not yet support for changing primary key"），
  // exposures 保持三元组主键（每题一行）。v3 起 per-profile 口径由 exposureLog 承担。
  // CR51：v3 为 reviewStates/exposures 补 profileId/itemId 二级索引，供 .where() 查询替代全表扫描。
  db.version(3).stores({
    reviewStates: '[profileId+familyId+reviewMode],dueDay,profileId',
    exposures: '[packId+packVersion+itemId],familyId,profileId,itemId',
    exposureLog: '[profileId+packId+packVersion+itemId],profileId,itemId',
  }).upgrade(async (tx) => {
    // CR46/CR50：legacy exposures 回填 per-profile 账本（v2 已为旧行回填 profileId）
    const rows = await tx.table('exposures').toArray()
    if (rows.length === 0) return
    await tx.table('exposureLog').bulkAdd(
      (rows as Array<Record<string, unknown>>).map((row) => ({
        profileId: typeof row.profileId === 'string' ? row.profileId : FALLBACK_PROFILE_ID,
        packId: String(row.packId),
        packVersion: String(row.packVersion),
        itemId: String(row.itemId),
        familyId: String(row.familyId),
        firstSeenAt: String(row.firstSeenAt),
        studyDay: String(row.studyDay),
        firstSeenSessionId: String(row.firstSeenSessionId),
      })),
    )
  })
}
