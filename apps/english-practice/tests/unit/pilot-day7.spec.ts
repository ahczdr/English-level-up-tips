import { describe, expect, it } from 'vitest'
import { collectExposedItemIds, selectUnseenParallel } from '../../src/services/pilot-day7'
import type { Item } from '../../src/content/types'

const item = (id: string, familyId: string, level: 'G0' | 'G1' | 'G2', skillIds: string[]): Item =>
  ({ id, familyId, level, skillIds, kind: 'choice', section: 'cloze', reviewMode: 'recog', promptZh: '', resourceId: null, estimatedSeconds: 60, sourceIds: [], explanation: { summaryZh: '', ruleZh: '', evidence: [], distractors: [] }, options: [], answerOptionId: 'a' } as unknown as Item)

describe('T17 第7天平行题抽取', () => {
  it('同 family 同 level 的未曝光题入选；已曝光题被排除', () => {
    const items = [item('i1', 'f1', 'G0', ['s-vocab']), item('i2', 'f1', 'G0', ['s-vocab']), item('i3', 'f1', 'G1', ['s-vocab'])]
    const picked = selectUnseenParallel({ items, exposedIds: ['i1'], familyIds: ['f1'], skillId: 's-vocab', level: 'G0', count: 1 })
    expect(picked.map((p) => p.id)).toEqual(['i2'])
  })

  it('跨包 item 聚合；familyId 未练过的不作为平行题来源', () => {
    const items = [item('a1', 'fX', 'G0', ['s-listen']), item('a2', 'fY', 'G0', ['s-listen'])]
    const picked = selectUnseenParallel({ items, exposedIds: [], familyIds: ['fX'], skillId: 's-listen', level: 'G0', count: 2 })
    expect(picked.map((p) => p.id)).toEqual(['a1'])
  })

  it('level 或 skill 不匹配的未曝光题不入选', () => {
    const items = [item('b1', 'f1', 'G2', ['s-vocab']), item('b2', 'f1', 'G0', ['s-grammar'])]
    const picked = selectUnseenParallel({ items, exposedIds: [], familyIds: ['f1'], skillId: 's-vocab', level: 'G0', count: 3 })
    expect(picked).toEqual([])
  })

  it('count 截断且保持输入顺序稳定（不引入随机，报告可复现）', () => {
    const items = [item('c1', 'f1', 'G0', ['s-x']), item('c2', 'f1', 'G0', ['s-x']), item('c3', 'f1', 'G0', ['s-x'])]
    const picked = selectUnseenParallel({ items, exposedIds: ['c1'], familyIds: ['f1'], skillId: 's-x', level: 'G0', count: 1 })
    expect(picked.map((p) => p.id)).toEqual(['c2'])
  })

  it('collectExposedItemIds：从 backup exposures 表按 profile 聚合已曝光 itemId', () => {
    const exposures = [
      { packId: 'p1', packVersion: '1', itemId: 'i1', familyId: 'f1', profileId: 'pa', firstSeenAt: '', studyDay: '', firstSeenSessionId: 's' },
      { packId: 'p1', packVersion: '1', itemId: 'i2', familyId: 'f1', profileId: 'pb', firstSeenAt: '', studyDay: '', firstSeenSessionId: 's' },
      { packId: 'p1', packVersion: '1', itemId: 'i3', familyId: 'f1', profileId: 'pa', firstSeenAt: '', studyDay: '', firstSeenSessionId: 's' },
    ]
    expect(collectExposedItemIds({ exposures, profileId: 'pa' })).toEqual(['i1', 'i3'])
  })
})
