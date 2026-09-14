import { addDays } from './calendar'

export interface ReviewState {
  stage: 0 | 1 | 2 | 3
  dueDay: string
  lastAppliedDay: string | null
  lapses: number
}

const intervals = [1, 3, 7, 14] as const

export function scheduleReview(state: ReviewState | null, result: 'independent-pass' | 'needs-help', today: string): ReviewState {
  if (state?.lastAppliedDay === today) return state
  if (result === 'needs-help') {
    return { stage: 0, dueDay: addDays(today, 1), lastAppliedDay: today, lapses: (state?.lapses ?? 0) + 1 }
  }
  if (!state) return { stage: 0, dueDay: addDays(today, 1), lastAppliedDay: today, lapses: 0 }
  if (state.dueDay > today) return state
  const stage = Math.min(3, state.stage + 1) as 0 | 1 | 2 | 3
  return { stage, dueDay: addDays(today, intervals[stage]), lastAppliedDay: today, lapses: state.lapses }
}
