import { z } from 'zod'

export const idSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/)
export const semverSchema = z.string().regex(/^\d+\.\d+\.\d+$/)
const levelSchema = z.enum(['G0', 'G1', 'G2'])
const sectionSchema = z.enum([
  'vocabulary',
  'sentence',
  'reading',
  'gap-reading',
  'cloze',
  'grammar',
  'listening',
  'application-writing',
  'continuation',
])
const statusSchema = z.enum(['draft', 'reviewed', 'published'])
const reviewModeSchema = z.enum(['recognition', 'recall', 'transfer'])

export const optionSchema = z.strictObject({
  id: idSchema,
  text: z.string().min(1),
})

export const sourceSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(['original', 'licensed', 'official-reference']),
  title: z.string().min(1),
  url: z.string().url().nullable(),
  rightsNote: z.string().min(1),
})

export const resourceSchema = z.strictObject({
  id: idSchema,
  paragraphs: z.array(z.strictObject({ id: idSchema, text: z.string().min(1) })),
  audioAssetId: idSchema.nullable(),
  transcript: z.string().nullable(),
})

export const assetSchema = z.strictObject({
  id: idSchema,
  path: z.string().min(1),
  mime: z.enum(['audio/mpeg', 'audio/mp4', 'image/webp']),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
})

export const explanationSchema = z.strictObject({
  summaryZh: z.string().min(1),
  ruleZh: z.string().min(1),
  evidence: z.array(z.strictObject({
    resourceId: idSchema,
    paragraphId: idSchema,
    quote: z.string().min(1),
  })),
  distractors: z.array(z.strictObject({
    optionId: idSchema,
    reasonZh: z.string().min(1),
  })),
})

const commonItemFields = {
  id: idSchema,
  familyId: idSchema,
  skillIds: z.array(idSchema),
  level: levelSchema,
  section: sectionSchema,
  reviewMode: reviewModeSchema,
  promptZh: z.string().min(1),
  resourceId: idSchema.nullable(),
  estimatedSeconds: z.number().int().positive(),
  sourceIds: z.array(idSchema),
  explanation: explanationSchema,
}

export const choiceItemSchema = z.strictObject({
  ...commonItemFields,
  kind: z.literal('choice'),
  options: z.array(optionSchema).min(2).max(7),
  answerOptionId: idSchema,
})

export const orderItemSchema = z.strictObject({
  ...commonItemFields,
  kind: z.literal('order'),
  tokens: z.array(optionSchema).min(2),
  acceptedOrders: z.array(z.array(idSchema).min(1)).min(1),
})

export const textPolicySchema = z.strictObject({
  caseSensitive: z.boolean(),
  allowTerminalPunctuation: z.boolean(),
})

export const gapSchema = z.strictObject({
  id: idSchema,
  label: z.string().min(1),
  clue: z.string().nullable(),
  options: z.array(optionSchema),
  accepted: z.array(z.string().min(1)).min(1),
  explanationZh: z.string().min(1),
})

export const segmentSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), text: z.string().min(1) }),
  z.strictObject({ type: z.literal('gap'), gapId: idSchema }),
])

export const gapsItemSchema = z.strictObject({
  ...commonItemFields,
  kind: z.literal('gaps'),
  inputMode: z.enum(['text', 'options']),
  sharedOptions: z.array(optionSchema),
  uniqueOptions: z.boolean(),
  segments: z.array(segmentSchema).min(1),
  gaps: z.array(gapSchema).min(1),
  policy: textPolicySchema,
})

export const writingItemSchema = z.strictObject({
  ...commonItemFields,
  kind: z.literal('writing'),
  wordRange: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  requirementsZh: z.array(z.string().min(1)),
  openingSentences: z.array(z.string().min(1)),
  checklistZh: z.array(z.string().min(1)),
  modelAnswer: z.string(),
})

export const itemSchema = z.discriminatedUnion('kind', [
  choiceItemSchema,
  orderItemSchema,
  gapsItemSchema,
  writingItemSchema,
])

export const unitSchema = z.strictObject({
  id: idSchema,
  titleZh: z.string().min(1),
  familyIds: z.array(idSchema),
  itemIds: z.array(idSchema),
  prerequisiteSkillIds: z.array(idSchema),
})

export const coursePackSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: idSchema,
  version: semverSchema,
  titleZh: z.string().min(1),
  status: statusSchema,
  author: z.string().min(1),
  reviewer: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  profileIds: z.array(idSchema),
  sources: z.array(sourceSchema),
  assets: z.array(assetSchema),
  resources: z.array(resourceSchema),
  items: z.array(itemSchema),
  units: z.array(unitSchema),
})

const scoringSectionSchema = z.strictObject({
  section: sectionSchema,
  maxScore: z.number().int().positive(),
  itemCount: z.number().int().positive(),
})

export const scoringSchema = z.strictObject({
  total: z.number().int().positive(),
  sections: z.array(scoringSectionSchema),
})

export const examProfileSchema = z.strictObject({
  id: idSchema,
  nameZh: z.string().min(1),
  region: z.string().nullable(),
  examYear: z.number().int().nullable(),
  verified: z.boolean(),
  sourceUrls: z.array(z.string().url()),
  checkedAt: z.string().nullable(),
  enabledSections: z.array(sectionSchema),
  allowMockExam: z.boolean(),
  scoring: scoringSchema.nullable(),
})
