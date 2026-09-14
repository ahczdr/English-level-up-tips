import { describe, expect, it } from 'vitest'
import { analyzeBackupPayload, type BackupPayloadLike } from '../../src/services/pilot-day7'
import { runPilotCli } from '../../scripts/pilot-day7'
import { canonicalJsonString, sha256Hex, BACKUP_FORMAT, BACKUP_SCHEMA_VERSION } from '../../src/data/backup'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Item } from '../../src/content/types'

const item = (id: string, familyId: string, level: 'G0' | 'G1' | 'G2', skillIds: string[]): Item =>
  ({ id, familyId, level, skillIds, kind: 'choice', section: 'cloze', reviewMode: 'recog', promptZh: '', resourceId: null, estimatedSeconds: 60, sourceIds: [], explanation: { summaryZh: '', ruleZh: '', evidence: [], distractors: [] }, options: [], answerOptionId: 'a' } as unknown as Item)

const exp = (itemId: string, profileId: string) => ({ packId: 'p1', packVersion: '1.0.0', itemId, familyId: 'f1', profileId, firstSeenAt: '2026-09-10T00:00:00.000Z', studyDay: '2026-09-10', firstSeenSessionId: 's1' })

const packRow = (id: string, version: string, items: Item[]) => ({ id, version, status: 'installed', pack: { id, version, items }, installedAt: '', resourcesReady: true })

describe('T17 评审修复：analyzeBackupPayload', () => {
  it('R3：同包多版本并存的同一题只出现一次', () => {
    const payload: BackupPayloadLike = {
      packs: [packRow('p1', '1.0.0', [item('v1', 'f1', 'G0', ['s-x']), item('v2', 'f1', 'G0', ['s-x'])]), packRow('p1', '1.0.1', [item('v1', 'f1', 'G0', ['s-x'])])],
      exposures: [exp('v1', 'pa')],
    }
    const analysis = analyzeBackupPayload({ payload })
    expect(analysis.ok).toBe(true)
    if (!analysis.ok) return
    expect(analysis.value.suggestions['s-x@G0'].ids).toEqual(['v2'])
  })

  it('R2：多 profile 无显式参数报错、显式参数生效、输出 profile 计数', () => {
    const payload: BackupPayloadLike = { packs: [packRow('p1', '1.0.0', [item('a1', 'f1', 'G0', ['s-x'])])], exposures: [exp('a1', 'pa'), exp('a1', 'pb')] }
    const multi = analyzeBackupPayload({ payload })
    expect(multi.ok).toBe(false)
    if (multi.ok) return
    expect(multi.error.code).toBe('PROFILE_REQUIRED')
    const explicit = analyzeBackupPayload({ payload, profileIdArg: 'pb' })
    expect(explicit.ok).toBe(true)
    if (!explicit.ok) return
    expect(explicit.value.profiles).toEqual({ pa: 1, pb: 1 })
    expect(explicit.value.exposedCount).toBe(1)
  })

  it('R1：空曝光/空条目 loud fail', () => {
    const noExp: BackupPayloadLike = { packs: [packRow('p1', '1.0.0', [item('a1', 'f1', 'G0', ['s-x'])])], exposures: [] }
    expect(analyzeBackupPayload({ payload: noExp }).ok).toBe(false)
    const noItems: BackupPayloadLike = { packs: [], exposures: [exp('a1', 'pa')] }
    expect(analyzeBackupPayload({ payload: noItems }).ok).toBe(false)
  })

  it('R7：旧 schema（全部曝光行缺 profileId）→ OLD_SCHEMA 错误而非静默全未曝光', () => {
    const payload: BackupPayloadLike = { packs: [packRow('p1', '1.0.0', [item('a1', 'f1', 'G0', ['s-x'])])], exposures: [{ packId: 'p1', packVersion: '1.0.0', itemId: 'a1', familyId: 'f1' }] }
    const analysis = analyzeBackupPayload({ payload })
    expect(analysis.ok).toBe(false)
    if (analysis.ok) return
    expect(analysis.error.code).toBe('OLD_SCHEMA')
  })

  it('R7b：部分行缺 profileId → 告警且不计入，其余 profile 正常', () => {
    const payload: BackupPayloadLike = { packs: [packRow('p1', '1.0.0', [item('a1', 'f1', 'G0', ['s-x'])])], exposures: [{ packId: 'p1', packVersion: '1.0.0', itemId: 'a1', familyId: 'f1' }, exp('a1', 'pa')] }
    const analysis = analyzeBackupPayload({ payload })
    expect(analysis.ok).toBe(true)
    if (!analysis.ok) return
    expect(analysis.value.warnings.join(' ')).toContain('profileId')
    expect(analysis.value.profiles).toEqual({ pa: 1 })
  })

  it('R2：缺口语义区分 never-practiced 与 no-unseen-candidate', () => {
    const payload: BackupPayloadLike = {
      packs: [packRow('p1', '1.0.0', [item('e1', 'f1', 'G0', ['s-done']), item('e2', 'f2', 'G0', ['s-done']), item('e3', 'f3', 'G0', ['s-new'])])],
      exposures: [exp('e1', 'pa')],
    }
    const analysis = analyzeBackupPayload({ payload })
    expect(analysis.ok).toBe(true)
    if (!analysis.ok) return
    const byKey = new Map(analysis.value.gaps.map((g) => [g.key, g.reason]))
    expect(byKey.get('s-done@G0')).toBe('no-unseen-candidate')
    expect(byKey.get('s-new@G0')).toBe('never-practiced')
  })

  it('R4：多技能题在建议中标注 alsoCovers', () => {
    const payload: BackupPayloadLike = {
      packs: [packRow('p1', '1.0.0', [item('m0', 'f1', 'G0', ['s-a']), item('m1', 'f1', 'G0', ['s-a', 's-b'])])],
      exposures: [exp('m0', 'pa')],
    }
    const analysis = analyzeBackupPayload({ payload })
    expect(analysis.ok).toBe(true)
    if (!analysis.ok) return
    expect(analysis.value.suggestions['s-a@G0'].alsoCovers).toContain('s-b')
  })
})

