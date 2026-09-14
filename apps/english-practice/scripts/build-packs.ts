import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validatePack } from '../src/content/validate'
import { assembleCoursePack } from '../src/content/repository'
import type { CoursePack } from '../src/content/types'
import { examProfileSchema } from '../src/content/schema'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fsAvailable = (filePath: string): boolean => {
  try {
    statSync(filePath)
    return true
  } catch {
    return false
  }
}

const manifestDir = path.join(appRoot, 'content', 'pack-manifests')


const publicRoot = path.join(appRoot, 'public')
const outputRoot = path.join(publicRoot, 'content-packs')
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

const readJson = async (filePath: string): Promise<unknown> => JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown

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
  const sources = await readCatalog('sources')
  const assets = await readCatalog('assets')
  const select = (name: string, catalog: unknown[]) => ids(name).map((id) => {
    const item = catalog.find((candidate) => (candidate as { id?: string }).id === id)
    if (!item) throw new Error(`manifest 引用的 ${name} 不存在：${id}`)
    return item
  })
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
    sources: select('source', sources) as CoursePack['sources'],
    assets: select('asset', assets) as CoursePack['assets'],
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

const main = async () => {
  const manifestNames = (await fs.readdir(manifestDir)).filter((name) => name.endsWith('.json')).sort()
  const packs: CoursePack[] = []
  for (const manifestName of manifestNames) {
    const manifest = await readJson(path.join(manifestDir, manifestName)) as Record<string, unknown>
    const pack = await readAuthorPack(manifest)
    const result = validatePack(pack, 'preview')
    if (!result.ok) throw new Error(result.errors.map((item) => `${item.path} [${item.code}] ${item.messageZh}`).join('\n'))
    await checkAssetFiles(pack)
    packs.push(pack as CoursePack)
  }

  const staging = path.join(publicRoot, `.content-stage-${process.pid}`)
  await fs.rm(staging, { recursive: true, force: true })
  await fs.mkdir(staging, { recursive: true })
  if (await fs.stat(outputRoot).catch(() => null)) {
    await fs.cp(outputRoot, path.join(staging, 'content-packs'), { recursive: true })
  }
  const existingCatalogPath = path.join(publicRoot, 'content-catalog.json')
  const existingCatalog = await fs.readFile(existingCatalogPath, 'utf8').then((value) => JSON.parse(value) as { packs?: Array<{ id: string; version: string; status: string; bytes: number; sha256: string; path: string }> }).catch(() => ({ packs: [] }))
  const catalog = existingCatalog.packs ?? []

  try {
    for (const pack of packs) {
      const content = json(pack)
      const bytes = Buffer.byteLength(content)
      const sha256 = crypto.createHash('sha256').update(content).digest('hex')
      const relativePath = `content-packs/${pack.id}/${pack.version}/pack.json`
      const existingPath = path.join(outputRoot, `${pack.id}/${pack.version}/pack.json`)
      try {
        const existing = await fs.readFile(existingPath, 'utf8')
        if (existing !== content) {
          throw new Error(`拒绝覆盖不可变内容版本：${pack.id}@${pack.version}`)
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.message.startsWith('拒绝覆盖')) throw error
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const target = path.join(staging, relativePath)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, content, 'utf8')
      for (const asset of pack.assets) {
        const sourceAsset = path.resolve(appRoot, 'content', asset.path)
        const targetAsset = path.join(staging, `content-packs/${pack.id}/${pack.version}`, asset.path)
        await fs.mkdir(path.dirname(targetAsset), { recursive: true })
        await fs.copyFile(sourceAsset, targetAsset)
      }
      const entry = { id: pack.id, version: pack.version, status: pack.status, bytes, sha256, path: relativePath }
      const existingIndex = catalog.findIndex((item) => item.id === pack.id && item.version === pack.version)
      if (existingIndex >= 0) catalog[existingIndex] = entry
      else catalog.push(entry)
    }
    await fs.writeFile(path.join(staging, 'content-catalog.json'), json({ packs: catalog }), 'utf8')
    await fs.mkdir(path.dirname(outputRoot), { recursive: true })
    await fs.rm(outputRoot, { recursive: true, force: true })
    await fs.rename(path.join(staging, 'content-packs'), outputRoot)
    await fs.rename(path.join(staging, 'content-catalog.json'), path.join(publicRoot, 'content-catalog.json'))

    // T15：同步生成 src/data/fixtures（E2E 构建静态 ?raw 导入用；版本无关的扁平 pack.json）。
    // 不含音频字节；catalog 原样内联，下载链路校验在 fixtures 模式下依旧全量生效。
    const fixturesRoot = path.join(appRoot, 'src', 'data', 'fixtures')
    await fs.mkdir(fixturesRoot, { recursive: true })
    await fs.copyFile(path.join(publicRoot, 'content-catalog.json'), path.join(fixturesRoot, 'content-catalog.json'))
    const outputPacks = path.join(appRoot, 'public', 'content-packs')
    for (const packId of await fs.readdir(outputPacks)) {
      const versions = await fs.readdir(path.join(outputPacks, packId))
      const latest = versions.sort().at(-1)
      if (!latest) continue
      const packFile = path.join(outputPacks, packId, latest, 'pack.json')
      if (!fsAvailable(packFile)) continue
      await fs.mkdir(path.join(fixturesRoot, packId), { recursive: true })
      await fs.copyFile(packFile, path.join(fixturesRoot, packId, 'pack.json'))
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }

  console.log(`内容打包完成：${catalog.length} 个包`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
