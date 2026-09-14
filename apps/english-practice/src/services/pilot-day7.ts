// T17：第 7 天平行题抽取——从已练 family（同题型/同辅助结构）中选同技能同层级、
// 该 profile 未曝光过的题；输入顺序稳定、不引入随机，保证报告可复现。
// CLI 入口见 scripts/pilot-day7.ts（读取试点导出的 backup JSON）。
import type { Item } from '../content/types'

export interface ExposureLike {
  packId: string
  packVersion: string
  itemId: string
  profileId: string
  firstSeenAt: string
  studyDay: string
  firstSeenSessionId: string
}

export function collectExposedItemIds(input: { exposures: ExposureLike[]; profileId: string }): string[] {
  const ids: string[] = []
  for (const row of input.exposures) {
    if (row.profileId === input.profileId && !ids.includes(row.itemId)) ids.push(row.itemId)
  }
  return ids
}

export function selectUnseenParallel(input: {
  items: Item[]
  exposedIds: string[]
  familyIds: string[]
  skillId: string
  level: Item['level']
  count: number
}): Item[] {
  const exposed = new Set(input.exposedIds)
  const families = new Set(input.familyIds)
  const picked: Item[] = []
  for (const candidate of input.items) {
    if (picked.length >= input.count) break
    if (exposed.has(candidate.id)) continue
    if (!families.has(candidate.familyId)) continue
    if (candidate.level !== input.level) continue
    if (!candidate.skillIds.includes(input.skillId)) continue
    picked.push(candidate)
  }
  return picked
}

export function practicedFamilyIds(input: { items: Item[]; exposedIds: string[] }): string[] {
  const exposed = new Set(input.exposedIds)
  const families: string[] = []
  for (const item of input.items) {
    if (exposed.has(item.id) && !families.includes(item.familyId)) families.push(item.familyId)
  }
  return families
}

// —— T17 评审修复（B1/R1-R4）：备份 payload 级分析，CLI 层负责 envelope 校验拆包 ——

export interface BackupPayloadLike {
  packs: Array<{ id?: unknown; version?: unknown; pack?: unknown }>
  exposures: Array<Record<string, unknown>>
}

export type PilotErrorCode = 'NO_ITEMS' | 'NO_EXPOSURES' | 'OLD_SCHEMA' | 'PROFILE_NOT_FOUND' | 'PROFILE_REQUIRED'

export type PilotAnalysis =
  | { ok: true; value: { profiles: Record<string, number>; profileId: string; exposedCount: number; suggestions: Record<string, { ids: string[]; alsoCovers: string[] }>; gaps: Array<{ key: string; reason: 'never-practiced' | 'no-unseen-candidate' }>; warnings: string[] } }
  | { ok: false; error: { code: PilotErrorCode; messageZh: string } }

export function analyzeBackupPayload(input: { payload: BackupPayloadLike; profileIdArg?: string; count?: number }): PilotAnalysis {
  const warnings: string[] = []
  // 全局按 packId@version|itemId 去重（R3：同包多版本并存，同一题只计一次）
  const seen = new Set<string>()
  const items: Item[] = []
  for (const row of input.payload.packs ?? []) {
    const pack = row.pack as { items?: Item[] } | null
    if (!pack || !Array.isArray(pack.items)) continue
    const packKey = String(row.id ?? '') + '@' + String(row.version ?? '')
    for (const item of pack.items) {
      const key = packKey + '|' + item.id
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
  }
  if (items.length === 0) return { ok: false, error: { code: 'NO_ITEMS', messageZh: '备份中没有课程包条目（packs 为空或缺少 pack.items）' } }

  // profile 清单与计数（R2）；旧 schema 无 profileId 的行如实告警（R7）
  const profiles: Record<string, number> = {}
  let missingProfile = 0
  for (const row of input.payload.exposures ?? []) {
    const pid = row.profileId
    if (typeof pid !== 'string' || pid.length === 0) { missingProfile += 1; continue }
    profiles[pid] = (profiles[pid] ?? 0) + 1
  }
  if (missingProfile > 0) warnings.push('旧 schema 备份：' + missingProfile + ' 条 exposure 缺 profileId，视为未曝光（导入恢复后才会有归属）')
  if ((input.payload.exposures ?? []).length === 0) return { ok: false, error: { code: 'NO_EXPOSURES', messageZh: '备份中没有曝光记录——本工具供第 7 天试点使用；若确需空库分析请用应用内数据页核对' } }
  if (Object.keys(profiles).length === 0) return { ok: false, error: { code: 'OLD_SCHEMA', messageZh: '备份的曝光记录均缺 profileId（旧 schema 导出）——请在导入恢复后重新导出再运行' } }

  const profileIds = Object.keys(profiles)
  let profileId: string
  if (input.profileIdArg) {
    if (!(input.profileIdArg in profiles)) return { ok: false, error: { code: 'PROFILE_NOT_FOUND', messageZh: '备份曝光记录中不存在 profileId：' + input.profileIdArg + '（现有：' + profileIds.join(', ') + '）' } }
    profileId = input.profileIdArg
  } else if (profileIds.length === 1) {
    profileId = profileIds[0]
  } else {
    return { ok: false, error: { code: 'PROFILE_REQUIRED', messageZh: '备份包含多个 profile（' + profileIds.join(', ') + '），请显式传入 profileId' } }
  }

  const exposedIds = collectExposedItemIds({ exposures: input.payload.exposures as unknown as ExposureLike[], profileId })
  const familyIds = practicedFamilyIds({ items, exposedIds })
  const exposedSet = new Set(exposedIds)

  // 已曝光题的 skill 集合（区分两类缺口：该技能从未练过 vs 练过但无未曝光候选）
  const practicedSkills = new Set<string>()
  for (const item of items) {
    if (!exposedSet.has(item.id)) continue
    for (const skillId of item.skillIds) practicedSkills.add(skillId)
  }

  const buckets = new Map<string, { skillId: string; level: Item['level'] }>()
  for (const item of items) {
    for (const skillId of item.skillIds) {
      const key = skillId + '@' + item.level
      if (!buckets.has(key)) buckets.set(key, { skillId, level: item.level })
    }
  }

  const suggestions: Record<string, { ids: string[]; alsoCovers: string[] }> = {}
  const gaps: Array<{ key: string; reason: 'never-practiced' | 'no-unseen-candidate' }> = []
  const count = input.count ?? 3
  for (const [key, bucket] of buckets) {
    const picked = selectUnseenParallel({ items, exposedIds, familyIds, skillId: bucket.skillId, level: bucket.level, count })
    if (picked.length === 0) {
      gaps.push({ key, reason: practicedSkills.has(bucket.skillId) ? 'no-unseen-candidate' : 'never-practiced' })
      continue
    }
    const alsoCovers: string[] = []
    for (const p of picked) {
      for (const skillId of p.skillIds) if (skillId !== bucket.skillId && !alsoCovers.includes(skillId)) alsoCovers.push(skillId)
    }
    suggestions[key] = { ids: picked.map((p) => p.id), alsoCovers }
  }

  return { ok: true, value: { profiles, profileId, exposedCount: exposedIds.length, suggestions, gaps, warnings } }
}