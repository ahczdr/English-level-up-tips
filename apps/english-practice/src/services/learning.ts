import { e2eNow } from '../data/e2e-clock'
import type { CoursePack, Item } from '../content/types'
import { AnswerError, gradeAnswer, type Answer, type Grade } from '../domain/answers'
import { studyDayFor } from '../domain/calendar'
import { scheduleReview, type ReviewState } from '../domain/scheduler'
import {
  planToday,
  suggestLevelUp,
  type LevelUpEvidence,
  type PlanDueReview,
  type PlanGroup,
  type PlanItem,
  type PlanTodayInput,
  type PlanTodayResult,
  type PlannerLevel,
} from '../domain/planner'
import type { GaokaoDatabase } from '../data/db'
import { allPackRecords, findInstalledRecord, verifyInstalledRefs } from '../data/pack-reader'
import type { AttemptRecord, Exposure, Session, Slot } from '../data/migrations'

export type AppErrorCode = 'INVALID_CONTENT' | 'INVALID_ANSWER' | 'NOT_FOUND' | 'STALE_SESSION' | 'CONTENT_MISSING' | 'ALREADY_SUBMITTED' | 'INSUFFICIENT_SPACE' | 'STORAGE_FAILED'
export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: AppErrorCode; messageZh: string } }

export type { Answer, Grade }

export interface SubmitCommand {
  id: string
  sessionId: string
  slotId: string
  expectedRevision: number
  answer: Answer
}

export interface Attempt {
  id: string
  sessionId: string
  slotId: string
  ref: { packId: string; packVersion: string; itemId: string }
  familyId: string
  phase: 'first' | 'correction'
  profileId: string
  answer: Answer
  grade: Grade
  assistance: string[]
  replayCount: number
  audioSpeed: number
  createdAt: string
  studyDay: string
  revision: number
}

export type HintKind = 'translation' | 'rule' | 'answer' | 'transcript' | 'model-answer' | 'word-bank' | 'slow-audio'
const hintKinds: readonly HintKind[] = ['translation', 'rule', 'answer', 'transcript', 'model-answer', 'word-bank', 'slow-audio']

export interface HintCommand {
  sessionId: string
  slotId: string
  hint: HintKind
  expectedRevision: number
}

export interface SessionActionCommand {
  sessionId: string
  slotId: string
  expectedRevision: number
}

export interface LearningClock { now(): Date }
export interface CreateSessionInput {
  db: GaokaoDatabase
  unitId: string | null
  minutes: number
  profileId: string
  clock?: LearningClock
  idGenerator?: () => string
}

export type CreateSessionValue =
  | { kind: 'session'; session: Session }
  | { kind: 'empty'; messageZh: string }

