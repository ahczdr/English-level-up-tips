import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validatePack } from '../src/content/validate'
import { assembleCoursePack } from '../src/content/repository'
import type { CoursePack } from '../src/content/types'
import { examProfileSchema } from '../src/content/schema'
import { checkReleaseContent, type GatePack } from './release-gates'
import { curriculumAliasIssues } from '../src/domain/curriculum'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestDir = path.join(appRoot, 'content', 'pack-manifests')

const readJson = async (filePath: string): Promise<unknown> => {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown
}

const readAuthorPack = async (manifest: Record<string, unknown>): Promise<CoursePack> => {
  if (manifest.schemaVersion !== 1) throw new Error('manifest schemaVersion 必须为 1')
  const readCatalog = async (name: string) => readJson(path.join(appRoot, 'content', name, 'catalog.json')) as Promise<unknown[]>
  const byId = async (directory: string, id: string) => {
    const value = await readJson(path.join(appRoot, 'content', directory, `${id}.json`)) as { id?: string }
    if (value.id !== id) throw new Error(`作者文件 ID 不匹配：${directory}/${id}`)
    return value
  }
  const ids = (name: string) => {
    const value = manifest[`${name}Ids`]
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error(`manifest 缺少 ${name}Ids`)
    return value as string[]
  }
  const sourceCatalog = await readCatalog('sources')
  const assetCatalog = await readCatalog('assets')
  const select = async (name: string, catalog: unknown[]) => Promise.all(ids(name).map(async (id) => {
    const item = catalog.find((candidate) => (candidate as { id?: string }).id === id)
    if (!item) throw new Error(`manifest 引用的 ${name} 不存在：${id}`)
    return item
  }))
  for (const profileId of (manifest.profileIds as string[] ?? [])) {
    const profile = await readJson(path.join(appRoot, 'content', 'profiles', `${profileId}.json`))
    const parsed = examProfileSchema.safeParse(profile)
    if (!parsed.success || parsed.data.id !== profileId) throw new Error(`profile 校验失败：${profileId}`)
  }
  return assembleCoursePack({
    pack: {
      schemaVersion: 1,
      id: String(manifest.id),
      version: String(manifest.version),
      titleZh: String(manifest.titleZh),
      status: manifest.status as CoursePack['status'],
      author: String(manifest.author),
      reviewer: (manifest.reviewer as string | null) ?? null,
      reviewedAt: (manifest.reviewedAt as string | null) ?? null,
      profileIds: (manifest.profileIds as string[]) ?? [],
    },
    sources: await select('source', sourceCatalog) as CoursePack['sources'],
    assets: await select('asset', assetCatalog) as CoursePack['assets'],
    resources: await Promise.all(ids('resource').map((id) => byId('resources', id))) as CoursePack['resources'],
    items: await Promise.all(ids('item').map((id) => byId('items', id))) as CoursePack['items'],
    units: await Promise.all(ids('unit').map((id) => byId('units', id))) as CoursePack['units'],
  })
}

const checkAssetFiles = async (pack: CoursePack) => {
  for (const asset of pack.assets) {
    const assetPath = path.resolve(appRoot, 'content', asset.path)
    const relative = path.relative(appRoot, assetPath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`素材路径越界：${asset.path}`)
    const data = await fs.readFile(assetPath)
    const stat = await fs.stat(assetPath)
    const sha256 = crypto.createHash('sha256').update(data).digest('hex')
    if (stat.size !== asset.bytes || sha256 !== asset.sha256) throw new Error(`素材摘要不匹配：${asset.id}`)
  }
}

