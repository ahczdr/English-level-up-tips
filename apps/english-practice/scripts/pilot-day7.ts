// T17：第 7 天平行题抽取 CLI——用法：
//   tsx scripts/pilot-day7.ts <备份导出.json> [profileId] [count=3]
// 输入为应用「设置 → 备份与恢复」导出的 envelope JSON（format=gaokao-personal-backup）。
// 校验复用 validateBackupJson（含 payloadSha256 摘要核对）；任何失败均非 0 退出，不静默输出空结果。
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { validateBackupJson } from '../src/data/backup'
import { analyzeBackupPayload } from '../src/services/pilot-day7'

export interface PilotIo {
  log: (line: string) => void
  error: (line: string) => void
}

export async function runPilotCli(argv: string[], io: PilotIo): Promise<number> {
  const file = argv[0]
  if (!file) {
    io.error('用法：tsx scripts/pilot-day7.ts <备份导出.json> [profileId] [count=3]')
    return 2
  }
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    io.error('无法读取备份文件：' + file)
    return 2
  }
  const validated = await validateBackupJson({ text })
  if (!validated.ok) {
    io.error('备份校验失败：' + validated.error.code + '——' + validated.error.messageZh)
    return 2
  }
  const countArg = argv[2] ? Number.parseInt(argv[2], 10) : 3
  if (!Number.isInteger(countArg) || countArg <= 0) {
    io.error('count 必须为正整数：' + String(argv[2]))
    return 2
  }
  const analysis = analyzeBackupPayload({ payload: validated.value.payload as unknown as Parameters<typeof analyzeBackupPayload>[0]['payload'], profileIdArg: argv[1], count: countArg })
  if (!analysis.ok) {
    io.error(analysis.error.code + '——' + analysis.error.messageZh)
    return 3
  }
  io.log(JSON.stringify(analysis.value, null, 2))
  if (analysis.value.gaps.length > 0) {
    io.error('缺口（never-practiced=该技能从未练过 / no-unseen-candidate=练过但同技能同层级无未曝光平行题）：')
    for (const gap of analysis.value.gaps) io.error('  ' + gap.key + ' → ' + gap.reason)
  }
  for (const warning of analysis.value.warnings) io.error('警告：' + warning)
  return 0
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  void runPilotCli(process.argv.slice(2), { log: (line) => console.log(line), error: (line) => console.error(line) }).then((code) => {
    process.exitCode = code
  })
}