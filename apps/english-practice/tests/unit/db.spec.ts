import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { createDatabase, deleteDatabase, type GaokaoDatabase } from '../../src/data/db'
import type { AttemptRecord, Exposure, GaokaoDatabaseSchema, Session } from '../../src/data/migrations'

// T03：D05 表与索引（按当前 v2 schema 实测口径）；v2 迁移：存量 attempt/exposure 回填 profileId

const databases: GaokaoDatabase[] = []
const openTestDb = async () => {
  const db = createDatabase(`gaokao-test-${crypto.randomUUID()}`)
  await db.open()
  databases.push(db)
  return db
}

afterEach(async () => {
  while (databases.length > 0) await deleteDatabase(databases.pop()!)
})

describe('T03 database schema', () => {
  it('creates all D05 tables and indexes', async () => {
    const db = await openTestDb()
    expect(db.tables.map((table) => table.name).sort()).toEqual([
      'achievements',
      'attempts',
      'downloadJobs',
      'drafts',
      'exposures',
      'packs',
      'reviewStates',
      'sessions',
      'settings',
      'writingVersions',
    ])
    const indexNames = new Map(db.tables.map((table) => [table.name, table.schema.indexes.map((index) => index.name).join(',')]))
    expect(indexNames.get('attempts')).toBe('[sessionId+slotId+phase],sessionId,familyId,studyDay,profileId')
    expect(indexNames.get('exposures')).toBe('familyId,profileId')
    expect(indexNames.get('sessions')).toBe('state,studyDay')
    expect(indexNames.get('packs')).toBe('status')
    expect(indexNames.get('reviewStates')).toBe('dueDay')
    expect(indexNames.get('writingVersions')).toBe('[sessionId+itemId]')
    expect(indexNames.get('settings')).toBe('')
    expect(indexNames.get('downloadJobs')).toBe('')
  })
})

describe('v2 迁移：存量 attempt/exposure 回填 profileId', () => {
  it('session 归属的 attempt 回填 session.profileId，孤儿 attempt/exposure 回填默认 profile', async () => {
    const name = `gaokao-test-legacy-${crypto.randomUUID()}`
    const legacy = new Dexie(name) as unknown as Dexie & GaokaoDatabaseSchema
    legacy.version(1).stores({
      settings: '&id',
      packs: '[id+version], status',
      sessions: 'id,state,studyDay',
      attempts: 'id,[sessionId+slotId+phase],familyId,studyDay',
      exposures: '[packId+packVersion+itemId],familyId',
      reviewStates: '[profileId+familyId+reviewMode],dueDay',
      drafts: '[sessionId+itemId]',
      writingVersions: 'id,[sessionId+itemId]',
      achievements: 'id',
      downloadJobs: '[packId+version]',
    })
    await legacy.open()
    const sessionRow = { id: 's1', profileId: 'profile-a', unitId: null, slots: [], currentIndex: 0, revision: 0, state: 'active', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z', studyDay: '2026-09-10' }
    await legacy.sessions.add(sessionRow as unknown as Session)
    await legacy.attempts.add({ id: 'a1', sessionId: 's1', slotId: 's1:i1', phase: 'first', familyId: 'f1', studyDay: '2026-09-10', createdAt: '2026-09-10T00:00:01.000Z', payload: {} } as unknown as AttemptRecord)
    await legacy.attempts.add({ id: 'a2', sessionId: 'orphan', slotId: 'orphan:i1', phase: 'first', familyId: 'f1', studyDay: '2026-09-10', createdAt: '2026-09-10T00:00:02.000Z', payload: {} } as unknown as AttemptRecord)
    await legacy.exposures.add({ packId: 'p1', packVersion: '1.0.0', itemId: 'i1', familyId: 'f1', firstSeenAt: '2026-09-10T00:00:00.000Z', studyDay: '2026-09-10', firstSeenSessionId: 's1' } as unknown as Exposure)
    legacy.close()

    const upgraded = createDatabase(name)
    await upgraded.open()
    databases.push(upgraded)
    expect(await upgraded.attempts.get('a1')).toMatchObject({ profileId: 'profile-a' })
    // R5：断言精确化（孤儿/FALLBACK/归属）
    expect((await upgraded.attempts.get('a2'))?.profileId).toBe('gaokao-common-training-v1')
    expect((await upgraded.exposures.get(['p1', '1.0.0', 'i1']))?.profileId).toBe('profile-a')
  })
})

describe('v2 迁移 fallback 分支', () => {
  it('session 行缺 profileId → 归属 attempt 回填 FALLBACK_PROFILE_ID', async () => {
    const name = `gaokao-test-fb1-${crypto.randomUUID()}`
    const legacy = new Dexie(name) as unknown as Dexie & GaokaoDatabaseSchema
    legacy.version(1).stores({
      settings: '&id',
      packs: '[id+version], status',
      sessions: 'id,state,studyDay',
      attempts: 'id,[sessionId+slotId+phase],familyId,studyDay',
      exposures: '[packId+packVersion+itemId],familyId',
      reviewStates: '[profileId+familyId+reviewMode],dueDay',
      drafts: '[sessionId+itemId]',
      writingVersions: 'id,[sessionId+itemId]',
      achievements: 'id',
      downloadJobs: '[packId+version]',
    })
    await legacy.open()
    await legacy.sessions.add({ id: 's2', unitId: null, slots: [], currentIndex: 0, revision: 0, state: 'active', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z', studyDay: '2026-09-10' } as unknown as Session)
    await legacy.attempts.add({ id: 'a3', sessionId: 's2', slotId: 's2:i1', phase: 'first', familyId: 'f1', studyDay: '2026-09-10', createdAt: '2026-09-10T00:00:01.000Z', payload: {} } as unknown as AttemptRecord)
    legacy.close()
    const upgraded = createDatabase(name)
    await upgraded.open()
    databases.push(upgraded)
    expect((await upgraded.attempts.get('a3'))?.profileId).toBe('gaokao-common-training-v1')
  })
})

describe('后续版本迁移失败韧性', () => {
  it('v2→v3 迁移失败时拒绝打开，且已升级数据完整保留', async () => {
    const name = `gaokao-migration-fail-${crypto.randomUUID()}`
    const initial = createDatabase(name)
    await initial.open()
    await initial.settings.add({ id: 'personal', value: { keep: true } })
    initial.close()

    const broken = createDatabase(name)
    broken.version(3).stores({ migrationProbe: 'id' }).upgrade(() => {
      throw new Error('simulated migration failure')
    })
    await expect(broken.open()).rejects.toThrow('simulated migration failure')
    broken.close()

    const recovered = createDatabase(name)
    await recovered.open()
    databases.push(recovered)
    expect(await recovered.settings.get('personal')).toEqual({ id: 'personal', value: { keep: true } })
  })
})