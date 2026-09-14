import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { createDatabase, deleteDatabase, type GaokaoDatabase } from '../../src/data/db'
import {
  DEFAULT_PERSONAL_SETTINGS,
  loadPersonalSettings,
  savePersonalSettings,
  type PersonalSettings,
} from '../../src/services/settings'

const databases: GaokaoDatabase[] = []
const openDb = () => {
  const db = createDatabase(`gaokao-settings-${crypto.randomUUID()}`)
  databases.push(db)
  return db
}

afterEach(async () => {
  while (databases.length > 0) await deleteDatabase(databases.pop()!)
})

describe('T05 个人设置服务', () => {
  it('未保存时返回默认设置', async () => {
    const db = openDb()
    expect(await loadPersonalSettings(db)).toEqual(DEFAULT_PERSONAL_SETTINGS)
  })

  it('保存后可重新读取相同设置', async () => {
    const db = openDb()
    const settings: PersonalSettings = {
      ...DEFAULT_PERSONAL_SETTINGS,
      grade: '高二',
      goal: '补基础词汇',
      defaultMinutes: 15,
    }
    await savePersonalSettings(db, settings)
    expect(await loadPersonalSettings(db)).toEqual(settings)
  })

  it('部分字段以默认值补齐', async () => {
    const db = openDb()
    await db.settings.put({ id: 'personal', value: { defaultMinutes: 5 } })
    const loaded = await loadPersonalSettings(db)
    expect(loaded.defaultMinutes).toBe(5)
    expect(loaded.profileId).toBe(DEFAULT_PERSONAL_SETTINGS.profileId)
    expect(loaded.grade).toBeNull()
  })

  it('关闭重开后设置仍然保留', async () => {
    const name = `gaokao-settings-reopen-${crypto.randomUUID()}`
    const first = createDatabase(name)
    await savePersonalSettings(first, { ...DEFAULT_PERSONAL_SETTINGS, goal: '听力入门' })
    first.close()
    const second = createDatabase(name)
    databases.push(second)
    expect((await loadPersonalSettings(second)).goal).toBe('听力入门')
  })
})
