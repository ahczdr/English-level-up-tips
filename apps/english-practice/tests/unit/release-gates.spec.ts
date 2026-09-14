import { describe, expect, it } from 'vitest'
import {
  checkLearningPlan,
  checkParallelStems,
  checkReleaseContent,
  checkReviewLog,
  checkSkills,
  parseReviewLog,
  RELEASE_SKILL_IDS,
} from '../../scripts/release-gates'
import type { GateItem, GatePack } from '../../scripts/release-gates'

// T15：content:release 门禁核心（skills 固定目录 / 平行题干 / 30 次学习计划 / review-log 交叉验证 / 对抗性伪造向量）

const item = (overrides: Partial<GateItem> = {}): GateItem => ({
  id: 'item-1',
  familyId: 'fam-1',
  section: 'vocabulary',
  kind: 'choice',
  skillIds: ['vocab.context'],
  promptZh: '题干 A',
  ...overrides,
})

const pack = (items: GateItem[], overrides: Partial<GatePack> = {}): GatePack => ({
  id: 'gaokao-demo',
  version: '1.0.0',
  author: '作者甲',
  items,
  ...overrides,
})

const validPlan = () => ({
  schemaVersion: 1,
  sessions: Array.from({ length: 30 }, (_, i) => {
    const index = i + 1
    const isRecheck = index % 5 === 0
    return {
      index,
      kind: isRecheck ? ('recheck' as const) : ('new' as const),
      timeBudgetMinutes: 10,
      goalTargetCount: isRecheck ? 0 : 5,
      skillIds: ['vocab.context'],
      sectionsAllowed: ['vocabulary'],
    }
  }),
})

const fullPlan = () => {
  const plan = validPlan()
  // 26 技能全覆盖：新课段依次引用全部技能
  const all = [...RELEASE_SKILL_IDS]
  plan.sessions.forEach((session, i) => {
    if (session.kind === 'new') {
      session.skillIds = [all[i % all.length], all[(i + 1) % all.length]]
    }
  })
  return plan
}

describe('T15 固定 skillIds 目录', () => {
  it('固定目录为 26 个技能且与 T15 清单一致', () => {
    expect(RELEASE_SKILL_IDS).toHaveLength(26)
    expect(RELEASE_SKILL_IDS).toContain('grammar.tense')
    expect(RELEASE_SKILL_IDS).toContain('writing.accuracy')
  })

  it('题目引用未登记技能 → 失败；全部已登记 → 通过', () => {
    const bad: string[] = []
    checkSkills([pack([item({ skillIds: ['grammar.nonexistent'] })])], bad)
    expect(bad.join('\n')).toContain('T15.skills')
    const good: string[] = []
    checkSkills([pack([item(), item({ skillIds: ['cloze.logic'] })])], good)
    expect(good).toEqual([])
  })
})

describe('T15 平行版本（不同题干）', () => {
  it('同 family 重复题干 → 失败；不同题干 → 通过', () => {
    const dup: string[] = []
    checkParallelStems([pack([item({ promptZh: '同一句' }), item({ id: 'i2', promptZh: '同一句' })])], dup)
    expect(dup.join('\n')).toContain('T15.parallel')
    const ok: string[] = []
    checkParallelStems([pack([item({ promptZh: '题干 A' }), item({ id: 'i2', promptZh: '题干 B' })])], ok)
    expect(ok).toEqual([])
  })

  it('R5：跨包重复题干 → 拦截', () => {
    const failures: string[] = []
    checkParallelStems([
      pack([item({ promptZh: '同一句' })]),
      pack([item({ promptZh: '同一句' })], { id: 'gaokao-other' }),
    ], failures)
    expect(failures.join('\n')).toContain('T15.parallel')
  })
})

describe('T15 30 次学习计划', () => {
  it('次数结构错误 / 新课目标不足 / 长文塞进短任务 → 失败', () => {
    const short = validPlan()
    short.sessions = short.sessions.slice(0, 28)
    const f1: string[] = []
    checkLearningPlan(short, f1)
    expect(f1.join('\n')).toContain('[SESSION_COUNT]')

    const lowGoal = validPlan()
    lowGoal.sessions[0] = { ...lowGoal.sessions[0], goalTargetCount: 3 }
    const f2: string[] = []
    checkLearningPlan(lowGoal, f2)
    expect(f2.join('\n')).toContain('[GOAL_COUNT]')

    const longForm = validPlan()
    longForm.sessions[0] = { ...longForm.sessions[0], timeBudgetMinutes: 5, sectionsAllowed: ['cloze'] }
    const f3: string[] = []
    checkLearningPlan(longForm, f3)
    expect(f3.join('\n')).toContain('[LONG_FORM_SHORT_TASK]')
  })

  it('缺口：MIX 计数 / 序号断裂 / R4 技能覆盖不足', () => {
    const mixed = validPlan()
    mixed.sessions[4].kind = 'new'
    const f1: string[] = []
    checkLearningPlan(mixed, f1)
    expect(f1.join('\n')).toContain('[MIX]')

    const broken = validPlan()
    broken.sessions[6].index = 99
    const f2: string[] = []
    checkLearningPlan(broken, f2)
    expect(f2.join('\n')).toContain('[SESSION_ORDER]')

    const uncovered = validPlan()
    for (const session of uncovered.sessions) {
      session.skillIds = ['vocab.context']
    }
    const f3: string[] = []
    checkLearningPlan(uncovered, f3)
    expect(f3.join('\n')).toContain('[SKILL_UNCOVERED]')
  })

  it('合法 24 新课 + 6 复测且 26 技能全覆盖 → 通过', () => {
    const ok: string[] = []
    checkLearningPlan(fullPlan(), ok)
    expect(ok).toEqual([])
  })
})

