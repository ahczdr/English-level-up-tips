import { describe, expect, it } from 'vitest'
import samplePack from '../fixtures/sample-pack.json'
import { AnswerError, gradeAnswer, normalizeAnswer } from '../../src/domain/answers'
import type { ChoiceItem, CoursePack, GapsItem, OrderItem } from '../../src/content/types'

const pack = samplePack as unknown as CoursePack
const policy = { caseSensitive: false, allowTerminalPunctuation: false }

describe('T04 answer grading', () => {
  it('normalizes width, apostrophes and whitespace without fuzzy correction', () => {
    expect(normalizeAnswer('  ＭＥＥＴＳ  ', policy)).toBe('meets')
    expect(normalizeAnswer('  it\u2019s   ready ', policy)).toBe("it's ready")
    expect(normalizeAnswer('meet', policy)).not.toBe('meets')
    expect(normalizeAnswer('meets.', policy)).not.toBe('meets')
    expect(normalizeAnswer('meets.', { ...policy, allowTerminalPunctuation: true })).toBe('meets')
  })

  it('grades choices by stable option id and rejects unknown ids', () => {
    const item = pack.items.find((candidate) => candidate.id === 'vocab-join-a') as ChoiceItem
    expect(gradeAnswer(item, { kind: 'choice', optionId: 'a' })).toMatchObject({ earned: 1, possible: 1 })
    expect(gradeAnswer(item, { kind: 'choice', optionId: 'b' })).toMatchObject({ earned: 0, possible: 1 })
    expect(() => gradeAnswer(item, { kind: 'choice', optionId: 'missing' })).toThrow(AnswerError)
  })

  it('grades accepted order sequences and gaps independently', () => {
    const order = pack.items.find((candidate) => candidate.id === 'order-join-a') as OrderItem
    expect(gradeAnswer(order, { kind: 'order', tokenIds: ['t1', 't2', 't3', 't4', 't5'] })).toMatchObject({ earned: 1, possible: 1 })
    expect(gradeAnswer(order, { kind: 'order', tokenIds: ['t2', 't1', 't3', 't4', 't5'] })).toMatchObject({ earned: 0, possible: 1 })
    const gaps = pack.items.find((candidate) => candidate.id === 'cloze-help-a') as GapsItem
    expect(gradeAnswer(gaps, { kind: 'gaps', values: { g1: 'a', g2: '' } })).toMatchObject({ earned: 1, possible: 2, perGap: { g1: true, g2: false } })
    expect(() => gradeAnswer(gaps, { kind: 'gaps', values: { g1: 'c', g2: '' } })).toThrow(AnswerError)
    const shared = pack.items.find((candidate) => candidate.id === 'gap-reading-plan-a') as GapsItem
    expect(gradeAnswer(shared, { kind: 'gaps', values: { g1: 'a', g2: 'b', g3: 'c', g4: 'd', g5: 'e' } })).toMatchObject({ earned: 5, possible: 5 })
    expect(() => gradeAnswer(gaps, { kind: 'gaps', values: { g1: '', g2: '' } })).toThrow(AnswerError)
    expect(() => gradeAnswer(gaps, { kind: 'gaps', values: { missing: 'a' } })).toThrow(AnswerError)
  })

  it('rejects kind mismatch', () => {
    const item = pack.items.find((candidate) => candidate.id === 'vocab-join-a') as ChoiceItem
    expect(() => gradeAnswer(item, { kind: 'order', tokenIds: [] })).toThrow(AnswerError)
  })
})
