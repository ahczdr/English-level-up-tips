import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import samplePack from '../fixtures/sample-pack.json'
import { assembleCoursePack } from '../../src/content/repository'
import { validatePack } from '../../src/content/validate'
import type { CoursePack, GapsItem, OrderItem } from '../../src/content/types'

const clonePack = (): CoursePack => structuredClone(samplePack) as unknown as CoursePack

it('accepts a valid preview pack but rejects the draft for release', () => {
  expect(validatePack(samplePack, 'preview')).toEqual({ ok: true, errors: [] })
  const release = validatePack(samplePack, 'release')
  expect(release.ok).toBe(false)
  expect(release.errors.some((item) => item.code === 'RELEASE_GATE')).toBe(true)
})

it('rejects an answer option that does not exist', () => {
  const bad = clonePack()
  if (bad.items[0].kind !== 'choice') {
    throw new Error('fixture must be a choice item')
  }
  bad.items[0].answerOptionId = 'missing'
  const result = validatePack(bad, 'preview')
  expect(result.ok).toBe(false)
  expect(result.errors.some((item) => item.code === 'INVALID_ANSWER')).toBe(true)
})

it('rejects duplicate item IDs', () => {
  const bad = clonePack()
  bad.items.push(structuredClone(bad.items[0]))
  const result = validatePack(bad, 'preview')
  expect(result.errors.some((item) => item.code === 'DUPLICATE_ID')).toBe(true)
})

it('rejects missing references and invalid order answers', () => {
  const missing = clonePack()
  if (missing.items[0].kind !== 'choice') throw new Error('fixture must be a choice item')
  missing.items[0].sourceIds = ['missing-source']
  expect(validatePack(missing, 'preview').errors.some((item) => item.code === 'MISSING_REFERENCE')).toBe(true)

  const { options: _options, answerOptionId: _answerOptionId, kind: _kind, ...orderCommon } = missing.items[0]
  const order: OrderItem = {
    ...orderCommon,
    kind: 'order',
    tokens: [{ id: 'token-a', text: 'Students' }, { id: 'token-b', text: 'learn' }],
    acceptedOrders: [['token-a', 'unknown-token']],
  }
  missing.items = [order]
  const result = validatePack(missing, 'preview')
  expect(result.errors.some((item) => item.code === 'INVALID_ORDER')).toBe(true)
})

it('rejects invalid gap structure and missing listening audio', () => {
  const bad = clonePack()
  if (bad.items[0].kind !== 'choice') throw new Error('fixture must be a choice item')
  const { options: _options, answerOptionId: _answerOptionId, kind: _kind, ...gapCommon } = bad.items[0]
  const gaps: GapsItem = {
    ...gapCommon,
    kind: 'gaps',
    inputMode: 'options',
    sharedOptions: [],
    uniqueOptions: true,
    segments: [{ type: 'gap', gapId: 'missing-gap' }],
    gaps: [{
      id: 'gap-1',
      label: '1',
      clue: null,
      options: [],
      accepted: [],
      explanationZh: '示例',
    }],
    policy: { caseSensitive: false, allowTerminalPunctuation: false },
  }
  bad.items = [gaps]
  const gapResult = validatePack(bad, 'preview')
  expect(gapResult.errors.some((item) => item.code === 'INVALID_GAP' || item.code === 'MISSING_REFERENCE' || item.code === 'SCHEMA_INVALID')).toBe(true)

  const listening = clonePack()
  if (listening.items[0].kind !== 'choice') throw new Error('fixture must be a choice item')
  listening.items[0].section = 'listening'
  listening.items[0].resourceId = 'res-demo'
  const listeningResult = validatePack(listening, 'preview')
  expect(listeningResult.errors.some((item) => item.code === 'AUDIO_MISSING')).toBe(true)
})