describe('T15 review-log 交叉验证', () => {
  it('CSV 解析：表头错 / 行字段数不足 → 抛错', () => {
    expect(() => parseReviewLog('packId,version,itemId\ngaokao-demo,1.0.0')).toThrow()
    expect(() => parseReviewLog('packId,version,itemId,author,reviewer,reviewedAt,result,notes\ngaokao-demo,1.0.0,item-1,作者甲')).toThrow()
  })

  it('缺少审核记录 / 审核人等于作者 → 失败；有效通过记录 → 通过', () => {
    const packs = [pack([item()], { author: '作者甲' })]
    const missing: string[] = []
    checkReviewLog(packs, [], missing)
    expect(missing.join('\n')).toContain('REVIEW_MISSING')

    const self: string[] = []
    const rows = parseReviewLog('packId,version,itemId,author,reviewer,reviewedAt,result,notes\ngaokao-demo,1.0.0,item-1,作者甲,作者甲,2026-09-12T10:00:00Z,pass,')
    checkReviewLog(packs, rows, self)
    expect(self.join('\n')).toContain('REVIEWER_INVALID')

    const ok: string[] = []
    const rows2 = parseReviewLog('packId,version,itemId,author,reviewer,reviewedAt,result,notes\ngaokao-demo,1.0.0,item-1,作者甲,审核乙,2026-09-12T10:00:00Z,pass,')
    checkReviewLog(packs, rows2, ok)
    expect(ok).toEqual([])
  })
})

describe('T15 评审对抗性（B1-B3 钉死）', () => {
  it('B1：reviewer 空白/大小写伪装第二审核人 → 必须拦截', () => {
    for (const reviewer of ['GLM-DEV', ' glm-dev ', '　', '']) {
      const csv = 'packId,version,itemId,author,reviewer,reviewedAt,result,notes\ngaokao-demo,1.0.0,item-1,glm-dev,' + reviewer + ',2026-09-12T10:00:00Z,pass,'
      const failures: string[] = []
      checkReviewLog([pack([item()], { author: 'glm-dev' })], parseReviewLog(csv), failures)
      expect(failures.join('\n')).toContain('T15.review')
    }
  })

  it('B2：任一 fail 记录即拦截（pass-在前-fail-在后不许放行）', () => {
    const csv = 'packId,version,itemId,author,reviewer,reviewedAt,result,notes\n' + [
      'gaokao-demo,1.0.0,item-1,作者甲,审核乙,2026-09-12T10:00:00Z,pass,',
      'gaokao-demo,1.0.0,item-1,作者甲,审核乙,2026-09-13T10:00:00Z,fail,复审不通过',
    ].join('\n')
    const failures: string[] = []
    checkReviewLog([pack([item()])], parseReviewLog(csv), failures)
    expect(failures.join('\n')).toContain('REVIEW_NOT_PASS')
  })

  it('B3：reviewedAt 未来时间 / date-only → 必须拦截', () => {
    for (const reviewedAt of ['2099-01-01T00:00:00Z', '2026-09-12']) {
      const csv = 'packId,version,itemId,author,reviewer,reviewedAt,result,notes\ngaokao-demo,1.0.0,item-1,作者甲,审核乙,' + reviewedAt + ',pass,'
      const failures: string[] = []
      checkReviewLog([pack([item()])], parseReviewLog(csv), failures)
      expect(failures.join('\n')).toContain('T15.review')
    }
  })

  it('缺口：目录漂移 → CATALOG_DRIFT / CATALOG_MISSING', () => {
    const f1 = checkReleaseContent({
      packs: [pack([item()])],
      skills: ['vocab.context', 'not.in.catalog'],
      plan: fullPlan(),
      reviewLogCsv: 'packId,version,itemId,author,reviewer,reviewedAt,result,notes\n',
    })
    expect(f1.join('\n')).toContain('CATALOG_DRIFT')
    const f2 = checkReleaseContent({
      packs: [pack([item()])],
      skills: ['vocab.context'],
      plan: fullPlan(),
      reviewLogCsv: 'packId,version,itemId,author,reviewer,reviewedAt,result,notes\n',
    })
    expect(f2.join('\n')).toContain('CATALOG_MISSING')
  })
})

describe('T15 汇总门禁', () => {
  it('全要素齐备且无审核时，汇总门禁必须拦下（不能把机器自检当审核）', () => {
    const failures = checkReleaseContent({
      packs: [pack([item(), item({ id: 'i2', promptZh: '题干 B' })])],
      skills: [...RELEASE_SKILL_IDS],
      plan: fullPlan(),
      reviewLogCsv: 'packId,version,itemId,author,reviewer,reviewedAt,result,notes\n',
    })
    expect(failures.some((line) => line.includes('T15.review'))).toBe(true)
  })

  it('审核记录齐备 → 零失败', () => {
    const failures = checkReleaseContent({
      packs: [pack([item(), item({ id: 'i2', promptZh: '题干 B' })], { author: '作者甲' })],
      skills: [...RELEASE_SKILL_IDS],
      plan: fullPlan(),
      reviewLogCsv: 'packId,version,itemId,author,reviewer,reviewedAt,result,notes\ngaokao-demo,1.0.0,item-1,作者甲,审核乙,2026-09-12T10:00:00Z,pass,\ngaokao-demo,1.0.0,i2,作者甲,审核乙,2026-09-12T10:00:00Z,pass,',
    })
    expect(failures).toEqual([])
  })
})
