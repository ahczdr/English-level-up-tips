// T11 成长记录（P06）：纯函数汇总，IO 由页面层装配（与 planner 同构）
// 原则：不刷奖励、不虚构进步结论、辅助与订正不混入独立掌握、题型/层级分开比较。
import { studyDayFor } from './calendar'
export type ProgressKind = 'choice' | 'order' | 'gaps' | 'reading' | 'cloze' | 'listening' | 'writing'
export type ProgressLevel = 'G0' | 'G1' | 'G2' | 'G3'

// 自评样本阈值：少于该数量只显示样本数，不算正式能力等级
export const SELF_EVAL_MIN = 3

export interface ProgressAttempt {
  id: string
  itemId: string
  familyId: string
  kind: ProgressKind
  level: ProgressLevel
  phase: 'first' | 'correction'
  studyDay: string
  createdAt: string
  gradeEarned: number
  gradePossible: number
  assisted: boolean
  firstSeenSelf: boolean
  /** CR8：条目所属课程包已卸载时为 true——保留进正确率/学习日统计，但不参与题型分组 */
  unknownItem?: boolean
}

export interface ProgressUnit { unitId: string; titleZh: string; familyIds?: string[] }
export interface ProgressAchievement { id: string; unlockedAt: string }
export interface ProgressWritingVersion {
  itemId: string
  createdAt: string
  studyDay?: string
  versionCount: number
  checklistCount: number
  firstText: string
  latestText: string
}

export interface ProgressInput {
  today: string
  profileId: string
  attempts: ProgressAttempt[]
  /** CR7 配套：今天已到期的复习家族（页面按 profileId + dueDay<=today 过滤后传入） */
  dueFamilies?: string[]
  totalItems: number
  exposedItemIds: string[]
  units: ProgressUnit[]
  achievements: ProgressAchievement[]
  writingVersions: ProgressWritingVersion[]
}

export interface ObjectiveRate { attempts: number; correct: number; rate: number }
export interface MapNode {
  unitId: string
  titleZh: string
  achievementId: string
  unlocked: boolean
  unlockedAt: string | null
  /** 该单元存在到期复习（学习地图黄标联动） */
  hasDue?: boolean
}
export interface Bucket { attempts: number; correct: number }
export interface ComparableSeries {
  kind: ProgressKind
  level: ProgressLevel
  thisWeek: Bucket
  earlier: Bucket
}
export interface WritingCard {
  itemId: string
  createdAt: string
  versionCount: number
  checklistCount: number
  firstText: string
  latestText: string
  conclusion?: never
}
export interface ProgressSummary {
  objective: ObjectiveRate
  assistedCompletions: number
  independentItems: number
  discoveredFamilies: number
  studyDays: string[]
  todayMarked: boolean
  unseenCount: number
  mapNodes: MapNode[]
  series: ComparableSeries[]
  writingCards: WritingCard[]
  selfEvalSamples: number
  selfEvalFormal: boolean
}

// 页面「今天」：与 attempt.studyDay 同一学习日口径（设置时区），页面默认路径调用
export const pageToday = (now: Date, timeZone: string): string => studyDayFor(now, timeZone)

// 连续学习天数：从今天（或昨天，今天还没练时）往回数连续有学习记录的天数。
// 纯函数供今日页鼓励卡使用；days 为去重后的学习日集合。
export function computeStreak(days: string[], today: string): number {
  const set = new Set(days)
  const shift = (day: string, delta: number): string => {
    const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))))
    d.setUTCDate(d.getUTCDate() + delta)
    return d.toISOString().slice(0, 10)
  }
  let cursor = set.has(today) ? today : shift(today, -1)
  if (!set.has(cursor)) return 0
  let streak = 0
  while (set.has(cursor)) {
    streak += 1
    cursor = shift(cursor, -1)
  }
  return streak
}

// 连续学习天数：从今天（或昨天，今天还没练时）往回数连续有学习记录的天数。
// 纯函数供今日页鼓励卡使用；days 为去重后的学习日集合。
// 本周自周一起算（学习日为本地时区日字符串，按日历日推算，不做时区换算）
export function weekStart(today: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today)
  if (!match) throw new Error('Invalid calendar day: ' + today)
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay()
  date.setUTCDate(date.getUTCDate() - (weekday - 1))
  return date.toISOString().slice(0, 10)
}

const rate = (correct: number, attempts: number): number => (attempts > 0 ? correct / attempts : 0)

