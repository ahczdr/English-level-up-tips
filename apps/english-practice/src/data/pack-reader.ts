// CR3：packs 表读取缓存。pack JSON 为 MB 级大对象，此前每次切题/提交都全表扫描 3-4 遍。
// 缓存按 db 实例隔离（WeakMap，测试多库互不污染）。
// 失效机制唯一：createDatabase 注册 packs 表 CRUD 钩子，任何写路径（服务层、测试直写、
// 恢复备份）提交后缓存自动失效，不依赖写侧手动调用。
import Dexie from 'dexie'
import type { GaokaoDatabase } from './db'
import type { InstalledPack } from './migrations'
import { compareSemver } from '../domain/semver'

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

// packs 表任何 CRUD（含 bulkAdd/clear/put/update）都触发失效；钩子在写入事务内同步清空。
// CR47：写事务内的读取一律绕过缓存——同一事务内「写后读」会把未提交视图缓存为 loaded=true，
// Dexie 回滚不触发钩子，缓存将驻留脏数据。事务内直读，事务外路径仍享受缓存。
export function registerPackCacheInvalidation(db: GaokaoDatabase): void {
  db.packs.hook('creating', () => invalidatePacks(db))
  db.packs.hook('updating', () => invalidatePacks(db))
  db.packs.hook('deleting', () => invalidatePacks(db))
}

export async function allPackRecords(db: GaokaoDatabase): Promise<InstalledPack[]> {
  // Dexie.currentTransaction 反映当前异步作用域内是否处于事务中（含只读事务）
  if (Dexie.currentTransaction) {
    return db.packs.toArray()
  }
  const cache = cacheFor(db)
  if (!cache.loaded) {
    const rows = await db.packs.toArray()
    cache.rows.clear()
    for (const row of rows) cache.rows.set(keyOf(row.id, row.version), row)
    cache.loaded = true
  }
  return [...cache.rows.values()]
}

// CR46：多版本并存时计划/组合入口只取每个 packId 的最新版本，避免同单元重复成组、
// 旧版本曝光与新版本互不命中。口径与旧 installed() 一致：仅 installed 且资源就绪的包
// 可进入计划/组合（未就绪的音频包进入计划会让整场会话卡在内容校验）。
// 旧版本记录仍保留给历史会话（loadSession 按精确版本取包）。
export function latestInstalledByPackId(records: InstalledPack[]): InstalledPack[] {
  const latest = new Map<string, InstalledPack>()
  for (const record of records) {
    if (record.status !== 'installed' || !record.resourcesReady) continue
    const current = latest.get(record.id)
    if (!current || compareSemver(record.version, current.version) > 0) latest.set(record.id, record)
  }
  return [...latest.values()]
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