const checkP07 = (packs: CoursePack[], failures: string[]) => {
  // 演示/引导包（协议教学、三年目录首批样例）不是真题覆盖面，不参与数量与题型形状统计
  const p07ExemptPackIds = new Set(['gaokao-demo', 'gaokao-protocol-demo', 'gaokao-three-years'])
  const published = packs.filter((pack) => pack.status === 'published' && !p07ExemptPackIds.has(pack.id))
  const sectionCounts = new Map<string, number>()
  const families = new Map<string, number>()
  const resources = new Map<string, Set<string>>()
  const resourceLevels = new Map<string, Map<string, Set<string>>>()
  const gapShapes = new Map<string, number[]>()
  const audioAssets = new Set<string>()

  // 真题卷（anhui-*）的单项填空是固定题目，无法为门禁追加平行变体：
  // 其条目计入数量统计，但不参与「词汇族 ≥3 平行题」的课程目标族口径
  const examPaperPackIds = new Set(['anhui-gaokao-2013-cloze-a', 'anhui-gaokao-2013-grammar-a', 'anhui-gaokao-2013-grammar-b', 'anhui-gaokao-2013-reading-a', 'anhui-gaokao-2013-writing-a', 'anhui-gaokao-2014-cloze-a', 'anhui-gaokao-2014-grammar-a', 'anhui-gaokao-2014-grammar-b', 'anhui-gaokao-2014-reading-a', 'anhui-gaokao-2014-writing-a', 'anhui-gaokao-2025-reading-a'])
  for (const pack of published) {
    const isExamPaper = examPaperPackIds.has(pack.id)
    for (const item of pack.items) {
      const amount = item.kind === 'gaps' ? item.gaps.length : item.kind === 'writing' ? 0 : 1
      sectionCounts.set(item.section, (sectionCounts.get(item.section) ?? 0) + amount)
      if (item.section === 'vocabulary' && !isExamPaper) families.set(item.familyId, (families.get(item.familyId) ?? 0) + 1)
      const resourceSet = resources.get(item.section) ?? new Set<string>()
      if (item.resourceId) resourceSet.add(item.resourceId)
      resources.set(item.section, resourceSet)
      if (item.resourceId) {
        const sectionResources = resourceLevels.get(item.section) ?? new Map<string, Set<string>>()
        const resourceLevelsSet = sectionResources.get(item.resourceId) ?? new Set<string>()
        resourceLevelsSet.add(item.level)
        sectionResources.set(item.resourceId, resourceLevelsSet)
        resourceLevels.set(item.section, sectionResources)
      }
      if (item.section === 'application-writing' || item.section === 'continuation') {
        sectionCounts.set(item.section, (sectionCounts.get(item.section) ?? 0) + 1)
      }
      if (item.kind === 'gaps') {
        const shape = gapShapes.get(item.section) ?? []
        shape.push(item.gaps.length)
        gapShapes.set(item.section, shape)
      }
      if (item.section === 'listening' && item.resourceId) {
        const resource = pack.resources.find((candidate) => candidate.id === item.resourceId)
        if (resource?.audioAssetId) audioAssets.add(resource.audioAssetId)
      }
    }
  }

  const minimums: Record<string, number> = {
    vocabulary: 360,
    sentence: 24,
    reading: 54,
    'gap-reading': 30,
    cloze: 100,
    grammar: 120,
    listening: 30,
    'application-writing': 6,
    continuation: 4,
  }
  for (const [section, minimum] of Object.entries(minimums)) {
    if ((sectionCounts.get(section) ?? 0) < minimum) failures.push(`P07.${section} [P07_QUANTITY] 发布数量不足：需要 ${minimum}，实际 ${sectionCounts.get(section) ?? 0}`)
  }
  if (families.size < 120 || [...families.values()].some((count) => count < 3)) failures.push('P07.vocabulary [P07_COVERAGE] 词汇目标必须至少 120 个且每个有 3 个平行题')
  for (const level of ['G0', 'G1', 'G2']) {
    const count = [...(resourceLevels.get('reading')?.values() ?? [])].filter((set) => set.has(level)).length
    if (count < 6) failures.push(`P07.reading.${level} [P07_COVERAGE] 阅读每个层级至少 6 篇`)
  }
  if ([...(resourceLevels.get('reading')?.values() ?? [])].some((set) => set.size > 1)) failures.push('P07.reading [P07_INVALID] 同一篇阅读材料不能跨层级重复计数')
  if ((resources.get('reading')?.size ?? 0) < 18) failures.push('P07.reading [P07_COVERAGE] 阅读至少 18 篇材料')
  if ((resources.get('gap-reading')?.size ?? 0) < 6) failures.push('P07.gap-reading [P07_COVERAGE] 七选五至少需要 6 篇')
  if ((gapShapes.get('gap-reading') ?? []).some((count) => count !== 5)) failures.push('P07.gap-reading [P07_INVALID] 七选五每篇必须恰有 5 空')
  for (const pack of published) {
    for (const item of pack.items) {
      if (item.section === 'gap-reading' && item.kind === 'gaps' && (item.sharedOptions.length !== 7 || !item.uniqueOptions)) failures.push(`P07.${item.id} [P07_INVALID] 七选五必须有 7 个共享选项且 uniqueOptions=true`)
    }
  }
  if ((gapShapes.get('cloze') ?? []).filter((count) => count === 10).length < 4 || (gapShapes.get('cloze') ?? []).filter((count) => count === 15).length < 4) failures.push('P07.cloze [P07_COVERAGE] 完形至少需要 4 篇 10 空和 4 篇 15 空')
  // 20 空为历史安徽卷（2013/2014）完形形状
  if ((gapShapes.get('cloze') ?? []).some((count) => count !== 10 && count !== 15 && count !== 20)) failures.push('P07.cloze [P07_INVALID] 完形每篇必须为 10 空、15 空或历史安徽卷的 20 空')
  if ((gapShapes.get('grammar') ?? []).length < 12) failures.push('P07.grammar [P07_COVERAGE] 语法填空至少需要 12 篇')
  if ((gapShapes.get('grammar') ?? []).some((count) => count !== 10)) failures.push('P07.grammar [P07_INVALID] 语法填空每篇必须恰有 10 空')
  if (audioAssets.size < 20) failures.push('P07.listening [P07_COVERAGE] 听力至少需要 20 段本地录音')
}

