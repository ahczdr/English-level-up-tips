import Dexie from 'dexie'
import { configureSchema, type GaokaoDatabaseSchema } from './migrations'
import { registerPackCacheInvalidation } from './pack-reader'

export const DB_NAME = 'gaokao-english-v1'
export type GaokaoDatabase = Dexie & GaokaoDatabaseSchema

export function createDatabase(name: string): GaokaoDatabase {
  const db = new Dexie(name) as GaokaoDatabase
  configureSchema(db)
  // CR3：packs 读取缓存的统一失效入口——任何写路径（服务层/测试直写/恢复）自动失效
  registerPackCacheInvalidation(db)
  return db
}

export async function closeDatabase(db: GaokaoDatabase) {
  db.close()
}

export async function deleteDatabase(db: GaokaoDatabase) {
  db.close()
  await Dexie.delete(db.name)
}

export const db = createDatabase(DB_NAME)
