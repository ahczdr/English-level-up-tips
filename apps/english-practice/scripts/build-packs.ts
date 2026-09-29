import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validatePack } from '../src/content/validate'
import { assembleCoursePack } from '../src/content/repository'
import type { CoursePack } from '../src/content/types'
import { examProfileSchema } from '../src/content/schema'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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
  // CR60：清理历史 SIGKILL 残留的全部 staging 目录（此前只清自己 pid，残留会被拷进 dist 并出现在 git status）
  for (const entry of await fs.readdir(publicRoot).catch(() => [] as string[])) {
    if (entry.startsWith('.content-stage-')) await fs.rm(path.join(publicRoot, entry), { recursive: true, force: true })
  }
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

  // 每次全新构建：目录与产物只包含当前 manifest 的最新版本，历史版本不保留
  // （不可变保障仍由下方同版本内容比对提供——同 (id, version) 内容变化会被拒绝）。
  const staging = path.join(publicRoot, `.content-stage-${process.pid}`)
  await fs.rm(staging, { recursive: true, force: true })
  await fs.mkdir(staging, { recursive: true })
  const catalog: Array<{ id: string; version: string; status: string; bytes: number; sha256: string; path: string }> = []

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
      catalog.push({ id: pack.id, version: pack.version, status: pack.status, bytes, sha256, path: relativePath })
    }
    await fs.writeFile(path.join(staging, 'content-catalog.json'), json({ packs: catalog }), 'utf8')
    await fs.mkdir(path.dirname(outputRoot), { recursive: true })
    // 原子化换装：旧目录先改名让位（而非先删），packs 就位后再换 catalog，最后清理旧目录——
    // 中途崩溃不会留下「旧 catalog 指向已删除版本」的坏状态
    const retired = path.join(publicRoot, `.content-retired-${process.pid}`)
    await fs.rm(retired, { recursive: true, force: true })
    let retiredOld = false
    if (await fs.stat(outputRoot).catch(() => null)) {
      await fs.rename(outputRoot, retired)
      retiredOld = true
    }
    try {
      await fs.rename(path.join(staging, 'content-packs'), outputRoot)
      await fs.rename(path.join(staging, 'content-catalog.json'), path.join(publicRoot, 'content-catalog.json'))
    } catch (error: unknown) {
      const targetGone = !await fs.stat(outputRoot).catch(() => null)
      if (retiredOld && targetGone) await fs.rename(retired, outputRoot).catch(() => undefined)
      throw error
    }
    await fs.rm(retired, { recursive: true, force: true })

  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }

  console.log(`内容打包完成：${catalog.length} 个包（仅保留当前 manifest 版本）`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
