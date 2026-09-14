import type { ChoiceItem, GapsItem, Item, OrderItem, TextPolicy } from '../content/types'

export type Answer =
  | { kind: 'choice'; optionId: string }
  | { kind: 'order'; tokenIds: string[] }
  | { kind: 'gaps'; values: Record<string, string> }

export interface Grade {
  earned: number
  possible: number
  perGap: Record<string, boolean>
}

export type AnswerPolicy = TextPolicy

export class AnswerError extends Error {
  readonly code = 'INVALID_ANSWER' as const
}

export function normalizeAnswer(value: string, policy: AnswerPolicy): string {
  let text = value
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'")
    .trim()
    .replace(/\s+/g, ' ')
  if (policy.allowTerminalPunctuation) text = text.replace(/[.!?]+$/, '')
  return policy.caseSensitive ? text : text.toLocaleLowerCase('en-US')
}

const invalid = (message: string): never => {
  throw new AnswerError(message)
}

function gradeChoice(item: ChoiceItem, answer: Extract<Answer, { kind: 'choice' }>): Grade {
  if (!item.options.some((option) => option.id === answer.optionId)) invalid('选项不存在')
  const correct = answer.optionId === item.answerOptionId
  return { earned: correct ? 1 : 0, possible: 1, perGap: { choice: correct } }
}

function gradeOrder(item: OrderItem, answer: Extract<Answer, { kind: 'order' }>): Grade {
  const tokenIds = new Set(item.tokens.map((token) => token.id))
  if (answer.tokenIds.some((tokenId) => !tokenIds.has(tokenId)) || answer.tokenIds.length !== item.tokens.length) invalid('词块不存在或数量不正确')
  const correct = item.acceptedOrders.some((order) => order.length === answer.tokenIds.length && order.every((tokenId, index) => tokenId === answer.tokenIds[index]))
  return { earned: correct ? 1 : 0, possible: 1, perGap: { order: correct } }
}

function gradeGaps(item: GapsItem, answer: Extract<Answer, { kind: 'gaps' }>): Grade {
  const gapIds = new Set(item.gaps.map((gap) => gap.id))
  if (Object.keys(answer.values).some((gapId) => !gapIds.has(gapId))) invalid('空位不存在')
  const policy = item.policy
  const allBlank = item.gaps.every((gap) => normalizeAnswer(answer.values[gap.id] ?? '', policy) === '')
  if (allBlank) invalid('不能全部留空')
  const perGap: Record<string, boolean> = {}
  let earned = 0
  const usedOptions = new Set<string>()
  for (const gap of item.gaps) {
    const value = normalizeAnswer(answer.values[gap.id] ?? '', policy)
    const correct = value !== '' && gap.accepted.some((expected) => normalizeAnswer(expected, policy) === value)
    perGap[gap.id] = correct
    if (correct) earned += 1
    if (item.inputMode === 'options' && value !== '') {
      const optionPool = item.sharedOptions.length > 0 ? item.sharedOptions : gap.options
      if (!optionPool.some((option) => option.id === answer.values[gap.id])) invalid('空位选项不存在')
      if (item.uniqueOptions && usedOptions.has(answer.values[gap.id])) invalid('同一选项不能用于多个空位')
      usedOptions.add(answer.values[gap.id])
    }
  }
  return { earned, possible: item.gaps.length, perGap }
}

export function gradeAnswer(item: Exclude<Item, Extract<Item, { kind: 'writing' }>>, answer: Answer): Grade {
  if (item.kind === 'choice') {
    if (answer.kind !== 'choice') invalid('题型与答案不匹配')
    return gradeChoice(item, answer as Extract<Answer, { kind: 'choice' }>)
  }
  if (item.kind === 'order') {
    if (answer.kind !== 'order') invalid('题型与答案不匹配')
    return gradeOrder(item, answer as Extract<Answer, { kind: 'order' }>)
  }
  if (answer.kind !== 'gaps') invalid('题型与答案不匹配')
  return gradeGaps(item, answer as Extract<Answer, { kind: 'gaps' }>)
}
