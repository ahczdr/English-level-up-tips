// 错题本：首次作答错误且尚未订正的题目集合（per-profile）。
// 口径：只统计 phase='first' 且未得满分的作答；同题后续订正满分则标 corrected。
import type { GaokaoDatabase } from '../data/db'
import { allPackRecords, latestInstalledByPackId } from '../data/pack-reader'
import type { CoursePack, Item } from '../content/types'
import type { Section } from '../content/types'

export interface MistakeRow {
  itemId: string
  familyId: string
  unitId: string
  unitTitleZh: string
  section: Section
  packId: string
  packVersion: string
  corrected: boolean
  lastStudyDay: string
}

interface ItemStats { wrongFirst: boolean; corrected: boolean; lastStudyDay: string; packId: string; packVersion: string }

export async function collectMistakes(db: GaokaoDatabase, profileId: string): Promise<MistakeRow[]> {
  const rows = await db.attempts.where('profileId').equals(profileId).toArray()
  const byItem = new Map<string, ItemStats>()
  for (const record of rows) {
    const payload = record.payload as {
      phase?: string
      grade?: { earned: number; possible: number }
      ref?: { packId: string; packVersion: string; itemId: string }
    }
    if (!payload.ref) continue
    const key = payload.ref.itemId
    const entry = byItem.get(key) ?? {
      wrongFirst: false,
      corrected: false,
      lastStudyDay: record.studyDay,
      packId: payload.ref.packId,
      packVersion: payload.ref.packVersion,
    }
    if (record.studyDay > entry.lastStudyDay) entry.lastStudyDay = record.studyDay
    const grade = payload.grade ?? { earned: 0, possible: 0 }
    const full = grade.possible > 0 && grade.earned === grade.possible
    if (record.phase === 'first' && !full) entry.wrongFirst = true
    if (record.phase === 'correction' && full) entry.corrected = true
    byItem.set(key, entry)
  }

  // 只列已安装（最新版本）包内可重练的错题；跨版本的旧记录按 itemId 归并
  const packs = latestInstalledByPackId(await allPackRecords(db))
  const itemIndex = new Map<string, { item: Item; pack: CoursePack; unitId: string; unitTitleZh: string }>()
  for (const record of packs) {
    const pack = record.pack as CoursePack
    if (!Array.isArray(pack?.items) || !Array.isArray(pack?.units)) continue
    for (const unit of pack.units) {
      for (const itemId of unit.itemIds) {
        const item = pack.items.find((candidate) => candidate.id === itemId)
        if (item && !itemIndex.has(itemId)) {
          itemIndex.set(itemId, { item, pack, unitId: unit.id, unitTitleZh: unit.titleZh })
        }
      }
    }
  }

  const result: MistakeRow[] = []
  for (const [itemId, stats] of byItem) {
    if (!stats.wrongFirst) continue
    const found = itemIndex.get(itemId)
    if (!found) continue
    result.push({
      itemId,
      familyId: found.item.familyId,
      unitId: found.unitId,
      unitTitleZh: found.unitTitleZh,
      section: found.item.section,
      packId: found.pack.id,
      packVersion: found.pack.version,
      corrected: stats.corrected,
      lastStudyDay: stats.lastStudyDay,
    })
  }
  return result.sort((left, right) => (left.lastStudyDay === right.lastStudyDay ? left.itemId.localeCompare(right.itemId) : left.lastStudyDay < right.lastStudyDay ? 1 : -1))
}
