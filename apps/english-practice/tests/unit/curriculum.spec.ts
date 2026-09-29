import { describe, expect, it } from 'vitest'
import { curriculumAliasIssues, curriculumForUnit, sectionTitle, threeYearCurriculum } from '../../src/domain/curriculum'

describe('高中三年课程目录', () => {
  it('覆盖高一、高二、高三和全部高考训练栏目', () => {
    expect(threeYearCurriculum.years.map((year) => year.titleZh)).toEqual(['高一基础', '高二强化', '高三冲刺'])
    expect(threeYearCurriculum.sections).toHaveLength(9)
    expect(new Set(threeYearCurriculum.years.flatMap((year) => year.units.flatMap((unit) => unit.sections))).size).toBe(9)
  })

  it('每个学习单元都有目标、技能和透明审核状态', () => {
    for (const year of threeYearCurriculum.years) {
      expect(year.subtitleZh).not.toBe('')
      for (const unit of year.units) {
        expect(unit.targetZh).not.toBe('')
        expect(unit.skills.length).toBeGreaterThan(0)
        expect(unit.status).toBe('draft')
        expect(unit.itemCount).toBeGreaterThan(0)
      }
    }
  })

  it('按单元 ID 返回学生可读的年级信息', () => {
    const match = curriculumForUnit('h1-grammar')
    expect(match?.year.titleZh).toBe('高一基础')
    expect(match?.unit.titleZh).toBe('时态与主谓一致')
    expect(sectionTitle('gap-reading')).toBe('七选五')
    expect(curriculumForUnit('h1-core')?.year.titleZh).toBe('高一基础')
  })

  it('别名表目标单元真实存在，未映射单元返回 null 而不是抛错', () => {
    expect(curriculumAliasIssues()).toEqual([])
    expect(curriculumForUnit('anhui-gaokao-2013-cloze-a')).toBeNull()
  })
})
