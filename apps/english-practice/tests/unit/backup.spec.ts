import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { createDatabase, deleteDatabase, type GaokaoDatabase } from '../../src/data/db'
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  MAX_BACKUP_BYTES,
  canonicalJsonString,
  exportBackup,
  restoreBackup,
  sha256Hex,
  validateBackupJson,
} from '../../src/data/backup'

// 篡改 payload 后重算确定性摘要，隔离被测校验环节与摘要校验
const reseal = async (parsed: Record<string, unknown>): Promise<string> => {
  const payload = parsed.payload as Record<string, unknown>
  const resealed = { ...parsed, payloadSha256: await sha256Hex(canonicalJsonString(payload)) }
  return JSON.stringify(resealed)
}

const databases: GaokaoDatabase[] = []

const openDb = async (): Promise<GaokaoDatabase> => {
  const db = createDatabase('gaokao-backup-' + crypto.randomUUID())
  await db.open()
  databases.push(db)
  return db
}

afterEach(async () => {
  while (databases.length > 0) await deleteDatabase(databases.pop() as GaokaoDatabase)
})

// 种子库 A：覆盖全部 9 张学习/内容表 + 1 张应被排除的 downloadJobs
const seedDb = async (db: GaokaoDatabase): Promise<void> => {
  await db.settings.bulkAdd([
    { id: 'personal', value: { profileId: 'gaokao-common-training-v1', grade: 'G1', goal: null, defaultMinutes: 10, timeZone: 'Asia/Shanghai', sound: true, animation: true } },
    { id: 'today-session:p1:2026-09-12', value: 's1' },
  ])
  await db.packs.add({ id: 'p1', version: '1.0.0', status: 'installed', installedAt: '2026-09-10T00:00:00.000Z', resourcesReady: true, pack: { id: 'p1', version: '1.0.0', titleZh: '包一', assets: [{ id: 'a1', path: 'assets/a.m4a', mime: 'audio/mp4', bytes: 10, sha256: 'x' }] } })
  await db.packs.add({ id: 'p2', version: '1.0.0', status: 'installed', installedAt: '2026-09-10T00:00:00.000Z', resourcesReady: true, pack: { id: 'p2', version: '1.0.0', titleZh: '包二（无资产）', assets: [] } })
  await db.sessions.add({ id: 's1', profileId: 'gaokao-common-training-v1', unitId: null, slots: [], currentIndex: 0, revision: 3, state: 'completed', createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:05:00.000Z', studyDay: '2026-09-11' })
  await db.attempts.add({ id: 'at1', sessionId: 's1', slotId: 's1:i1', phase: 'first', profileId: 'gaokao-common-training-v1', familyId: 'join-context', studyDay: '2026-09-11', createdAt: '2026-09-11T00:01:00.000Z', payload: { grade: { earned: 1, possible: 1 }, assistance: [], ref: { packId: 'p1', packVersion: '1.0.0', itemId: 'i1' } } })
  await db.exposures.add({ packId: 'p1', packVersion: '1.0.0', itemId: 'i1', profileId: 'gaokao-common-training-v1', familyId: 'join-context', firstSeenAt: '2026-09-11T00:01:00.000Z', studyDay: '2026-09-11', firstSeenSessionId: 's1' })
  await db.reviewStates.add({ profileId: 'gaokao-common-training-v1', familyId: 'join-context', reviewMode: 'recognition', dueDay: '2026-09-14', updatedAt: '2026-09-11T00:01:00.000Z', data: { stage: 1, dueDay: '2026-09-14' } })
  await db.drafts.add({ sessionId: 's1', itemId: 'w1', updatedAt: '2026-09-11T00:02:00.000Z', content: '初稿草稿' })
  await db.writingVersions.add({ id: 's1:w1:v1', sessionId: 's1', itemId: 'w1', createdAt: '2026-09-11T00:03:00.000Z', content: JSON.stringify({ content: '初稿', outline: '', checklist: [true], version: 1 }) })
  await db.achievements.add({ id: 'unit:first:u1', profileId: 'gaokao-common-training-v1', unlockedAt: '2026-09-11T00:01:00.000Z', data: { sessionId: 's1' } })
  await db.downloadJobs.add({ packId: 'p1', version: '1.0.0', status: 'ready', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z', data: { assets: { a1: { sha256: 'x', data: new ArrayBuffer(10) } } } })
}

describe('exportBackup envelope 与确定性摘要', () => {
  it('envelope 结构完整，payloadSha256 为递归排序 JSON 的 SHA256，排除 downloadJobs', async () => {
    const db = await openDb()
    await seedDb(db)
    const result = await exportBackup({ db, appVersion: '0.1.0', now: () => new Date('2026-09-12T00:00:00.000Z') })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { envelope, json, sizeBytes } = result.value
    expect(envelope.format).toBe(BACKUP_FORMAT)
    expect(envelope.format).toBe('gaokao-personal-backup')
    expect(envelope.schemaVersion).toBe(BACKUP_SCHEMA_VERSION)
    expect(envelope.exportedAt).toBe('2026-09-12T00:00:00.000Z')
    expect(envelope.appVersion).toBe('0.1.0')
    expect(envelope.payload.packs).toHaveLength(2)
    expect(envelope.payload.sessions).toHaveLength(1)
    expect(envelope.payload.attempts).toHaveLength(1)
    expect(envelope.payload.exposures).toHaveLength(1)
    expect(envelope.payload.reviewStates).toHaveLength(1)
    expect(envelope.payload.drafts).toHaveLength(1)
    expect(envelope.payload.writingVersions).toHaveLength(1)
    expect(envelope.payload.achievements).toHaveLength(1)
    expect(envelope.payload.settings).toHaveLength(2)
    expect((envelope.payload as { downloadJobs?: unknown[] }).downloadJobs).toBeUndefined()
    // 摘要与 json 反序列化后的重算一致（序列化不依赖插入顺序）
    const reparsed = JSON.parse(json) as { payloadSha256: string; payload: unknown }
    expect(reparsed.payloadSha256).toBe(envelope.payloadSha256)
    expect(sizeBytes).toBe(new TextEncoder().encode(json).length)
    expect(sizeBytes).toBeGreaterThan(0)
  })

  it('确定性摘要：两次导出一致；不同键序的等价 payload 校验通过（插入顺序无关）', async () => {
    const db = await openDb()
    await seedDb(db)
    const result = await exportBackup({ db, appVersion: '0.1.0', now: () => new Date('2026-09-12T00:00:00.000Z') })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const again = await exportBackup({ db, appVersion: '0.1.0', now: () => new Date('2026-09-12T00:00:00.000Z') })
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.value.envelope.payloadSha256).toBe(result.value.envelope.payloadSha256)
    // 构造键倒序插入的等价 payload（顶层键与行内键均反转），摘要重算后应与原摘要一致
    const source = JSON.parse(JSON.stringify(result.value.envelope.payload)) as Record<string, unknown[]>
    const reversedTop: Record<string, unknown[]> = {}
    for (const key of Object.keys(source).reverse()) {
      const rows = source[key] as Array<Record<string, unknown>>
      reversedTop[key] = rows.map((row) => {
        const reversedRow: Record<string, unknown> = {}
        for (const rowKey of Object.keys(row).reverse()) reversedRow[rowKey] = row[rowKey]
        return reversedRow
      })
    }
    const recomputed = await sha256Hex(canonicalJsonString(reversedTop))
    expect(recomputed).toBe(result.value.envelope.payloadSha256)
    // 校验器接受键序不同但内容等价的备份
    const reorderedJson = JSON.stringify({ ...result.value.envelope, payload: reversedTop })
    const check = await validateBackupJson({ text: reorderedJson })
    expect(check.ok).toBe(true)
  })
})

describe('validateBackupJson 校验矩阵', () => {
  it('合法备份通过并返回 envelope', async () => {
    const db = await openDb()
    await seedDb(db)
    const result = await exportBackup({ db, appVersion: '0.1.0' })
    if (!result.ok) throw new Error('export failed')
    const check = await validateBackupJson({ text: result.value.json })
    expect(check.ok).toBe(true)
  })

  it('损坏摘要 → DIGEST_MISMATCH', async () => {
    const db = await openDb()
    await seedDb(db)
    const result = await exportBackup({ db, appVersion: '0.1.0' })
    if (!result.ok) throw new Error('export failed')
    const parsed = JSON.parse(result.value.json) as Record<string, unknown>
    parsed.payloadSha256 = 'deadbeef'
    const check = await validateBackupJson({ text: JSON.stringify(parsed) })
    expect(check).toMatchObject({ ok: false, error: { code: 'DIGEST_MISMATCH' } })
  })

  it('未来 schema → NEWER_SCHEMA', async () => {
    const db = await openDb()
    await seedDb(db)
    const result = await exportBackup({ db, appVersion: '0.1.0' })
    if (!result.ok) throw new Error('export failed')
    const parsed = JSON.parse(result.value.json) as Record<string, unknown>
    parsed.schemaVersion = 99
    const check = await validateBackupJson({ text: JSON.stringify(parsed) })
    expect(check).toMatchObject({ ok: false, error: { code: 'NEWER_SCHEMA' } })
  })

  it('孤立 Attempt（sessionId 不在 sessions）→ ORPHAN_RECORD', async () => {
    const db = await openDb()
    await seedDb(db)
    const result = await exportBackup({ db, appVersion: '0.1.0' })
    if (!result.ok) throw new Error('export failed')
    const parsed = JSON.parse(result.value.json) as { payload: Record<string, unknown> }
    const payload = parsed.payload as { attempts: Array<{ sessionId: string }>; payloadSha256?: string }
    payload.attempts = [{ ...(payload.attempts[0] as unknown as Record<string, unknown>), sessionId: 'ghost' }] as unknown as Array<{ sessionId: string }>
    const check = await validateBackupJson({ text: await reseal(parsed) })
    expect(check).toMatchObject({ ok: false, error: { code: 'ORPHAN_RECORD' } })
  })

  it('ID 重复 → DUPLICATE_ID', async () => {
    const db = await openDb()
    await seedDb(db)
    const result = await exportBackup({ db, appVersion: '0.1.0' })
    if (!result.ok) throw new Error('export failed')
    const parsed = JSON.parse(result.value.json) as { payload: Record<string, unknown> }
    const payload = parsed.payload as { sessions: unknown[] }
    payload.sessions = [...payload.sessions, ...payload.sessions]
    const check = await validateBackupJson({ text: await reseal(parsed) })
    expect(check).toMatchObject({ ok: false, error: { code: 'DUPLICATE_ID' } })
  })

  it('ID 重复 → DUPLICATE_ID（packs 复合主键，B2）', async () => {
    const db = await openDb()
    await seedDb(db)
    const result = await exportBackup({ db, appVersion: '0.1.0' })
    if (!result.ok) throw new Error('export failed')
    const parsed = JSON.parse(result.value.json) as { payload: Record<string, unknown> }
    const payload = parsed.payload as { packs: unknown[] }
    payload.packs = [...payload.packs, ...payload.packs]
    const check = await validateBackupJson({ text: await reseal(parsed) })
    expect(check).toMatchObject({ ok: false, error: { code: 'DUPLICATE_ID' } })
  })

  it('ID 重复 → DUPLICATE_ID（reviewStates 复合主键，B2）', async () => {
    const db = await openDb()
    await seedDb(db)
    const result = await exportBackup({ db, appVersion: '0.1.0' })
    if (!result.ok) throw new Error('export failed')
    const parsed = JSON.parse(result.value.json) as { payload: Record<string, unknown> }
    const payload = parsed.payload as { reviewStates: unknown[] }
    payload.reviewStates = [...payload.reviewStates, ...payload.reviewStates]
    const check = await validateBackupJson({ text: await reseal(parsed) })
    expect(check).toMatchObject({ ok: false, error: { code: 'DUPLICATE_ID' } })
  })

  it('旧版本 schema → UNSUPPORTED_SCHEMA', async () => {
    const db = await openDb()
    await seedDb(db)
    const result = await exportBackup({ db, appVersion: '0.1.0' })
    if (!result.ok) throw new Error('export failed')
    const parsed = JSON.parse(result.value.json) as Record<string, unknown>
    parsed.schemaVersion = 0
    const check = await validateBackupJson({ text: JSON.stringify(parsed) })
    expect(check).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_SCHEMA' } })
  })

  it('非 JSON / format 不符 → INVALID_FORMAT；缺表键 → INVALID_PAYLOAD', async () => {
    const bad1 = await validateBackupJson({ text: 'not-json' })
    expect(bad1).toMatchObject({ ok: false, error: { code: 'INVALID_FORMAT' } })
    const bad2 = await validateBackupJson({ text: JSON.stringify({ format: 'other' }) })
    expect(bad2).toMatchObject({ ok: false, error: { code: 'INVALID_FORMAT' } })
    const db = await openDb()
    await seedDb(db)
    const result = await exportBackup({ db, appVersion: '0.1.0' })
    if (!result.ok) throw new Error('export failed')
    const parsed = JSON.parse(result.value.json) as { payload: Record<string, unknown> }
    delete (parsed.payload as Record<string, unknown>).achievements
    const bad3 = await validateBackupJson({ text: await reseal(parsed) })
    expect(bad3).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } })
  })

  it('体积超限 → SIZE_LIMIT（默认 50MiB 常量 + 注入阈值）', async () => {
    const db = await openDb()
    await seedDb(db)
    const result = await exportBackup({ db, appVersion: '0.1.0' })
    if (!result.ok) throw new Error('export failed')
    const check = await validateBackupJson({ text: result.value.json, maxSizeBytes: 8 })
    expect(check).toMatchObject({ ok: false, error: { code: 'SIZE_LIMIT' } })
    expect(MAX_BACKUP_BYTES).toBe(50 * 1024 * 1024)
  })

  it('作答记录数超限 → ATTEMPT_LIMIT（注入阈值）', async () => {
    const db = await openDb()
    await seedDb(db)
    const result = await exportBackup({ db, appVersion: '0.1.0' })
    if (!result.ok) throw new Error('export failed')
    const parsed = JSON.parse(result.value.json) as { payload: Record<string, unknown> }
    const payload = parsed.payload as { attempts: unknown[]; sessions: unknown[] }
    payload.attempts = [payload.attempts[0], payload.attempts[0], payload.attempts[0]].map((row, index) => ({ ...(row as Record<string, unknown>), id: 'at' + String(index), sessionId: 's1' }))
    const check = await validateBackupJson({ text: await reseal(parsed), maxAttempts: 2 })
    expect(check).toMatchObject({ ok: false, error: { code: 'ATTEMPT_LIMIT' } })
  })
})

