// T15：content:release 门禁核心（纯函数，供 check-content.ts 调用、tests/unit/release-gates.spec.ts 钉住）。
// 原则：机器自检不等于内容审核——review-log 交叉验证不过，正式 catalog 一律不出。
export interface GateItem {
  id: string
  familyId: string
  section: string
  kind: string
  skillIds: string[]
  promptZh: string
}

export interface GatePack {
  id: string
  version: string
  author: string
  items: GateItem[]
}

export interface GateSession {
  index: number
  kind: 'new' | 'recheck'
  timeBudgetMinutes: number
  goalTargetCount: number
  skillIds: string[]
  sectionsAllowed: string[]
}

export interface GateLearningPlan {
  schemaVersion: number
  sessions: GateSession[]
}

export interface ReviewLogRow {
  packId: string
  version: string
  itemId: string
  author: string
  reviewer: string
  reviewedAt: string
  result: string
  notes: string
}

// T15 固定 skillIds 目录（26 个；与 03-implementation-plan T15 清单一一对应，防漂移钉死）
export const RELEASE_SKILL_IDS: string[] = [
  'vocab.context',
  'vocab.collocation',
  'vocab.polysemy',
  'sentence.core',
  'grammar.tense',
  'grammar.agreement',
  'grammar.article',
  'grammar.preposition',
  'grammar.pronoun',
  'grammar.word-form',
  'grammar.infinitive',
  'grammar.clause',
  'grammar.comparison',
  'reading.detail',
  'reading.main-idea',
  'reading.inference',
  'reading.word-meaning',
  'reading.cohesion',
  'cloze.context',
  'cloze.logic',
  'listening.detail',
  'listening.inference',
  'writing.task',
  'writing.organization',
  'writing.coherence',
  'writing.accuracy',
]

// 长文/整段材料 section：不得进入 10 分钟以下的短时任务（P07：长文专项不硬塞进短时任务）
export const LONG_FORM_SECTIONS: string[] = ['reading', 'gap-reading', 'cloze', 'grammar', 'listening', 'application-writing', 'continuation']

const REVIEW_LOG_HEADER = ['packId', 'version', 'itemId', 'author', 'reviewer', 'reviewedAt', 'result', 'notes']

export const checkSkills = (packs: GatePack[], failures: string[]): void => {
  const known = new Set(RELEASE_SKILL_IDS)
  for (const pack of packs) {
    for (const item of pack.items) {
      for (const skillId of item.skillIds) {
        if (!known.has(skillId)) {
          failures.push('T15.skills [UNKNOWN_SKILL] ' + pack.id + '/' + item.id + ' 引用未登记技能 ' + skillId)
        }
      }
    }
  }
}

export const checkParallelStems = (packs: GatePack[], failures: string[]): void => {
  // R5：跨包聚合——同 family 同 section 的题干在全部包范围内唯一
  const stemsByFamily = new Map<string, Map<string, string[]>>()
  for (const pack of packs) {
    for (const item of pack.items) {
      const key = item.familyId + '::' + item.section
      const bySection = stemsByFamily.get(key) ?? new Map<string, string[]>()
      const stems = bySection.get('stems') ?? []
      stems.push(pack.id + ' ' + item.promptZh)
      bySection.set('stems', stems)
      stemsByFamily.set(key, bySection)
    }
  }
  for (const [key, bySection] of stemsByFamily) {
    const [familyId, section] = key.split('::')
    const stems = bySection.get('stems') ?? []
    const seenStem = new Map<string, string>()
    for (const entry of stems) {
      const spaceIndex = entry.indexOf(' ')
      const packId = entry.slice(0, spaceIndex)
      const stem = entry.slice(spaceIndex + 1)
      const firstPack = seenStem.get(stem)
      if (firstPack !== undefined) {
        failures.push('T15.parallel [DUPLICATE_STEM] family ' + familyId + '（' + section + '）题干在 ' + firstPack + ' 与 ' + packId + ' 重复，平行版本必须改写题干而不是交换选项')
        break
      }
      seenStem.set(stem, packId)
    }
  }
}

export const checkLearningPlan = (plan: GateLearningPlan, failures: string[]): void => {
  if (plan.sessions.length !== 30) {
    failures.push('T15.plan [SESSION_COUNT] 30 次学习计划必须恰好 30 段，实际 ' + String(plan.sessions.length))
    return
  }
  let newCount = 0
  let recheckCount = 0
  const known = new Set(RELEASE_SKILL_IDS)
  plan.sessions.forEach((session, position) => {
    if (session.index !== position + 1) {
      failures.push('T15.plan [SESSION_ORDER] 学习段序号必须连续：第 ' + String(position + 1) + ' 段 index=' + String(session.index))
    }
    if (session.kind === 'new') {
      newCount += 1
      if (session.goalTargetCount < 5) {
        failures.push('T15.plan [GOAL_COUNT] 新课第 ' + String(session.index) + ' 段词句目标少于 5 个')
      }
    } else if (session.kind === 'recheck') {
      recheckCount += 1
    } else {
      failures.push('T15.plan [SESSION_KIND] 第 ' + String(session.index) + ' 段 kind 非法')
    }
    for (const skillId of session.skillIds) {
      if (!known.has(skillId)) {
        failures.push('T15.plan [UNKNOWN_SKILL] 第 ' + String(session.index) + ' 段引用未登记技能 ' + skillId)
      }
    }
    for (const section of session.sectionsAllowed) {
      if (LONG_FORM_SECTIONS.includes(section) && session.timeBudgetMinutes < 10) {
        failures.push('T15.plan [LONG_FORM_SHORT_TASK] 第 ' + String(session.index) + ' 段把长文专项 ' + section + ' 塞进 ' + String(session.timeBudgetMinutes) + ' 分钟任务')
      }
    }
  })
  if (newCount !== 24 || recheckCount !== 6) {
    failures.push('T15.plan [MIX] 30 次学习必须 24 新课 + 6 复测，实际 new=' + String(newCount) + ' recheck=' + String(recheckCount))
  }
  const covered = new Set<string>()
  for (const session of plan.sessions) {
    for (const skillId of session.skillIds) covered.add(skillId)
  }
  for (const skillId of RELEASE_SKILL_IDS) {
    if (!covered.has(skillId)) {
      failures.push('T15.plan [SKILL_UNCOVERED] 30 次学习从未引用技能 ' + skillId)
    }
  }
}

