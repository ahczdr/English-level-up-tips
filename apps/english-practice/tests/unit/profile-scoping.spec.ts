import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { createDatabase, deleteDatabase, type GaokaoDatabase } from '../../src/data/db'
import { collectLevelUpEvidence } from '../../src/services/learning'

const databases: GaokaoDatabase[] = []

afterEach(async () => {
  while (databases.length > 0) await deleteDatabase(databases.pop()!)
})

const openDb = async () => {
  const db = createDatabase(`gaokao-profile-${crypto.randomUUID()}`)
  await db.open()
  databases.push(db)
  return db
}

// 直接播种作答行（与服务层 writeAttempt 的 payload 形状一致），验证 profile 过滤口径
const seedAttempt = async (db: GaokaoDatabase, id: string, profileId: string, itemId: string, correct: boolean, createdAt: string) => {
  await db.attempts.add({
    id,
    sessionId: `session-${profileId}`,
    slotId: `${id}:slot`,
    phase: 'first',
    familyId: `family-${itemId}`,
    profileId,
    studyDay: '2026-09-10',
    createdAt,
    payload: {
      grade: { earned: correct ? 1 : 0, possible: 1 },
      assistance: [],
      ref: { packId: 'p1', packVersion: '1.0.0', itemId },
    },
  })
}

describe('CR2 升层证据按 profile 过滤', () => {
  it('只统计当前 profile 的有效独立首次', async () => {
    const db = await openDb()
    await seedAttempt(db, 'a1', 'profile-a', 'i1', true, '2026-09-10T00:00:01.000Z')
    await seedAttempt(db, 'a2', 'profile-a', 'i2', false, '2026-09-10T00:00:02.000Z')
    await seedAttempt(db, 'a3', 'profile-b', 'i1', true, '2026-09-10T00:00:03.000Z')
    const evidence = await collectLevelUpEvidence(db, 'profile-a')
    expect(evidence.ok).toBe(true)
    if (!evidence.ok) return
    expect(evidence.value.evidence.firstAttempts).toBe(2)
    expect(evidence.value.evidence.accuracy).toBe(0.5)
    expect(evidence.value.evidence.families).toBe(2)
  })

  it('目标 profile 无作答时不计入其他 profile 的样本', async () => {
    const db = await openDb()
    await seedAttempt(db, 'b1', 'profile-b', 'i1', true, '2026-09-10T00:00:01.000Z')
    const evidence = await collectLevelUpEvidence(db, 'profile-a')
    expect(evidence.ok).toBe(true)
    if (!evidence.ok) return
    expect(evidence.value.evidence.firstAttempts).toBe(0)
    expect(evidence.value.evidence.accuracy).toBe(0)
  })
})