describe('restoreBackup 单事务恢复', () => {
  it('导出A → 新库B 恢复 → 逐表记录相等；downloadJobs 不恢复；音频标缺', async () => {
    const dbA = await openDb()
    await seedDb(dbA)
    const exported = await exportBackup({ db: dbA, appVersion: '0.1.0' })
    if (!exported.ok) throw new Error('export failed')

    const dbB = await openDb()
    await dbB.settings.add({ id: 'personal', value: { profileId: 'other-device', grade: null, goal: null, defaultMinutes: 15, timeZone: 'UTC', sound: false, animation: false } })
    const check = await validateBackupJson({ text: exported.value.json })
    expect(check.ok).toBe(true)
    const restored = await restoreBackup({ db: dbB, envelope: (check as { ok: true; value: Parameters<typeof restoreBackup>[0]['envelope'] }).value })
    expect(restored.ok).toBe(true)

    const stripReady = (row: { resourcesReady?: boolean }): { resourcesReady?: boolean } => {
      const clone = { ...row }
      delete clone.resourcesReady
      return clone
    }
    for (const table of ['settings', 'packs', 'sessions', 'attempts', 'exposures', 'reviewStates', 'drafts', 'writingVersions', 'achievements'] as const) {
      const rowsA = (await dbA[table].toArray()).map((row) => (table === 'packs' ? stripReady(row as { resourcesReady?: boolean }) : row))
      const rowsB = (await dbB[table].toArray()).map((row) => (table === 'packs' ? stripReady(row as { resourcesReady?: boolean }) : row))
      expect(rowsB.length).toBe(rowsA.length)
      for (const row of rowsA) {
        expect(rowsB).toContainEqual(row)
      }
    }
    // 音频标缺：有资产包 resourcesReady=false，无资产包 true
    const packs = await dbB.packs.toArray()
    const p1 = packs.find((row) => row.id === 'p1')
    const p2 = packs.find((row) => row.id === 'p2')
    expect(p1?.resourcesReady).toBe(false)
    expect(p2?.resourcesReady).toBe(true)
    // downloadJobs 不在备份中：B 库保持为空（音频需重新下载）
    expect(await dbB.downloadJobs.toArray()).toEqual([])
  })

  it('恢复失败 → 事务回滚，B 原有记录不变', async () => {
    const dbB = await openDb()
    await dbB.settings.add({ id: 'personal', value: { profileId: 'original', grade: null, goal: null, defaultMinutes: 15, timeZone: 'UTC', sound: false, animation: false } })
    await dbB.sessions.add({ id: 's-original', profileId: 'original', unitId: null, slots: [], currentIndex: 0, revision: 1, state: 'active', createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z', studyDay: '2026-09-11' })

    const dbA = await openDb()
    await seedDb(dbA)
    const exported = await exportBackup({ db: dbA, appVersion: '0.1.0' })
    if (!exported.ok) throw new Error('export failed')
    const check = await validateBackupJson({ text: exported.value.json })
    if (!check.ok) throw new Error('validate failed')

    // 注入写失败：achievements 批量写入抛错 → 整个事务回滚
    const original = dbB.achievements.bulkAdd.bind(dbB.achievements)
    dbB.achievements.bulkAdd = () => Promise.reject(new Error('injected failure')) as never
    const restored = await restoreBackup({ db: dbB, envelope: (check as { ok: true; value: Parameters<typeof restoreBackup>[0]['envelope'] }).value })
    dbB.achievements.bulkAdd = original as never
    expect(restored).toMatchObject({ ok: false, error: { code: 'STORAGE_FAILED' } })
    // B 原有记录不变
    const sessions = await dbB.sessions.toArray()
    expect(sessions.map((row) => row.id)).toEqual(['s-original'])
    const attempts = await dbB.attempts.toArray()
    expect(attempts).toEqual([])
    const settings = await dbB.settings.toArray()
    expect(settings.map((row) => row.id)).toEqual(['personal'])
  })
})