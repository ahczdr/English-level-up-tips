import { coursePackSchema } from './schema'
import type { CoursePack, Item } from './types'

export interface ValidationError {
  path: string
  code: string
  messageZh: string
}

export interface ValidationResult {
  ok: boolean
  errors: ValidationError[]
}

const error = (errors: ValidationError[], path: string, code: string, messageZh: string) => {
  errors.push({ path, code, messageZh })
}

const uniqueIds = (
  values: Array<{ id: string }>,
  name: string,
  errors: ValidationError[],
) => {
  const seen = new Set<string>()
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      error(errors, `${name}[${index}].id`, 'DUPLICATE_ID', `${name} 存在重复 ID：${value.id}`)
    }
    seen.add(value.id)
  })
}

const ids = (values: Array<{ id: string }>) => new Set(values.map((value) => value.id))

const checkItem = (item: Item, index: number, pack: CoursePack, errors: ValidationError[]) => {
  const itemPath = `items[${index}]`
  const sourceIds = ids(pack.sources)
  const resourceIds = ids(pack.resources)
  const assetIds = ids(pack.assets)

  item.sourceIds.forEach((sourceId, sourceIndex) => {
    if (!sourceIds.has(sourceId)) {
      error(errors, `${itemPath}.sourceIds[${sourceIndex}]`, 'MISSING_REFERENCE', `找不到来源：${sourceId}`)
    }
  })
  if (item.resourceId !== null && !resourceIds.has(item.resourceId)) {
    error(errors, `${itemPath}.resourceId`, 'MISSING_REFERENCE', `找不到资源：${item.resourceId}`)
  }

  const optionIds = (item.kind === 'choice' || item.kind === 'order')
    ? item.kind === 'choice'
      ? item.options.map((option) => option.id)
      : item.tokens.map((token) => token.id)
    : []
  if (new Set(optionIds).size !== optionIds.length) {
    error(errors, itemPath, 'DUPLICATE_ID', '选项 ID 不能重复')
  }

  if (item.kind === 'choice') {
    if (!item.options.some((option) => option.id === item.answerOptionId)) {
      error(errors, `${itemPath}.answerOptionId`, 'INVALID_ANSWER', '标准答案不在选项中')
    }
    item.explanation.distractors.forEach((distractor, distractorIndex) => {
      if (!item.options.some((option) => option.id === distractor.optionId)) {
        error(errors, `${itemPath}.explanation.distractors[${distractorIndex}]`, 'MISSING_REFERENCE', '干扰项引用不存在')
      }
    })
  }

  if (item.kind === 'order') {
    const expected = new Set(item.tokens.map((token) => token.id))
    item.acceptedOrders.forEach((order, orderIndex) => {
      if (order.length !== expected.size || new Set(order).size !== expected.size || order.some((id) => !expected.has(id))) {
        error(errors, `${itemPath}.acceptedOrders[${orderIndex}]`, 'INVALID_ORDER', '组句答案必须恰好包含每个词块一次')
      }
    })
  }

  if (item.kind === 'gaps') {
    const gapIds = new Set(item.gaps.map((gap) => gap.id))
    if (gapIds.size !== item.gaps.length) {
      error(errors, `${itemPath}.gaps`, 'DUPLICATE_ID', '空位 ID 不能重复')
    }
    const references = item.segments.filter((segment) => segment.type === 'gap').map((segment) => segment.gapId)
    item.gaps.forEach((gap, gapIndex) => {
      const count = references.filter((gapId) => gapId === gap.id).length
      if (count !== 1) {
        error(errors, `${itemPath}.gaps[${gapIndex}]`, 'INVALID_GAP', '每个空必须在材料中恰好出现一次')
      }
    })
    references.forEach((gapId) => {
      if (!gapIds.has(gapId)) {
        error(errors, `${itemPath}.segments`, 'MISSING_REFERENCE', `找不到空位：${gapId}`)
      }
    })
    if (item.inputMode === 'text' && (item.sharedOptions.length > 0 || item.gaps.some((gap) => gap.options.length > 0))) {
      error(errors, itemPath, 'INVALID_GAP', '文本填空不能配置选项')
    }
    if (item.inputMode === 'options' && item.gaps.some((gap) => gap.options.length === 0) && item.sharedOptions.length === 0) {
      error(errors, itemPath, 'INVALID_GAP', '选项填空必须提供共享选项或每空选项')
    }
    if (item.inputMode === 'options' && item.uniqueOptions) {
      const optionIds = [...item.sharedOptions.map((option) => option.id), ...item.gaps.flatMap((gap) => gap.options.map((option) => option.id))]
      if (new Set(optionIds).size !== optionIds.length) {
        error(errors, itemPath, 'DUPLICATE_ID', '共享选项和每空选项 ID 不能重复')
      }
      const assigned = new Map<string, number>()
      const canMatch = (gapIndex: number, seen: Set<string>): boolean => {
        const gap = item.gaps[gapIndex]
        for (const answer of gap.accepted) {
          if (seen.has(answer)) continue
          seen.add(answer)
          const owner = assigned.get(answer)
          if (owner === undefined || canMatch(owner, seen)) {
            assigned.set(answer, gapIndex)
            return true
          }
        }
        return false
      }
      if (item.gaps.some((_, gapIndex) => !canMatch(gapIndex, new Set()))) {
        error(errors, itemPath, 'INVALID_GAP', '唯一选项模式必须存在一一对应的可行答案')
      }
    }
    if (item.sharedOptions.length > 0 && item.gaps.some((gap) => gap.options.length > 0)) {
      error(errors, itemPath, 'INVALID_GAP', '共享选项与每空选项不能同时存在')
    }
    const allGapOptionIds = [...item.sharedOptions.map((option) => option.id), ...item.gaps.flatMap((gap) => gap.options.map((option) => option.id))]
    if (new Set(allGapOptionIds).size !== allGapOptionIds.length) {
      error(errors, itemPath, 'DUPLICATE_ID', '填空选项 ID 不能重复')
    }
    const sharedOptionIds = new Set(item.sharedOptions.map((option) => option.id))
    item.gaps.forEach((gap, gapIndex) => {
      const localOptionIds = new Set(gap.options.map((option) => option.id))
      if (item.inputMode === 'options' && gap.accepted.some((answer) => !sharedOptionIds.has(answer) && !localOptionIds.has(answer))) {
        error(errors, `${itemPath}.gaps[${gapIndex}].accepted`, 'INVALID_ANSWER', '空位标准答案必须引用选项 ID')
      }
    })
  }

  if (item.section === 'reading' || item.section === 'listening') {
    if (item.explanation.evidence.length === 0) {
      error(errors, `${itemPath}.explanation.evidence`, 'INVALID_EVIDENCE', '阅读和听力题必须至少提供一条解析证据')
    }
  }
  if (item.section === 'listening') {
    const resource = item.resourceId === null ? undefined : pack.resources.find((candidate) => candidate.id === item.resourceId)
    if (!resource?.audioAssetId || !assetIds.has(resource.audioAssetId) || !resource.transcript) {
      error(errors, `${itemPath}.resourceId`, 'AUDIO_MISSING', '听力资源必须引用本地音频资产并提供 transcript')
    }
  }

  if (item.explanation.evidence.length > 0) {
    item.explanation.evidence.forEach((evidence, evidenceIndex) => {
      const resource = pack.resources.find((candidate) => candidate.id === evidence.resourceId)
      const paragraph = resource?.paragraphs.find((candidate) => candidate.id === evidence.paragraphId)
      if (!resource || !paragraph || !paragraph.text.includes(evidence.quote)) {
        error(errors, `${itemPath}.explanation.evidence[${evidenceIndex}]`, 'INVALID_EVIDENCE', '解析证据必须引用资源中的原文子串')
      }
    })
  }
}

