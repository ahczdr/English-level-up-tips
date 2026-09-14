export type Level = 'G0' | 'G1' | 'G2'

export type Section =
  | 'vocabulary'
  | 'sentence'
  | 'reading'
  | 'gap-reading'
  | 'cloze'
  | 'grammar'
  | 'listening'
  | 'application-writing'
  | 'continuation'

export type Status = 'draft' | 'reviewed' | 'published'

export type ReviewMode = 'recognition' | 'recall' | 'transfer'

export interface Option {
  id: string
  text: string
}

export type SourceKind = 'original' | 'licensed' | 'official-reference'

export interface Source {
  id: string
  kind: SourceKind
  title: string
  url: string | null
  rightsNote: string
}

export interface Paragraph {
  id: string
  text: string
}

export interface Resource {
  id: string
  paragraphs: Paragraph[]
  audioAssetId: string | null
  transcript: string | null
}

export type AssetMime = 'audio/mpeg' | 'audio/mp4' | 'image/webp'

export interface Asset {
  id: string
  path: string
  mime: AssetMime
  bytes: number
  sha256: string
}

export interface Evidence {
  resourceId: string
  paragraphId: string
  quote: string
}

export interface Distractor {
  optionId: string
  reasonZh: string
}

export interface Explanation {
  summaryZh: string
  ruleZh: string
  evidence: Evidence[]
  distractors: Distractor[]
}

export interface CommonItem {
  id: string
  familyId: string
  skillIds: string[]
  level: Level
  section: Section
  reviewMode: ReviewMode
  promptZh: string
  resourceId: string | null
  estimatedSeconds: number
  sourceIds: string[]
  explanation: Explanation
}

export interface ChoiceItem extends CommonItem {
  kind: 'choice'
  options: Option[]
  answerOptionId: string
}

export interface OrderItem extends CommonItem {
  kind: 'order'
  tokens: Option[]
  acceptedOrders: string[][]
}

export interface TextPolicy {
  caseSensitive: boolean
  allowTerminalPunctuation: boolean
}

export interface Gap {
  id: string
  label: string
  clue: string | null
  options: Option[]
  accepted: string[]
  explanationZh: string
}

export type GapSegment =
  | { type: 'text'; text: string }
  | { type: 'gap'; gapId: string }

export interface GapsItem extends CommonItem {
  kind: 'gaps'
  inputMode: 'text' | 'options'
  sharedOptions: Option[]
  uniqueOptions: boolean
  segments: GapSegment[]
  gaps: Gap[]
  policy: TextPolicy
}

export interface WritingItem extends CommonItem {
  kind: 'writing'
  wordRange: [number, number]
  requirementsZh: string[]
  openingSentences: string[]
  checklistZh: string[]
  modelAnswer: string
}

export type Item = ChoiceItem | OrderItem | GapsItem | WritingItem

export interface Unit {
  id: string
  titleZh: string
  familyIds: string[]
  itemIds: string[]
  prerequisiteSkillIds: string[]
}

export interface CoursePack {
  schemaVersion: 1
  id: string
  version: string
  titleZh: string
  status: Status
  author: string
  reviewer: string | null
  reviewedAt: string | null
  profileIds: string[]
  sources: Source[]
  assets: Asset[]
  resources: Resource[]
  items: Item[]
  units: Unit[]
}

export interface ScoringSection {
  section: Section
  maxScore: number
  itemCount: number
}

export interface Scoring {
  total: number
  sections: ScoringSection[]
}

export interface ExamProfile {
  id: string
  nameZh: string
  region: string | null
  examYear: number | null
  verified: boolean
  sourceUrls: string[]
  checkedAt: string | null
  enabledSections: Section[]
  allowMockExam: boolean
  scoring: null | Scoring
}
