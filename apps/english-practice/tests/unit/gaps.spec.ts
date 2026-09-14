import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { AnswerError, gradeAnswer } from '../../src/domain/answers'
import { createSession, enterCurrentSlot, submitAnswer } from '../../src/services/learning'
import GapTask from '../../src/features/practice/GapTask.vue'
import samplePack from '../fixtures/sample-pack.json'
import type { Answer } from '../../src/domain/answers'
import type { CoursePack, GapsItem } from '../../src/content/types'
import { createDatabase, deleteDatabase, type GaokaoDatabase } from '../../src/data/db'

const pack = samplePack as unknown as CoursePack
const sevenGaps = pack.items.find((item) => item.id === 'gap-reading-plan-a') as GapsItem

const wrappers: VueWrapper[] = []
const databases: GaokaoDatabase[] = []

afterEach(async () => {
  while (wrappers.length > 0) wrappers.pop()!.unmount()
  while (databases.length > 0) await deleteDatabase(databases.pop()!)
})

const mountTask = (item: GapsItem) => {
  const wrapper = mount(GapTask, {
    props: {
      item,
      modelValue: null,
      'onUpdate:modelValue': (value: Answer | null) => {
        void wrapper.setProps({ modelValue: value })
      },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

const setupGapsSession = async () => {
  const custom = structuredClone(pack)
  custom.units = [{
    ...custom.units[0],
    id: 'unit-gaps-five',
    itemIds: ['gap-reading-plan-a'],
    familyIds: ['reading-learning-plan'],
  }]
  const db = createDatabase(`gaokao-gaps-${crypto.randomUUID()}`)
  await db.open()
  await db.packs.add({ id: custom.id, version: custom.version, status: 'installed', pack: custom, installedAt: new Date().toISOString(), resourcesReady: true })
  databases.push(db)
  const created = await createSession({ db, unitId: 'unit-gaps-five', minutes: 10, profileId: 'gaokao-common-training-v1', idGenerator: () => 'gap-1' })
  if (!created.ok || created.value.kind !== 'session') throw new Error('expected session')
  const entered = await enterCurrentSlot(db, 'gap-1')
  if (!entered.ok) throw new Error('expected enter')
  return db
}

describe('T06 七选五判分', () => {
  it('依次给 a/b/c/d/e 得 5/5，每空 1 分', () => {
    const grade = gradeAnswer(sevenGaps, { kind: 'gaps', values: { g1: 'a', g2: 'b', g3: 'c', g4: 'd', g5: 'e' } })
    expect(grade.earned).toBe(5)
    expect(grade.possible).toBe(5)
    expect(grade.perGap).toEqual({ g1: true, g2: true, g3: true, g4: true, g5: true })
  })

  it('一个错误一个空白得 3/5，空白按 0 分计', () => {
    const grade = gradeAnswer(sevenGaps, { kind: 'gaps', values: { g1: 'a', g2: 'f', g3: 'c', g4: 'd' } })
    expect(grade.earned).toBe(3)
    expect(grade.possible).toBe(5)
    expect(grade.perGap.g1).toBe(true)
    expect(grade.perGap.g2).toBe(false)
    expect(grade.perGap.g3).toBe(true)
    expect(grade.perGap.g4).toBe(true)
    expect(grade.perGap.g5).toBe(false)
  })

  it('非法重复 a 不接受提交（判题器拒绝）', () => {
    expect(() =>
      gradeAnswer(sevenGaps, { kind: 'gaps', values: { g1: 'a', g2: 'a', g3: 'c', g4: 'd', g5: 'e' } }),
    ).toThrow(AnswerError)
  })
})

describe('T06 七选五提交', () => {
  it('submitAnswer 对重复占用选项返回 INVALID_ANSWER', async () => {
    const db = await setupGapsSession()
    const result = await submitAnswer(db, {
      id: 'cmd-dup',
      sessionId: 'gap-1',
      slotId: 'gap-1:0',
      expectedRevision: 1,
      answer: { kind: 'gaps', values: { g1: 'a', g2: 'a', g3: 'c', g4: 'd', g5: 'e' } },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_ANSWER')
    expect(await db.attempts.count()).toBe(0)
  })

  it('合法完整 answer map 一次提交通过', async () => {
    const db = await setupGapsSession()
    const result = await submitAnswer(db, {
      id: 'cmd-full',
      sessionId: 'gap-1',
      slotId: 'gap-1:0',
      expectedRevision: 1,
      answer: { kind: 'gaps', values: { g1: 'a', g2: 'b', g3: 'c', g4: 'd', g5: 'e' } },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.grade.earned).toBe(5)
      expect(result.value.grade.possible).toBe(5)
    }
  })
})

describe('T06 七选五占用移动', () => {
  it('已占用选项显示所在空，点击提供移动确认且不产生重复占用', async () => {
    const wrapper = mountTask(sevenGaps)
    await wrapper.findAll('.gap-slot')[0].trigger('click')
    await wrapper.findAll('.gap-option')[0].trigger('click')
    await wrapper.findAll('.gap-slot')[1].trigger('click')
    const used = wrapper.findAll('.gap-option').find((option) => option.text().includes('Start with a small task.'))
    expect(used).toBeTruthy()
    expect(used!.text()).toContain('已用于第 1 空')
    expect(used!.attributes('disabled')).toBeUndefined()
    await used!.trigger('click')
    const confirmBox = wrapper.get('.gap-move-confirm')
    expect(confirmBox.text()).toContain('把「Start with a small task.」从第 1 空移动到第 2 空？')
    await click(wrapper, '确认移动')
    const emitted = wrapper.emitted('update:modelValue') as Array<[Answer | null]>
    expect(emitted[emitted.length - 1][0]).toEqual({ kind: 'gaps', values: { g2: 'a' } })
    // 移动后第 1 空不再占用 a，无重复占用
    const values = (emitted[emitted.length - 1][0] as Extract<Answer, { kind: 'gaps' }>).values
    expect(values.g1).toBeUndefined()
  })

  it('取消移动不改变答案', async () => {
    const wrapper = mountTask(sevenGaps)
    await wrapper.findAll('.gap-slot')[0].trigger('click')
    await wrapper.findAll('.gap-option')[0].trigger('click')
    await wrapper.findAll('.gap-slot')[1].trigger('click')
    const used = wrapper.findAll('.gap-option').find((option) => option.text().includes('Start with a small task.'))
    await used!.trigger('click')
    await click(wrapper, '取消')
    const emitted = wrapper.emitted('update:modelValue') as Array<[Answer | null]>
    expect(emitted[emitted.length - 1][0]).toEqual({ kind: 'gaps', values: { g1: 'a' } })
    // 确认框关闭，指针仍停在原空的选择状态
    expect(wrapper.find('.gap-move-confirm').exists()).toBe(false)
  })

  it('替换与清空仍然可用', async () => {
    const wrapper = mountTask(sevenGaps)
    await wrapper.findAll('.gap-slot')[0].trigger('click')
    await wrapper.findAll('.gap-option')[0].trigger('click')
    // 替换：同空选择未占用的其他选项
    await wrapper.findAll('.gap-slot')[0].trigger('click')
    const other = wrapper.findAll('.gap-option').find((option) => option.text().includes('Find a quiet place.'))
    await other!.trigger('click')
    const emitted = wrapper.emitted('update:modelValue') as Array<[Answer | null]>
    expect(emitted[emitted.length - 1][0]).toEqual({ kind: 'gaps', values: { g1: 'b' } })
    // 清空当前空
    await wrapper.get('.gap-clear').trigger('click')
    const after = wrapper.emitted('update:modelValue') as Array<[Answer | null]>
    expect(after[after.length - 1][0]).toEqual({ kind: 'gaps', values: {} })
  })
})

const click = async (wrapper: VueWrapper, text: string) => {
  const button = wrapper.findAll('button').find((candidate) => candidate.text() === text)
  if (!button) throw new Error(`未找到按钮：${text}`)
  await button.trigger('click')
}