export function validatePack(value: unknown, purpose: 'preview' | 'release'): ValidationResult {
  const parsed = coursePackSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        code: 'SCHEMA_INVALID',
        messageZh: issue.message,
      })),
    }
  }

  const pack = parsed.data as CoursePack
  const errors: ValidationError[] = []
  uniqueIds(pack.sources, 'sources', errors)
  uniqueIds(pack.assets, 'assets', errors)
  uniqueIds(pack.resources, 'resources', errors)
  uniqueIds(pack.items, 'items', errors)
  uniqueIds(pack.units, 'units', errors)

  const itemIds = ids(pack.items)
  pack.units.forEach((unit, unitIndex) => {
    unit.itemIds.forEach((itemId, itemIndex) => {
      if (!itemIds.has(itemId)) {
        error(errors, `units[${unitIndex}].itemIds[${itemIndex}]`, 'MISSING_REFERENCE', `找不到题目：${itemId}`)
      }
    })
    const familyIds = new Set(pack.items.filter((item) => unit.itemIds.includes(item.id)).map((item) => item.familyId))
    if (familyIds.size !== unit.familyIds.length || unit.familyIds.some((familyId) => !familyIds.has(familyId))) {
      error(errors, `units[${unitIndex}].familyIds`, 'INVALID_REFERENCE', '单元家族必须与题目家族一致')
    }
  })

  pack.items.forEach((item, index) => checkItem(item, index, pack, errors))
  const assetIds = ids(pack.assets)
  pack.resources.forEach((resource, index) => {
    if (resource.audioAssetId !== null && !assetIds.has(resource.audioAssetId)) {
      error(errors, `resources[${index}].audioAssetId`, 'MISSING_REFERENCE', `找不到音频资产：${resource.audioAssetId}`)
    }
  })
  pack.assets.forEach((asset, index) => {
    if (!asset.path.startsWith('assets/') || asset.path.includes('..')) {
      error(errors, `assets[${index}].path`, 'UNSAFE_ASSET_PATH', '素材路径必须位于 assets/ 下且不能包含 ..')
    }
  })

  const serialized = JSON.stringify(pack)
  if (/<\/?[a-z][^>]*>/i.test(serialized)) {
    error(errors, '$', 'UNSAFE_CONTENT', '内容不能包含 HTML 或可执行标签')
  }

  if (purpose === 'release') {
    const samePerson = pack.author.trim().toLowerCase() === (pack.reviewer ?? '').trim().toLowerCase()
    if (pack.status !== 'published' || !pack.reviewer || pack.author.trim().length === 0 || !pack.reviewedAt || samePerson) {
      error(errors, 'status', 'RELEASE_GATE', '发布包必须已发布、具有审核人和审核时间，且作者与审核人不同（忽略空白与大小写）')
    } else if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(pack.reviewedAt) || Number.isNaN(Date.parse(pack.reviewedAt))) {
      error(errors, 'reviewedAt', 'RELEASE_GATE', '审核时间必须是有效 ISO 日期')
    }
  }

  return { ok: errors.length === 0, errors }
}
