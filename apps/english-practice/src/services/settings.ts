import type { GaokaoDatabase } from '../data/db'

export type GradeLevel = '高一' | '高二' | '高三'

export interface PersonalSettings {
  profileId: string
  grade: GradeLevel | null
  goal: string | null
  defaultMinutes: 5 | 10 | 15 | 25
  timeZone: string
  sound: boolean
  animation: boolean
}

export const DEFAULT_PERSONAL_SETTINGS: PersonalSettings = {
  profileId: 'gaokao-common-training-v1',
  grade: null,
  goal: null,
  defaultMinutes: 10,
  timeZone: 'Asia/Shanghai',
  sound: true,
  animation: true,
}

const isGrade = (value: unknown): value is GradeLevel =>
  value === '高一' || value === '高二' || value === '高三'

const isMinutes = (value: unknown): value is PersonalSettings['defaultMinutes'] =>
  value === 5 || value === 10 || value === 15 || value === 25

export async function loadPersonalSettings(db: GaokaoDatabase): Promise<PersonalSettings> {
  try {
    const record = await db.settings.get('personal')
    const value = (record?.value ?? {}) as Partial<PersonalSettings>
    return {
      profileId: typeof value.profileId === 'string' && value.profileId !== '' ? value.profileId : DEFAULT_PERSONAL_SETTINGS.profileId,
      grade: isGrade(value.grade) ? value.grade : null,
      goal: typeof value.goal === 'string' && value.goal.trim() !== '' ? value.goal : null,
      defaultMinutes: isMinutes(value.defaultMinutes) ? value.defaultMinutes : DEFAULT_PERSONAL_SETTINGS.defaultMinutes,
      timeZone: typeof value.timeZone === 'string' && value.timeZone !== '' ? value.timeZone : DEFAULT_PERSONAL_SETTINGS.timeZone,
      sound: typeof value.sound === 'boolean' ? value.sound : DEFAULT_PERSONAL_SETTINGS.sound,
      animation: typeof value.animation === 'boolean' ? value.animation : DEFAULT_PERSONAL_SETTINGS.animation,
    }
  } catch {
    return DEFAULT_PERSONAL_SETTINGS
  }
}

export async function savePersonalSettings(db: GaokaoDatabase, settings: PersonalSettings): Promise<void> {
  await db.settings.put({ id: 'personal', value: settings })
}
