import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { createDatabase, deleteDatabase, type GaokaoDatabase } from '../../src/data/db'
import { allPackRecords, findInstalledRecord, invalidatePacks } from '../../src/data/pack-reader'

const databases: GaokaoDatabase[] = []

afterEach(async () => {
  while (databases.length > 0) await deleteDatabase(databases.pop()!)
})

const openDb = async () => {
  const db = createDatabase(`gaokao-pack-reader-${crypto.randomUUID()}`)
  await db.open()
  databases.push(db)
  return db
}

const packRecord = (id: string, resourcesReady = true) => ({
  id,
  version: '1.0.0',
  status: 'installed',
  pack: { id, version: '1.0.0' },
  installedAt: '2026-09-10T00:00:00.000Z',
  resourcesReady,
})

describe('CR3 packs 读取缓存', () => {
  it('CR3 新失效机制：packs 表 CRUD 钩子自动失效——直写（add/put/update/clear）后立即可见', async () => {
    const db = await openDb()
    await db.packs.add(packRecord('p1'))
    expect(await allPackRecords(db)).toHaveLength(1)
    await db.packs.add(packRecord('p2'))
    expect(await allPackRecords(db)).toHaveLength(2)
    await db.packs.update(['p1', '1.0.0'], { status: 'downloading' })
    expect((await allPackRecords(db)).find((row) => row.id === 'p1')?.status).toBe('downloading')
    await db.packs.clear()
    expect(await allPackRecords(db)).toHaveLength(0)
    // invalidatePacks 保留为手动逃生口（测试/特殊场景），行为幂等
    invalidatePacks(db)
    expect(await allPackRecords(db)).toHaveLength(0)
  })

  it('findInstalledRecord 只返回 installed 且 resourcesReady 的记录', async () => {
    const db = await openDb()
    await db.packs.add(packRecord('p1'))
    await db.packs.add(packRecord('p2', false))
    await db.packs.put({ ...packRecord('p3'), status: 'downloading' })
    expect((await findInstalledRecord(db, { packId: 'p1', packVersion: '1.0.0' }))?.id).toBe('p1')
    expect(await findInstalledRecord(db, { packId: 'p2', packVersion: '1.0.0' })).toBeUndefined()
    expect(await findInstalledRecord(db, { packId: 'p3', packVersion: '1.0.0' })).toBeUndefined()
    expect(await findInstalledRecord(db, { packId: 'missing', packVersion: '1.0.0' })).toBeUndefined()
    // update 钩子即时失效：resourcesReady 置 false 后立即不可读，无需手动失效
    await db.packs.update(['p1', '1.0.0'], { resourcesReady: false })
    expect(await findInstalledRecord(db, { packId: 'p1', packVersion: '1.0.0' })).toBeUndefined()
  })

  it('缓存按 db 实例隔离', async () => {
    const first = await openDb()
    const second = await openDb()
    await first.packs.add(packRecord('p1'))
    expect(await allPackRecords(first)).toHaveLength(1)
    expect(await allPackRecords(second)).toHaveLength(0)
  })
})