// CR3：packs 表读取缓存。pack JSON 为 MB 级大对象，此前每次切题/提交都全表扫描 3-4 遍。
// 缓存按 db 实例隔离（WeakMap，测试多库互不污染）。
// 失效机制唯一：createDatabase 注册 packs 表 CRUD 钩子，任何写路径（服务层、测试直写、
// 恢复备份）提交后缓存自动失效，不依赖写侧手动调用。
import type { GaokaoDatabase } from './db'
import type { InstalledPack } from './migrations'

interface PackCache { loaded: boolean; rows: Map<string, InstalledPack> }

const caches = new WeakMap<GaokaoDatabase, PackCache>()

const cacheFor = (db: GaokaoDatabase): PackCache => {
  let cache = caches.get(db)
  if (cache === undefined) {
    cache = { loaded: false, rows: new Map() }
    caches.set(db, cache)
  }
  return cache
}

const keyOf = (id: string, version: string) => `${id}@${version}`

// 供测试与特殊场景强制失效；常规写路径由 registerPackCacheInvalidation 自动覆盖
export function invalidatePacks(db: GaokaoDatabase): void {
  const cache = caches.get(db)
  if (cache !== undefined) {
    cache.loaded = false
    cache.rows.clear()
  }
}

// packs 表任何 CRUD（含 bulkAdd/clear/put/update）都触发失效；钩子在写入事务内同步清空，
// 事务回滚只会导致多一次重读，无正确性影响
export function registerPackCacheInvalidation(db: GaokaoDatabase): void {
  db.packs.hook('creating', () => invalidatePacks(db))
  db.packs.hook('updating', () => invalidatePacks(db))
  db.packs.hook('deleting', () => invalidatePacks(db))
}

export async function allPackRecords(db: GaokaoDatabase): Promise<InstalledPack[]> {
  const cache = cacheFor(db)
  if (!cache.loaded) {
    const rows = await db.packs.toArray()
    cache.rows.clear()
    for (const row of rows) cache.rows.set(keyOf(row.id, row.version), row)
    cache.loaded = true
  }
  return [...cache.rows.values()]
}

export async function findInstalledRecord(
  db: GaokaoDatabase,
  ref: { packId: string; packVersion: string },
): Promise<InstalledPack | undefined> {
  const records = await allPackRecords(db)
  return records.find((record) => record.id === ref.packId && record.version === ref.packVersion && record.status === 'installed' && record.resourcesReady)
}

// 会话槽位引用的每个包都必须 installed 且条目存在（loadSession 的内容完整性校验）
export async function verifyInstalledRefs(
  db: GaokaoDatabase,
  refs: Array<{ packId: string; packVersion: string; itemId: string }>,
  itemExists: (pack: unknown, itemId: string) => boolean,
): Promise<boolean> {
  const records = await allPackRecords(db)
  return refs.every((ref) => {
    const record = records.find((candidate) => candidate.id === ref.packId && candidate.version === ref.packVersion && candidate.status === 'installed' && candidate.resourcesReady)
    return record !== undefined && itemExists(record.pack, ref.itemId)
  })
}
