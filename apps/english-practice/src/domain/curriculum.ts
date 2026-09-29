import rawCurriculum from '../../content/curriculum/gaokao-three-years.json'
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

export const threeYearCurriculum = rawCurriculum as ThreeYearCurriculum

const unitIndex = new Map(
  threeYearCurriculum.years.flatMap((year) => year.units.map((unit) => [unit.id, { year, unit }] as const)),
)
const packUnitAliases: Record<string, string> = {
  'h1-core': 'h1-grammar',
  'h2-core': 'h2-grammar',
  'h3-core': 'h3-reading',
}

export const curriculumForUnit = (unitId: string): { year: CurriculumYear; unit: CurriculumUnit } | null =>
  unitIndex.get(unitId) ?? unitIndex.get(packUnitAliases[unitId] ?? '') ?? null

export const sectionTitle = (section: Section): string =>
  threeYearCurriculum.sections.find((entry) => entry.id === section)?.titleZh ?? section