export function summarizeProgress(input: ProgressInput): ProgressSummary {
  const weekBegin = weekStart(input.today)
  // 客观分母：独立首次作答，且排除写作（写作无客观判分，D08 不写客观 attempts；防御性再滤一次）
  const objectiveRows = input.attempts.filter(
    (row) => row.phase === 'first' && row.kind !== 'writing' && !row.assisted && row.firstSeenSelf && row.gradePossible > 0,
  )
  const objectiveCorrect = objectiveRows.filter((row) => row.gradeEarned === row.gradePossible).length
  const objective: ObjectiveRate = {
    attempts: objectiveRows.length,
    correct: objectiveCorrect,
    rate: rate(objectiveCorrect, objectiveRows.length),
  }
  // 提示后完成：有辅助的首次且完成该题（满分），与独立口径完全分开
  const assistedCompletions = input.attempts.filter(
    (row) => row.phase === 'first' && row.kind !== 'writing' && row.assisted && row.gradePossible > 0 && row.gradeEarned === row.gradePossible,
  ).length
  // 独立题数/发现家族：按条目与家族去重（重复刷同题不增加）
  const independentPassed = new Set(
    input.attempts
      .filter((row) => row.phase === 'first' && row.kind !== 'writing' && !row.assisted && row.firstSeenSelf && row.gradePossible > 0 && row.gradeEarned === row.gradePossible)
      .map((row) => row.itemId),
  )
  const discoveredFamilies = new Set(
    input.attempts
      .filter((row) => row.phase === 'first' && row.kind !== 'writing' && !row.assisted && row.firstSeenSelf && row.gradePossible > 0 && row.gradeEarned === row.gradePossible)
      .map((row) => row.familyId),
  )
  // 学习日：有效任务覆盖的学习日（客观/辅助首次作答与写作成品都算完成当日）；漏学不清零，累计保留
  const daySources = [
    ...input.attempts.filter((row) => row.phase === 'first' && row.kind !== 'writing' && row.gradePossible > 0).map((row) => row.studyDay),
    ...input.writingVersions.map((version) => version.studyDay ?? version.createdAt.slice(0, 10)),
  ]
  const studyDays = [...new Set(daySources)].sort()
  const todayMarked = studyDays.includes(input.today)
  // 未见题：总条目 - 已曝光
  const unseenCount = Math.max(0, input.totalItems - new Set(input.exposedItemIds).size)
  // 地图节点：按实际课程单元生成；成就主键 unit:first:<profileId>:<unitId>（CR49 per-profile），
  // 兼容旧格式 unit:first:<unitId>（单 profile 时代的历史数据），重复记录取最早解锁时间
  const firstUnlock = new Map<string, string>()
  for (const achievement of input.achievements) {
    const previous = firstUnlock.get(achievement.id)
    if (previous === undefined || achievement.unlockedAt < previous) firstUnlock.set(achievement.id, achievement.unlockedAt)
  }
  const mapNodes: MapNode[] = input.units.map((unit) => {
    const achievementId = `unit:first:${input.profileId}:${unit.unitId}`
    const legacyAchievementId = 'unit:first:' + unit.unitId
    const unlockedAt = firstUnlock.get(achievementId) ?? firstUnlock.get(legacyAchievementId) ?? null
    const familyIds = (unit as unknown as { familyIds?: string[] }).familyIds ?? []
    const hasDue = familyIds.some((f) => (input.dueFamilies ?? []).includes(f))
    return { unitId: unit.unitId, titleZh: unit.titleZh, achievementId, unlocked: unlockedAt !== null, unlockedAt, hasDue }
  })
  // 本周与前期可比较序列：按 题型+层级 分开；不同键绝不合并
  const buckets = new Map<string, ComparableSeries>()
  for (const row of objectiveRows) {
    if (row.unknownItem) continue
    const key = row.kind + '|' + row.level
    let serie = buckets.get(key)
    if (!serie) {
      serie = { kind: row.kind, level: row.level, thisWeek: { attempts: 0, correct: 0 }, earlier: { attempts: 0, correct: 0 } }
      buckets.set(key, serie)
    }
    const bucket = row.studyDay >= weekBegin ? serie.thisWeek : serie.earlier
    bucket.attempts += 1
    if (row.gradeEarned === row.gradePossible) bucket.correct += 1
  }
  const series = [...buckets.values()].sort((left, right) => (left.kind + left.level).localeCompare(right.kind + right.level))
  // 作品卡：初稿与最新版本对比，只呈现事实，不生成结论
  const writingCards: WritingCard[] = [...input.writingVersions]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((version) => ({
      itemId: version.itemId,
      createdAt: version.createdAt,
      versionCount: version.versionCount,
      checklistCount: version.checklistCount,
      firstText: version.firstText,
      latestText: version.latestText,
    }))
  // 自评：只标自评；样本按任务数计（同任务多版本不重复累加）；少于阈值只显示数量
  const selfEvalSamples = input.writingVersions.filter((version) => version.checklistCount > 0).length
  return {
    objective,
    assistedCompletions,
    independentItems: independentPassed.size,
    discoveredFamilies: discoveredFamilies.size,
    studyDays,
    todayMarked,
    unseenCount,
    mapNodes,
    series,
    writingCards,
    selfEvalSamples,
    selfEvalFormal: selfEvalSamples >= SELF_EVAL_MIN,
  }
}
