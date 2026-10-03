import rawCurriculum from '../../content/curriculum/gaokao-three-years.json'
import { curriculumSchema } from '../content/schema'
import type { Level, Section } from '../content/types'

export interface CurriculumSection {
  id: Section
  titleZh: string
  goalZh: string
}

export interface CurriculumUnit {
  id: string
  titleZh: string
  sections: Section[]
  skills: string[]
  targetZh: string
  status: 'draft' | 'reviewed' | 'published'
  itemCount: number
}

export interface CurriculumYear {
  id: string
  titleZh: string
  subtitleZh: string
  level: Level
  units: CurriculumUnit[]
}

export interface ThreeYearCurriculum {
  version: number
  titleZh: string
  sections: CurriculumSection[]
  years: CurriculumYear[]
}

// 运行时校验：大纲 JSON 损坏或字段漂移时在模块加载即失败，而不是渲染出空白路线图
export const threeYearCurriculum = curriculumSchema.parse(rawCurriculum) as ThreeYearCurriculum

const unitIndex = new Map(
  threeYearCurriculum.years.flatMap((year) => year.units.map((unit) => [unit.id, { year, unit }] as const)),
)
// pack 单元号 → 课程大纲单元号。pack 可以有独立于大纲的单元（真题卷按年份/题型拆分），
// 此表只负责「想挂到大纲上的 pack 单元」的映射，目标必须真实存在（curriculumAliasIssues 校验）。
export const packUnitAliases: Record<string, string> = {
  'h1-core': 'h1-grammar',
  'h2-core': 'h2-grammar',
  'h3-core': 'h3-reading',
}

export const curriculumForUnit = (unitId: string): { year: CurriculumYear; unit: CurriculumUnit } | null =>
  unitIndex.get(unitId) ?? unitIndex.get(packUnitAliases[unitId] ?? '') ?? null

export const sectionTitle = (section: Section): string =>
  threeYearCurriculum.sections.find((entry) => entry.id === section)?.titleZh ?? section

// check-content 用：别名表指向的课程单元必须真实存在，防止改名后静默失配（页面表现为「课程找不到」）
export const curriculumAliasIssues = (): string[] =>
  Object.entries(packUnitAliases)
    .filter(([, target]) => !unitIndex.has(target))
    .map(([source, target]) => `别名 ${source} 指向不存在的课程单元：${target}`)