describe('T17 评审修复：CLI 主流程（envelope 校验拆包，B1）', () => {
  const writeBackup = async (payload: unknown): Promise<string> => {
    const envelope = { format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: '2026-09-17T00:00:00.000Z', appVersion: '0.1.0', payloadSha256: await sha256Hex(canonicalJsonString(payload)), payload }
    const dir = mkdtempSync(join(tmpdir(), 'pilot-cli-'))
    const file = join(dir, 'backup.json')
    writeFileSync(file, JSON.stringify(envelope))
    return file
  }

  it('B1：envelope 形状备份走通主流程（此前静默空输出）', async () => {
    const session = { id: 's1', profileId: 'pa', unitId: null, slots: [], currentIndex: 0, revision: 0, state: 'completed', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z', studyDay: '2026-09-10' }
    const payload = { settings: [], packs: [packRow('p1', '1.0.0', [item('i1', 'f1', 'G0', ['s-x']), item('i2', 'f1', 'G0', ['s-x'])])], sessions: [session], attempts: [], exposures: [exp('i1', 'pa')], reviewStates: [], drafts: [], writingVersions: [], achievements: [] }
    const file = await writeBackup(payload)
    const lines: string[] = []
    const code = await runPilotCli([file], { log: (l) => lines.push(l), error: (l) => lines.push('ERR:' + l) })
    expect(code).toBe(0)
    const output = lines.join('\n')
    expect(output).toContain('"exposedCount": 1')
    expect(output).toContain('"i2"')
  })

  it('B1/R1：空曝光 → 非 0 退出且报错', async () => {
    const payload = { settings: [], packs: [packRow('p1', '1.0.0', [item('i1', 'f1', 'G0', ['s-x'])])], sessions: [], attempts: [], exposures: [], reviewStates: [], drafts: [], writingVersions: [], achievements: [] }
    const file = await writeBackup(payload)
    const lines: string[] = []
    const code = await runPilotCli([file], { log: (l) => lines.push(l), error: (l) => lines.push(l) })
    expect(code).not.toBe(0)
    expect(lines.join('\n')).toContain('NO_EXPOSURES')
  })

  it('格式错误文件 → 非 0 退出', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-cli-'))
    const file = join(dir, 'bad.json')
    writeFileSync(file, '{"format":"nope"}')
    const lines: string[] = []
    const code = await runPilotCli([file], { log: (l) => lines.push(l), error: (l) => lines.push(l) })
    expect(code).toBe(2)
    expect(lines.join('\n')).toContain('INVALID_FORMAT')
  })
})