const systemClock: LearningClock = { now: () => e2eNow() }
const defaultId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`

const studyDay = (date: Date) => {
  return studyDayFor(date)
}

const error = (code: AppErrorCode, messageZh: string): Result<never> => ({ ok: false, error: { code, messageZh } })
const packValue = (record: { pack: unknown }) => record.pack as CoursePack
const installed = (record: { status: string; resourcesReady: boolean }) => record.status === 'installed' && record.resourcesReady

const findItem = (pack: CoursePack, itemId: string): Item | undefined => pack.items.find((item) => item.id === itemId)
const packHasItem = (packValueUnknown: unknown, itemId: string): boolean => {
  const pack = packValueUnknown as CoursePack
  return Array.isArray(pack?.items) && pack.items.some((item) => item.id === itemId)
}

// —— T10 今日规划：按共享材料合并题组（与 createSession 的组合逻辑一致，但独立实现避免回归） ——
const mergeBySharedResource = (items: Item[]): Item[][] => {
  const ranges = new Map<string, { start: number; end: number }>()
  items.forEach((item, index) => {
    if (item.resourceId === null) return
    const range = ranges.get(item.resourceId)
    if (range) range.end = index
    else ranges.set(item.resourceId, { start: index, end: index })
  })
  const mergedRanges: Array<{ start: number; end: number }> = []
  for (const range of [...ranges.values()].sort((left, right) => left.start - right.start)) {
    const last = mergedRanges.at(-1)
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end)
    else mergedRanges.push({ ...range })
  }
  const groups: Item[][] = []
  for (let index = 0; index < items.length;) {
    const range = mergedRanges.find((candidate) => candidate.start === index)
    if (range) {
      groups.push(items.slice(index, range.end + 1))
      index = range.end + 1
    } else {
      groups.push([items[index] as Item])
      index += 1
    }
  }
  return groups
}

export interface TodayPlanBundle {
  plan: PlanTodayResult
  today: string
  minutes: number
  candidateGroups: number
}

export interface TodayPlanOptions {
  minutes: number
  profileId: string
  clock?: LearningClock
  seed?: string
}

const collectTodayPlanBundle = async (db: GaokaoDatabase, options: TodayPlanOptions): Promise<TodayPlanBundle & { input: PlanTodayInput }> => {
  const moment = (options.clock ?? systemClock).now()
  const today = studyDay(moment)
  const budgetSeconds = Math.max(0, options.minutes) * 60
  const records = (await allPackRecords(db)).filter((record) => installed(record))
  const groups: PlanGroup[] = []
  for (const record of records) {
    const pack = packValue(record)
    for (const unit of pack.units) {
      const unitItems = unit.itemIds
        .map((itemId) => findItem(pack, itemId))
        .filter((item): item is Item => item !== undefined)
      for (const groupItems of mergeBySharedResource(unitItems)) {
        const planItems: PlanItem[] = groupItems.map((item) => ({
          id: item.id,
          familyId: item.familyId,
          reviewMode: item.reviewMode,
          level: item.level,
          estimatedSeconds: item.estimatedSeconds,
          packId: pack.id,
          packVersion: pack.version,
          unitId: unit.id,
          unitTitleZh: unit.titleZh,
        }))
        groups.push({ packId: pack.id, packVersion: pack.version, unitId: unit.id, unitTitleZh: unit.titleZh, items: planItems, kind: 'new' })
      }
    }
  }
  const dueReviews: PlanDueReview[] = (await db.reviewStates.toArray())
    .filter((record) => record.profileId === options.profileId)
    .map((record) => ({ familyId: record.familyId, reviewMode: record.reviewMode, dueDay: record.dueDay }))
  // 曝光按 profile 过滤：其他 profile 见过的题对本 profile 仍是新内容（CR2）
  const exposedItemIds = (await db.exposures.toArray()).filter((exposure) => exposure.profileId === options.profileId).map((exposure) => exposure.itemId)
  const input: PlanTodayInput = {
    today,
    budgetSeconds,
    seed: options.seed ?? `preview:${options.profileId}:${today}`,
    groups,
    dueReviews,
    exposedItemIds,
  }
  return { input, plan: planToday(input), today, minutes: options.minutes, candidateGroups: groups.length }
}

export interface PreviewTodayPlanInput extends TodayPlanOptions {
  db: GaokaoDatabase
}

export async function previewTodayPlan(options: PreviewTodayPlanInput): Promise<Result<TodayPlanBundle>> {
  try {
    const today = studyDay((options.clock ?? systemClock).now())
    // 摘要与实际会话同源：已有今日会话时以其 sessionId 为 seed，紧预算下组成一致
    const marker = await options.db.settings.get(`today-session:${options.profileId}:${today}`)
    const seed = marker !== undefined && typeof marker.value === 'string' ? marker.value : (options.seed ?? `preview:${options.profileId}:${today}`)
    const bundle = await collectTodayPlanBundle(options.db, { ...options, seed })
    return { ok: true, value: bundle }
  } catch {
    return error('STORAGE_FAILED', '今日计划读取失败，请稍后再试')
  }
}

export interface CreateTodaySessionInput {
  db: GaokaoDatabase
  minutes: number
  profileId: string
  clock?: LearningClock
  idGenerator?: () => string
}

// 今日计划会话：seed=sessionId 冻结抽题；生成后持久化，刷新/重开不重新抽题
export async function createTodaySession(input: CreateTodaySessionInput): Promise<Result<CreateSessionValue>> {
  try {
    const probeToday = studyDay((input.clock ?? systemClock).now())
    // 同日冻结：已有进行中/暂停的今日会话则直接复用（刷新或重复点击不重新抽题）
    const markerId = `today-session:${input.profileId}:${probeToday}`
    // CR4：marker 检查 → 建会话 → 写 marker 整体放进同一读写事务，
    // 并发调用在事务上串行化，第二个调用在事务内看到 marker 即复用，不再产生孤儿会话
    const reusable = async (): Promise<Session | null> => {
      const marker = await input.db.settings.get(markerId)
      if (marker === undefined || typeof marker.value !== 'string') return null
      const existing = await input.db.sessions.get(marker.value)
      if (existing !== undefined && (existing.state === 'active' || existing.state === 'paused')) return existing
      return null
    }
    const early = await reusable()
    if (early !== null) return { ok: true, value: { kind: 'session', session: early } }
    const sessionId = (input.idGenerator ?? defaultId)()
    const bundle = await collectTodayPlanBundle(input.db, { minutes: input.minutes, profileId: input.profileId, clock: input.clock, seed: sessionId })
    if (bundle.candidateGroups === 0) return error('CONTENT_MISSING', '暂无可用课程内容，请先准备学习内容')
    if (bundle.plan.groups.length === 0) {
      // CR17：无到期复习且候选全为熟题时是「今日已完成」的正常空态，不是预算不足
      if (bundle.plan.needsLongerSession) return error('INSUFFICIENT_SPACE', '当前时长装不下完整学习材料组，请选择更长时间')
      return { ok: true, value: { kind: 'empty', messageZh: '今日计划已全部完成，等待复习到期或补充新内容。' } }
    }
    const moment = (input.clock ?? systemClock).now()
    const slots: Slot[] = bundle.plan.groups.flatMap((group) =>
      group.items.map((item) => ({
        id: `${sessionId}:${item.id}`,
        ref: { packId: item.packId, packVersion: item.packVersion, itemId: item.id },
        state: 'unseen' as const,
        assistance: [],
        replayCount: 0,
        audioSpeed: 1,
      })),
    )
    const session: Session = {
      id: sessionId,
      profileId: input.profileId,
      // 今日会话跨单元混合，不挂单一单元标签；unit:first 成就以 unitId 存在为前提
      unitId: null,
      slots,
      currentIndex: 0,
      revision: 0,
      state: 'active',
      createdAt: moment.toISOString(),
      updatedAt: moment.toISOString(),
      studyDay: bundle.today,
    }
    const value = await input.db.transaction('rw', input.db.sessions, input.db.settings, async (): Promise<CreateSessionValue> => {
      const again = await reusable()
      if (again !== null) return { kind: 'session', session: again }
      await input.db.sessions.add(session)
      await input.db.settings.put({ id: markerId, value: session.id })
      return { kind: 'session', session }
    })
    return { ok: true, value }
  } catch {
    return error('STORAGE_FAILED', '今日会话创建失败，请稍后再试')
  }
}

// P03 升级建议证据：有效独立首次作答、学习日、家族、正确率与连续首次错误
export async function collectLevelUpEvidence(db: GaokaoDatabase, profileId: string, currentLevel: PlannerLevel = 'G0'): Promise<Result<{ evidence: LevelUpEvidence; suggestion: ReturnType<typeof suggestLevelUp> }>> {
  try {
    // CR2：作答与曝光都按 profileId 过滤，跨 profile 不混算
    const rows = (await db.attempts.toArray()).filter((record) => record.phase === 'first' && record.profileId === profileId)
    // P03：提示后的正确与熟题重试不参与有效独立首次统计（D06 独立首次三条件）
    const exposures = (await db.exposures.toArray()).filter((exposure) => exposure.profileId === profileId)
    const exposureSessions = new Map(exposures.map((exposure) => [`${exposure.packId}|${exposure.packVersion}|${exposure.itemId}`, exposure.firstSeenSessionId]))
    type FirstRow = { gradeEarned: number; gradePossible: number; studyDay: string; familyId: string; createdAt: string }
    const firsts: FirstRow[] = []
    for (const record of rows) {
      const payload = record.payload as { grade?: { earned: number; possible: number }; assistance?: string[]; ref?: { packId: string; packVersion: string; itemId: string } }
      const grade = payload.grade ?? { earned: 0, possible: 0 }
      if (payload.assistance !== undefined && payload.assistance.length > 0) continue
      if (payload.ref !== undefined) {
        const key = `${payload.ref.packId}|${payload.ref.packVersion}|${payload.ref.itemId}`
        const firstSeenSessionId = exposureSessions.get(key)
        if (firstSeenSessionId !== undefined && firstSeenSessionId !== record.sessionId) continue
      }
      firsts.push({ gradeEarned: grade.earned, gradePossible: grade.possible, studyDay: record.studyDay, familyId: record.familyId, createdAt: record.createdAt })
    }
    const chronological = [...firsts].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    let consecutiveFirstErrors = 0
    for (let index = chronological.length - 1; index >= 0; index -= 1) {
      const row = chronological[index] as FirstRow
      if (row.gradePossible > 0 && row.gradeEarned < row.gradePossible) consecutiveFirstErrors += 1
      else break
    }
    const independent = firsts.filter((row) => row.gradePossible > 0)
    const passes = independent.filter((row) => row.gradeEarned === row.gradePossible).length
    const evidence: LevelUpEvidence = {
      firstAttempts: independent.length,
      distinctDays: new Set(independent.map((row) => row.studyDay)).size,
      families: new Set(independent.map((row) => row.familyId)).size,
      accuracy: independent.length > 0 ? passes / independent.length : 0,
      consecutiveFirstErrors,
    }
    return { ok: true, value: { evidence, suggestion: suggestLevelUp(evidence, currentLevel) } }
  } catch {
    return error('STORAGE_FAILED', '学习证据读取失败，请稍后再试')
  }
}

export async function createSession(input: CreateSessionInput): Promise<Result<CreateSessionValue>> {
  try {
    if (input.unitId === null) return { ok: true, value: { kind: 'empty', messageZh: '请选择课程' } }
    const records = await allPackRecords(input.db)
    const allWithUnit = records.some((record) => packValue(record).units.some((unit) => unit.id === input.unitId))
    const record = records.find((candidate) => installed(candidate) && packValue(candidate).units.some((unit) => unit.id === input.unitId))
    if (!record) return allWithUnit ? error('CONTENT_MISSING', '课程内容尚未下载完成，请稍后再试') : error('NOT_FOUND', '未找到指定课程单元')

    const pack = packValue(record)
    const unit = pack.units.find((candidate) => candidate.id === input.unitId)
    if (!unit) return error('NOT_FOUND', '未找到指定课程单元')
    const items = unit.itemIds.map((itemId) => findItem(pack, itemId))
    if (items.some((item): item is undefined => !item)) return error('CONTENT_MISSING', '课程条目内容缺失，请重新下载课程包')

    const ranges = new Map<string, { start: number; end: number }>()
    ;(items as Item[]).forEach((item, index) => {
      if (item.resourceId === null) return
      const range = ranges.get(item.resourceId)
      if (range) range.end = index
      else ranges.set(item.resourceId, { start: index, end: index })
    })
    const mergedRanges: Array<{ start: number; end: number }> = []
    for (const range of [...ranges.values()].sort((left, right) => left.start - right.start)) {
      const last = mergedRanges.at(-1)
      if (last && range.start <= last.end) last.end = Math.max(last.end, range.end)
      else mergedRanges.push({ ...range })
    }
    const groups: Item[][] = []
    for (let index = 0; index < items.length;) {
      const item = items[index] as Item
      const range = mergedRanges.find((candidate) => candidate.start === index)
      if (range) {
        groups.push((items as Item[]).slice(index, range.end + 1))
        index = range.end + 1
      } else {
        groups.push([item])
        index += 1
      }
    }
    const budget = Math.max(0, input.minutes) * 60
    const chosen: Item[] = []
    let usedSeconds = 0
    for (const group of groups) {
      const groupSeconds = group.reduce((sum, item) => sum + item.estimatedSeconds, 0)
      if (usedSeconds + groupSeconds > budget) continue
      chosen.push(...group)
      usedSeconds += groupSeconds
    }
    if (chosen.length === 0) return error('INSUFFICIENT_SPACE', '当前时长不足以容纳完整学习材料组')

    const now = (input.clock ?? systemClock).now()
    const sessionId = (input.idGenerator ?? defaultId)()
    const slots: Slot[] = chosen.map((item, index) => ({
      id: `${sessionId}:${index}`,
      ref: { packId: pack.id, packVersion: pack.version, itemId: item.id },
      state: 'unseen',
      assistance: [],
      replayCount: 0,
      audioSpeed: 1,
    }))
    const session: Session = {
      id: sessionId,
      profileId: input.profileId,
      unitId: input.unitId,
      slots,
      currentIndex: 0,
      revision: 0,
      state: 'active',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      studyDay: studyDay(now),
    }
    await input.db.sessions.add(session)
    return { ok: true, value: { kind: 'session', session } }
  } catch {
    return error('STORAGE_FAILED', '本地存储写入失败，请检查设备存储空间')
  }
}

const verifySlotContent = async (db: GaokaoDatabase, session: Session) => {
  return verifyInstalledRefs(db, session.slots.map((slot) => slot.ref), packHasItem)
}

export async function loadSession(db: GaokaoDatabase, sessionId: string): Promise<Result<Session>> {
  try {
    const session = await db.sessions.get(sessionId)
    if (!session) return error('NOT_FOUND', '未找到指定学习记录')
    if (!(await verifySlotContent(db, session))) return error('CONTENT_MISSING', '课程内容已缺失或版本不符，请重新下载课程包')
    return { ok: true, value: session }
  } catch {
    return error('STORAGE_FAILED', '本地存储读取失败，请检查设备存储空间')
  }
}

export async function enterCurrentSlot(db: GaokaoDatabase, sessionId: string, clock: LearningClock = systemClock): Promise<Result<Session>> {
  try {
    return await db.transaction('rw', db.sessions, db.exposures, db.packs, async () => {
      const session = await db.sessions.get(sessionId)
      if (!session) return error('NOT_FOUND', '未找到指定学习记录')
      const slot = session.slots[session.currentIndex]
      if (!slot) return { ok: true, value: session }
      const record = await findInstalledRecord(db, slot.ref)
      const item = record && findItem(packValue(record), slot.ref.itemId)
      if (!record || !item) return error('CONTENT_MISSING', '课程内容已缺失或版本不符，请重新下载课程包')
      const existing = await db.exposures.get([slot.ref.packId, slot.ref.packVersion, slot.ref.itemId])
      if (!existing) {
        const now = clock.now()
        await db.exposures.add({
          packId: slot.ref.packId,
          packVersion: slot.ref.packVersion,
          itemId: slot.ref.itemId,
          familyId: item.familyId,
          profileId: session.profileId,
          firstSeenAt: now.toISOString(),
          studyDay: studyDay(now),
          firstSeenSessionId: session.id,
        } satisfies Exposure)
      }
      if (slot.state === 'unseen') {
        slot.state = 'answering'
        session.revision += 1
        session.updatedAt = clock.now().toISOString()
        await db.sessions.put(session)
      }
      return { ok: true, value: session }
    })
  } catch {
    return error('STORAGE_FAILED', '本地存储写入失败，请检查设备存储空间')
  }
}

const changeState = async (db: GaokaoDatabase, sessionId: string, state: Session['state'], clock: LearningClock): Promise<Result<Session>> => {
  try {
    const session = await db.sessions.get(sessionId)
    if (!session) return error('NOT_FOUND', '未找到指定学习记录')
    if (session.state !== state) {
      session.state = state
      session.revision += 1
      session.updatedAt = clock.now().toISOString()
      await db.sessions.put(session)
    }
    return { ok: true, value: session }
  } catch {
    return error('STORAGE_FAILED', '本地存储写入失败，请检查设备存储空间')
  }
}

export const pauseSession = (db: GaokaoDatabase, sessionId: string, clock: LearningClock = systemClock) => changeState(db, sessionId, 'paused', clock)
export const resumeSession = (db: GaokaoDatabase, sessionId: string, clock: LearningClock = systemClock) => changeState(db, sessionId, 'active', clock)

// CR1：全部题目提交/跳过后置 completed 并清理该会话残留草稿（草稿不是作答，清掉不丢统计）。
// 幂等：已 completed 不再推进 revision。attempts/exposures 作为统计底账保留，不随会话清理。
export async function completeSession(db: GaokaoDatabase, sessionId: string, clock: LearningClock = systemClock): Promise<Result<Session>> {
  try {
    return await db.transaction('rw', db.sessions, db.drafts, async () => {
      const session = await db.sessions.get(sessionId)
      if (!session) return error('NOT_FOUND', '未找到指定学习记录')
      if (session.state !== 'completed') {
        session.state = 'completed'
        session.revision += 1
        session.updatedAt = clock.now().toISOString()
        await db.sessions.put(session)
        await db.drafts.where('sessionId').equals(sessionId).delete()
      }
      return { ok: true, value: session }
    })
  } catch {
    return error('STORAGE_FAILED', '学习记录更新失败，请稍后再试')
  }
}

const toAttempt = (record: AttemptRecord | undefined): Attempt | undefined => record?.payload as Attempt | undefined

const findInstalledPack = async (db: GaokaoDatabase, ref: { packId: string; packVersion: string }) => {
  const record = await findInstalledRecord(db, ref)
  return record ? packValue(record) : undefined
}

interface SlotContext {
  session: Session
  slot: Slot
  item: Item
  pack: CoursePack
}

const readSlotContext = async (db: GaokaoDatabase, sessionId: string, slotId: string): Promise<Result<SlotContext>> => {
  const session = await db.sessions.get(sessionId)
  if (!session) return error('NOT_FOUND', '未找到指定学习记录')
  const slot = session.slots.find((candidate) => candidate.id === slotId)
  if (!slot) return error('NOT_FOUND', '未找到指定题目')
  const pack = await findInstalledPack(db, slot.ref)
  const item = pack && findItem(pack, slot.ref.itemId)
  if (!pack || !item) return error('CONTENT_MISSING', '课程内容已缺失或版本不符，请重新下载课程包')
  return { ok: true, value: { session, slot, item, pack } }
}

const stale = () => error('STALE_SESSION', '学习记录已在其他页面更新，请刷新后再试')
const asReviewState = (value: unknown): ReviewState | null => {
  if (!value || typeof value !== 'object') return null
  const state = value as Partial<ReviewState>
  if (![0, 1, 2, 3].includes(state.stage as number) || typeof state.dueDay !== 'string' || typeof state.lapses !== 'number') return null
  return { stage: state.stage as ReviewState['stage'], dueDay: state.dueDay, lastAppliedDay: state.lastAppliedDay ?? null, lapses: state.lapses }
}

const writeAttempt = async (db: GaokaoDatabase, attempt: Attempt) => {
  await db.attempts.add({
    id: attempt.id,
    sessionId: attempt.sessionId,
    slotId: attempt.slotId,
    phase: attempt.phase,
    profileId: attempt.profileId,
    familyId: attempt.familyId,
    studyDay: attempt.studyDay,
    createdAt: attempt.createdAt,
    payload: attempt,
  })
}

const firstAttempt = async (db: GaokaoDatabase, sessionId: string, slotId: string) => {
  const record = await db.attempts.where('[sessionId+slotId+phase]').equals([sessionId, slotId, 'first']).first()
  return toAttempt(record)
}

export async function submitAnswer(db: GaokaoDatabase, command: SubmitCommand, clock: LearningClock = systemClock): Promise<Result<Attempt>> {
  try {
    return await db.transaction('rw', [db.sessions, db.attempts, db.reviewStates, db.achievements, db.packs, db.exposures], async () => {
      const replay = toAttempt(await db.attempts.get(command.id))
      if (replay) return { ok: true, value: replay }
      const context = await readSlotContext(db, command.sessionId, command.slotId)
      if (!context.ok) return context
      const { session, slot, item, pack } = context.value
      if (session.revision !== command.expectedRevision) return stale()
      if (await firstAttempt(db, session.id, slot.id)) return error('ALREADY_SUBMITTED', '该题已经提交过首次答案')
      if (item.kind === 'writing') return error('INVALID_CONTENT', '写作题不使用客观题判分器')
      let grade: Grade
      try {
        grade = gradeAnswer(item, command.answer)
      } catch (cause) {
        if (cause instanceof AnswerError) return error('INVALID_ANSWER', cause.message)
        throw cause
      }
      const now = clock.now()
      // T16/R2：per-profile 曝光判定——跨 profile 首答视为独立
      // T16/R2：曝光行主键不含 profileId（Dexie 不支持跨版本改主键），但独立判定按归属放行：
      // 曝光属于其他 profile（row.profileId !== 当前 session.profileId）时，本 profile 首答仍算独立，
      // 与规划/证据侧 per-profile 过滤口径一致；per-profile 曝光行留待多用户版本重建表。
      const exposure = await db.exposures.get([slot.ref.packId, slot.ref.packVersion, slot.ref.itemId])
      const independent = (!exposure || exposure.profileId !== session.profileId || exposure.firstSeenSessionId === session.id) && slot.assistance.length === 0
      const result = grade.earned === grade.possible && grade.possible > 0 && independent ? 'independent-pass' : 'needs-help'
      const previous = await db.reviewStates.get([session.profileId, item.familyId, item.reviewMode])
      const review = scheduleReview(asReviewState(previous?.data), result, session.studyDay)
      const attempt: Attempt = {
        id: command.id,
        sessionId: session.id,
        slotId: slot.id,
        ref: slot.ref,
        familyId: item.familyId,
        phase: 'first',
        profileId: session.profileId,
        answer: command.answer,
        grade,
        assistance: [...slot.assistance],
        replayCount: slot.replayCount,
        audioSpeed: slot.audioSpeed,
        createdAt: now.toISOString(),
        studyDay: session.studyDay,
        revision: session.revision + 1,
      }
      slot.state = 'submitted'
      session.revision += 1
      session.updatedAt = now.toISOString()
      await writeAttempt(db, attempt)
      await db.reviewStates.put({
        profileId: session.profileId,
        familyId: item.familyId,
        reviewMode: item.reviewMode,
        dueDay: review.dueDay,
        updatedAt: now.toISOString(),
        data: review,
      })
      await db.sessions.put(session)
      if (result === 'independent-pass') {
        // 手动单元会话用 session.unitId；今日会话（unitId=null）按条目所属单元解锁（P06 首次任务解锁地图节点）
        const unitId = session.unitId ?? pack.units.find((unit) => unit.itemIds.includes(item.id))?.id ?? null
        if (unitId) {
          const achievementId = `unit:first:${unitId}`
          // put-if-absent：重复独立通过不覆盖首次解锁时间
          const existing = await db.achievements.get(achievementId)
          if (!existing) {
            await db.achievements.put({ id: achievementId, profileId: session.profileId, unlockedAt: now.toISOString(), data: { sessionId: session.id } })
          }
        }
      }
      return { ok: true, value: attempt }
    })
  } catch (cause) {
    return cause instanceof AnswerError ? error('INVALID_ANSWER', cause.message) : error('STORAGE_FAILED', '本地存储写入失败，请检查设备存储空间')
  }
}

export async function correctAnswer(db: GaokaoDatabase, command: SubmitCommand, clock: LearningClock = systemClock): Promise<Result<Attempt>> {
  try {
    return await db.transaction('rw', db.sessions, db.attempts, db.packs, async () => {
      const replay = toAttempt(await db.attempts.get(command.id))
      if (replay) return { ok: true, value: replay }
      const context = await readSlotContext(db, command.sessionId, command.slotId)
      if (!context.ok) return context
      const { session, slot, item } = context.value
      if (session.revision !== command.expectedRevision) return stale()
      if (!(await firstAttempt(db, session.id, slot.id))) return error('NOT_FOUND', '请先提交首次答案，再进行订正')
      if (item.kind === 'writing') return error('INVALID_CONTENT', '写作题不使用客观题判分器')
      let grade: Grade
      try {
        grade = gradeAnswer(item, command.answer)
      } catch (cause) {
        if (cause instanceof AnswerError) return error('INVALID_ANSWER', cause.message)
        throw cause
      }
      const now = clock.now()
      const attempt: Attempt = {
        id: command.id,
        sessionId: session.id,
        slotId: slot.id,
        ref: slot.ref,
        familyId: item.familyId,
        phase: 'correction',
        profileId: session.profileId,
        answer: command.answer,
        grade,
        assistance: [...slot.assistance],
        replayCount: slot.replayCount,
        audioSpeed: slot.audioSpeed,
        createdAt: now.toISOString(),
        studyDay: session.studyDay,
        revision: session.revision + 1,
      }
      slot.state = 'submitted'
      session.revision += 1
      session.updatedAt = now.toISOString()
      await writeAttempt(db, attempt)
      await db.sessions.put(session)
      return { ok: true, value: attempt }
    })
  } catch (cause) {
    return cause instanceof AnswerError ? error('INVALID_ANSWER', cause.message) : error('STORAGE_FAILED', '本地存储写入失败，请检查设备存储空间')
  }
}

export async function revealHint(db: GaokaoDatabase, command: HintCommand, clock: LearningClock = systemClock): Promise<Result<Session>> {
  try {
    return await db.transaction('rw', db.sessions, db.packs, async () => {
      const context = await readSlotContext(db, command.sessionId, command.slotId)
      if (!context.ok) return context
      const { session, slot } = context.value
      if (session.revision !== command.expectedRevision) return stale()
      if (!hintKinds.includes(command.hint as HintKind)) return error('INVALID_ANSWER', '提示类型不在允许范围内')
      if (!slot.assistance.includes(command.hint)) {
        slot.assistance.push(command.hint)
        session.revision += 1
        session.updatedAt = clock.now().toISOString()
        await db.sessions.put(session)
      }
      return { ok: true, value: session }
    })
  } catch {
    return error('STORAGE_FAILED', '提示保存失败，未显示提示内容')
  }
}

export interface ReplayCommand {
  sessionId: string
  slotId: string
  expectedRevision: number
}

export interface AudioSpeedCommand {
  sessionId: string
  slotId: string
  expectedRevision: number
  speed: number
}

export async function recordReplay(db: GaokaoDatabase, command: ReplayCommand, clock: LearningClock = systemClock): Promise<Result<Session>> {
  try {
    return await db.transaction('rw', db.sessions, db.packs, async () => {
      const context = await readSlotContext(db, command.sessionId, command.slotId)
      if (!context.ok) return context
      const { session, slot } = context.value
      if (session.revision !== command.expectedRevision) return stale()
      slot.replayCount += 1
      session.revision += 1
      session.updatedAt = clock.now().toISOString()
      await db.sessions.put(session)
      return { ok: true, value: session }
    })
  } catch {
    return error('STORAGE_FAILED', '回放记录失败')
  }
}

export async function setAudioSpeed(db: GaokaoDatabase, command: AudioSpeedCommand, clock: LearningClock = systemClock): Promise<Result<Session>> {
  try {
    return await db.transaction('rw', db.sessions, db.packs, async () => {
      const context = await readSlotContext(db, command.sessionId, command.slotId)
      if (!context.ok) return context
      const { session, slot } = context.value
      if (session.revision !== command.expectedRevision) return stale()
      if (command.speed !== 0.75 && command.speed !== 1) return error('INVALID_ANSWER', '不支持的播放速度')
      slot.audioSpeed = command.speed
      session.revision += 1
      session.updatedAt = clock.now().toISOString()
      await db.sessions.put(session)
      return { ok: true, value: session }
    })
  } catch {
    return error('STORAGE_FAILED', '播放速度保存失败')
  }
}

export async function skipSlot(db: GaokaoDatabase, command: SessionActionCommand, clock: LearningClock = systemClock): Promise<Result<Session>> {
  try {
    return await db.transaction('rw', db.sessions, db.packs, async () => {
      const context = await readSlotContext(db, command.sessionId, command.slotId)
      if (!context.ok) return context
      const { session, slot } = context.value
      if (session.revision !== command.expectedRevision) return stale()
      if (slot.state !== 'skipped') {
        slot.state = 'skipped'
        session.revision += 1
        session.updatedAt = clock.now().toISOString()
        await db.sessions.put(session)
      }
      return { ok: true, value: session }
    })
  } catch {
    return error('STORAGE_FAILED', '跳过题目失败，请稍后重试')
  }
}