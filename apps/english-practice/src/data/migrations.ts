import Dexie, { type Table } from 'dexie'

export interface ItemRef { packId: string; packVersion: string; itemId: string }
export type SlotState = 'unseen' | 'answering' | 'submitted' | 'skipped'
export interface Slot { id: string; ref: ItemRef; state: SlotState; assistance: string[]; replayCount: number; audioSpeed: number }
export type SessionState = 'active' | 'paused' | 'completed'
export interface Session { id: string; profileId: string; unitId: string | null; slots: Slot[]; currentIndex: number; revision: number; state: SessionState; createdAt: string; updatedAt: string; studyDay: string }
export interface Exposure { packId: string; packVersion: string; itemId: string; familyId: string; profileId: string; firstSeenAt: string; studyDay: string; firstSeenSessionId: string }
export interface InstalledPack { id: string; version: string; status: string; pack: unknown; installedAt: string; resourcesReady: boolean }
export interface SettingRecord { id: string; value: unknown }
export interface AttemptRecord { id: string; sessionId: string; slotId: string; phase: string; familyId: string; profileId: string; studyDay: string; createdAt: string; payload: unknown }
export interface ReviewStateRecord { profileId: string; familyId: string; reviewMode: string; dueDay: string; updatedAt: string; data: unknown }
export interface DraftRecord { sessionId: string; itemId: string; updatedAt: string; content: string }
export interface WritingVersionRecord { id: string; sessionId: string; itemId: string; createdAt: string; content: string }
export interface AchievementRecord { id: string; profileId: string; unlockedAt: string; data: unknown }
export interface DownloadJobRecord { packId: string; version: string; status: string; createdAt: string; updatedAt: string; data: unknown }

export interface GaokaoDatabaseSchema {
  settings: Table<SettingRecord, string>
  packs: Table<InstalledPack, [string, string]>
  sessions: Table<Session, string>
  attempts: Table<AttemptRecord, string>
  exposures: Table<Exposure, [string, string, string]>
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
  // exposures 保持三元组主键（每题一行）。多 profile 场景的独立判定由 submitAnswer 按
  // row.profileId !== session.profileId 放行，与规划/证据侧 per-profile 过滤口径一致；
  // per-profile 曝光行需在多用户版本以新表重建（记入后续范围）。
}