export const parseReviewLog = (csv: string): ReviewLogRow[] => {
  const lines = csv.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
  if (lines.length === 0) {
    throw new Error('T15.review-log [EMPTY] review-log.csv 为空文件')
  }
  const header = lines[0].split(',').map((column) => column.trim())
  if (header.join(',') !== REVIEW_LOG_HEADER.join(',')) {
    throw new Error('T15.review-log [HEADER] review-log.csv 表头必须为 ' + REVIEW_LOG_HEADER.join(','))
  }
  return lines.slice(1).map((line) => {
    const columns = line.split(',')
    if (columns.length !== REVIEW_LOG_HEADER.length) {
      throw new Error('T15.review-log [COLUMNS] review-log.csv 行字段数必须为 ' + String(REVIEW_LOG_HEADER.length) + '：' + line)
    }
    return {
      packId: columns[0],
      version: columns[1],
      itemId: columns[2],
      author: columns[3],
      reviewer: columns[4],
      reviewedAt: columns[5],
      result: columns[6],
      notes: columns[7],
    }
  })
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

const normalizeName = (value: string): string => value.trim().toLowerCase()

export const checkReviewLog = (packs: GatePack[], rows: ReviewLogRow[], failures: string[]): void => {
  for (const pack of packs) {
    for (const item of pack.items) {
      const matches = rows.filter((candidate) => candidate.packId === pack.id && candidate.version === pack.version && candidate.itemId === item.id)
      if (matches.length === 0) {
        failures.push('T15.review [REVIEW_MISSING] ' + pack.id + '@' + pack.version + '/' + item.id + ' 缺少独立审核通过记录（机器自检不能替代审核）')
        continue
      }
      // B2：任一 fail 记录即拦截——复审不通过不能被更早的 pass 掩盖
      const rejected = matches.find((candidate) => candidate.result !== 'pass')
      if (rejected !== undefined) {
        failures.push('T15.review [REVIEW_NOT_PASS] ' + pack.id + '@' + pack.version + '/' + item.id + ' 存在 result=' + rejected.result + ' 的审核记录')
        continue
      }
      for (const row of matches) {
        // B1：trim + 大小写折叠——空白与大小写变化不能伪装成第二审核人
        if (normalizeName(row.reviewer).length === 0 || normalizeName(row.reviewer) === normalizeName(pack.author)) {
          failures.push('T15.review [REVIEWER_INVALID] ' + pack.id + '@' + pack.version + '/' + item.id + ' 审核人缺失或与作者相同')
          break
        }
        if (normalizeName(row.author).length === 0 || normalizeName(row.author) !== normalizeName(pack.author)) {
          failures.push('T15.review [AUTHOR_MISMATCH] ' + pack.id + '@' + pack.version + '/' + item.id + ' 记录作者与包作者不一致')
          break
        }
        // B3：ISO 日期时间 + 不允许未来时间（与 validate.ts 的 release 口径一致）
        if (!ISO_DATETIME.test(row.reviewedAt) || Number.isNaN(Date.parse(row.reviewedAt)) || Date.parse(row.reviewedAt) > Date.now() + 60_000) {
          failures.push('T15.review [REVIEWED_AT_INVALID] ' + pack.id + '@' + pack.version + '/' + item.id + ' reviewedAt 必须为过去的有效 ISO 日期时间')
          break
        }
      }
    }
  }
}

export interface ReleaseContentInput {
  packs: GatePack[]
  skills: string[]
  plan: GateLearningPlan
  reviewLogCsv: string
}

export const checkReleaseContent = (input: ReleaseContentInput): string[] => {
  const failures: string[] = []
  const known = new Set(RELEASE_SKILL_IDS)
  for (const skillId of input.skills) {
    if (!known.has(skillId)) {
      failures.push('T15.skills [CATALOG_DRIFT] skills.json 含固定目录之外的技能 ' + skillId)
    }
  }
  for (const skillId of RELEASE_SKILL_IDS) {
    if (!input.skills.includes(skillId)) {
      failures.push('T15.skills [CATALOG_MISSING] skills.json 缺固定技能 ' + skillId)
    }
  }
  checkSkills(input.packs, failures)
  checkParallelStems(input.packs, failures)
  checkLearningPlan(input.plan, failures)
  const rows = parseReviewLog(input.reviewLogCsv)
  checkReviewLog(input.packs, rows, failures)
  return failures
}