const modeIndex = process.argv.indexOf('--mode')
const modeArg = modeIndex >= 0 ? process.argv[modeIndex + 1] : process.argv.find((arg) => arg.startsWith('--mode='))?.split('=')[1]
const mode = modeArg === 'release' ? 'release' : 'preview'
const deferredReleaseCodes = new Set(['RELEASE_GATE', 'P07_QUANTITY', 'P07_COVERAGE', 'REVIEW_MISSING'])

const main = async () => {
  const manifestNames = (await fs.readdir(manifestDir)).filter((name) => name.endsWith('.json')).sort()
  if (manifestNames.length === 0) {
    throw new Error('未找到内容包 manifest')
  }

  const failures: string[] = []
  failures.push(...curriculumAliasIssues().map((issue) => `curriculum [CURRICULUM_ALIAS_INVALID] ${issue}`))
  for (const manifestName of manifestNames) {
    const manifest = await readJson(path.join(manifestDir, manifestName)) as Record<string, unknown>
    const pack = await readAuthorPack(manifest)
    const contentResult = validatePack(pack, 'preview')
    if (contentResult.ok) await checkAssetFiles(pack)
    if (!contentResult.ok) {
      failures.push(...contentResult.errors.map((item) => `${manifestName}:${item.path || '$'} [${item.code}] ${item.messageZh}`))
    }
    if (mode === 'release') {
      const releaseResult = validatePack(pack, 'release')
      failures.push(...releaseResult.errors
        .filter((item) => item.code === 'RELEASE_GATE' || item.code === 'REVIEWED_AT_INVALID')
        .map((item) => `${manifestName}:${item.path || '$'} [${item.code}] ${item.messageZh}`))
    }
  }

  if (mode === 'release') {
    const packs: CoursePack[] = []
    for (const manifestName of manifestNames) {
      const pack = await readAuthorPack(await readJson(path.join(manifestDir, manifestName)) as Record<string, unknown>)
      packs.push(pack)
    }
    checkP07(packs, failures)

    // T15：skills 固定目录 + 平行题干 + 30 次学习计划 + review-log 交叉验证（机器自检不等于审核）
    const sourcesDir = path.join(appRoot, 'content', 'sources')
    const skillsDoc = (await readJson(path.join(sourcesDir, 'skills.json'))) as { skills: { id: string }[] }
    const plan = (await readJson(path.join(sourcesDir, 'learning-plan-30.json'))) as Parameters<typeof checkReleaseContent>[0]['plan']
    const reviewLogCsv = await fs.readFile(path.join(sourcesDir, 'review-log.csv'), 'utf8')
    const gatePacks: GatePack[] = packs.map((pack) => ({
      id: pack.id,
      version: pack.version,
      author: pack.author,
      items: pack.items.map((item) => ({
        id: item.id,
        familyId: item.familyId,
        section: item.section,
        kind: item.kind,
        skillIds: item.skillIds,
        promptZh: item.promptZh,
      })),
    }))
    failures.push(...checkReleaseContent({
      packs: gatePacks,
      skills: skillsDoc.skills.map((skill) => skill.id),
      plan,
      reviewLogCsv,
    }))
    if (failures.length > 0) {
      console.error('\nT15：正式发布门禁未通过——以上审核/内容缺口修复前不得生成正式 catalog。')
    }
  }

  if (failures.length > 0) {
    console.error(failures.join('\n'))
    const onlyDeferredReleaseGaps = mode === 'release' && failures.every((failure) => {
      const code = failure.match(/\[([A-Z0-9_]+)\]/)?.[1]
      return code !== undefined && deferredReleaseCodes.has(code)
    })
    process.exitCode = onlyDeferredReleaseGaps ? 78 : 1
    return
  }
  console.log(`内容检查通过：${manifestNames.length} 个包（${mode}）`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
