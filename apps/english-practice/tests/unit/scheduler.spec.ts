import { describe, expect, it } from 'vitest'
import { addDays, studyDayFor } from '../../src/domain/calendar'
import { scheduleReview } from '../../src/domain/scheduler'

describe('T04 calendar and review scheduler', () => {
  it('uses UTC date arithmetic across leap days', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('derives the study day in the injected timezone', () => {
    expect(studyDayFor(new Date('2026-03-08T06:30:00.000Z'), 'America/New_York')).toBe('2026-03-08')
    expect(studyDayFor(new Date('2026-03-09T03:30:00.000Z'), 'America/New_York')).toBe('2026-03-08')
  })

  it('starts at tomorrow, advances only when due, and caps at stage 3', () => {
    const first = scheduleReview(null, 'independent-pass', '2026-09-10')
    expect(first).toEqual({ stage: 0, dueDay: '2026-09-11', lastAppliedDay: '2026-09-10', lapses: 0 })
    expect(scheduleReview(first, 'independent-pass', '2026-09-10')).toEqual(first)
    expect(scheduleReview(first, 'independent-pass', '2026-09-11')).toMatchObject({ stage: 1, dueDay: '2026-09-14' })
    expect(scheduleReview({ stage: 2, dueDay: '2026-09-10', lastAppliedDay: null, lapses: 0 }, 'independent-pass', '2026-09-10')).toMatchObject({ stage: 3, dueDay: '2026-09-24' })
    expect(scheduleReview({ stage: 3, dueDay: '2026-09-01', lastAppliedDay: null, lapses: 0 }, 'independent-pass', '2026-09-10')).toMatchObject({ stage: 3, dueDay: '2026-09-24' })
  })

  it('does not advance early and resets on needs-help', () => {
    const early = { stage: 1 as const, dueDay: '2026-09-20', lastAppliedDay: null, lapses: 2 }
    expect(scheduleReview(early, 'independent-pass', '2026-09-10')).toEqual(early)
    expect(scheduleReview(early, 'needs-help', '2026-09-10')).toEqual({ stage: 0, dueDay: '2026-09-11', lastAppliedDay: '2026-09-10', lapses: 3 })
  })

  // T10 计划固定用例（03-implementation-plan.md）
  it('schedules first success tomorrow and ignores same-day repeats (plan case)', () => {
    const first = scheduleReview(null, 'independent-pass', '2026-09-08')
    expect(first).toEqual({ stage: 0, dueDay: '2026-09-09', lastAppliedDay: '2026-09-08', lapses: 0 })
    expect(scheduleReview(first, 'independent-pass', '2026-09-08')).toEqual(first)
    const next = scheduleReview(first, 'independent-pass', '2026-09-09')
    expect(next.stage).toBe(1)
    expect(next.dueDay).toBe('2026-09-12')
  })

  it('resets a failed due review without rewarding its correction (plan case)', () => {
    const old = { stage: 2 as const, dueDay: '2026-09-08', lastAppliedDay: '2026-09-01', lapses: 0 }
    const failed = scheduleReview(old, 'needs-help', '2026-09-08')
    expect(failed).toEqual({ stage: 0, dueDay: '2026-09-09', lastAppliedDay: '2026-09-08', lapses: 1 })
  })
})