it('rejects invalid evidence and unsafe asset paths', () => {
  const bad = clonePack()
  bad.items[0].explanation.evidence = [
    { resourceId: 'res-demo', paragraphId: 'para-1', quote: 'not in source' },
  ]
  bad.assets = [{
    id: 'asset-demo',
    path: '../secret.mp3',
    mime: 'audio/mpeg',
    bytes: 1,
    sha256: 'a'.repeat(64),
  }]
  const result = validatePack(bad, 'preview')
  expect(result.errors.some((item) => item.code === 'INVALID_EVIDENCE')).toBe(true)
  expect(result.errors.some((item) => item.code === 'UNSAFE_ASSET_PATH')).toBe(true)
})

it('rejects unknown fields through the strict schema', () => {
  const bad = clonePack() as CoursePack & { unexpected?: string }
  bad.unexpected = 'nope'
  const result = validatePack(bad, 'preview')
  expect(result.errors.some((item) => item.code === 'SCHEMA_INVALID')).toBe(true)
})

it('rejects HTML content and non-ISO release timestamps', () => {
  const html = clonePack()
  html.titleZh = '<b>unsafe</b>'
  const htmlResult = validatePack(html, 'preview')
  expect(htmlResult.errors.some((item) => item.code === 'UNSAFE_CONTENT')).toBe(true)

  const release = clonePack()
  release.status = 'published'
  release.reviewer = 'reviewer-demo'
  release.reviewedAt = '2026-09-10'
  const releaseResult = validatePack(release, 'release')
  expect(releaseResult.errors.some((item) => item.code === 'RELEASE_GATE')).toBe(true)
})

it('assembles author files without changing array order', () => {
  const pack = assembleCoursePack({
    pack: {
      schemaVersion: 1,
      id: 'pack-demo',
      version: '1.0.0',
      titleZh: '示例',
      status: 'draft',
      author: 'author',
      reviewer: null,
      reviewedAt: null,
      profileIds: ['profile-demo'],
    },
    sources: [],
    assets: [],
    resources: [],
    items: [],
    units: [],
  })
  expect(pack.id).toBe('pack-demo')
  expect(pack.items).toEqual([])
  expect(pack.units).toEqual([])
})

it('assembles the manifest author files into the demo pack semantics', () => {
  const contentRoot = path.join(process.cwd(), 'content')
  const manifest = JSON.parse(readFileSync(path.join(contentRoot, 'pack-manifests/gaokao-protocol-demo.json'), 'utf8')) as {
    schemaVersion: 1
    id: string
    version: string
    titleZh: string
    status: CoursePack['status']
    author: string
    reviewer: string | null
    reviewedAt: string | null
    profileIds: string[]
    resourceIds: string[]
    itemIds: string[]
    unitIds: string[]
    assetIds?: string[]
  }
  const load = (directory: string, id: string) => JSON.parse(readFileSync(path.join(contentRoot, directory, `${id}.json`), 'utf8')) as unknown
  const pack = assembleCoursePack({
    pack: {
      schemaVersion: 1,
      id: manifest.id,
      version: manifest.version,
      titleZh: manifest.titleZh,
      status: manifest.status,
      author: manifest.author,
      reviewer: manifest.reviewer,
      reviewedAt: manifest.reviewedAt,
      profileIds: manifest.profileIds,
    },
    sources: JSON.parse(readFileSync(path.join(contentRoot, 'sources/catalog.json'), 'utf8')) as CoursePack['sources'],
    // T08 起资产目录含听力样例：与门禁一致按 manifest.assetIds 选取，而不是整目录注入
    assets: (manifest.assetIds ?? [])
      .map((assetId) =>
        (JSON.parse(readFileSync(path.join(contentRoot, 'assets/catalog.json'), 'utf8')) as CoursePack['assets']).find(
          (candidate) => candidate.id === assetId,
        ),
      )
      .filter((asset): asset is CoursePack['assets'][number] => asset !== undefined),
    resources: manifest.resourceIds.map((id) => load('resources', id)) as CoursePack['resources'],
    items: manifest.itemIds.map((id) => load('items', id)) as CoursePack['items'],
    units: manifest.unitIds.map((id) => load('units', id)) as CoursePack['units'],
  })
  expect(pack).toEqual(samplePack)
})
