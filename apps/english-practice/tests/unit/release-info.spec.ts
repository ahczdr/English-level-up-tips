import { describe, expect, it } from 'vitest'
import { collectReleaseInfo, shortenSha } from '../../src/services/release-info'
import type { ReleaseCatalog } from '../../src/services/release-info'

// T16：构建 SHA、应用版本、内容包版本可在页面确认（不能只看本机构建日志）

const catalog: ReleaseCatalog = {
  packs: [
    { id: 'gaokao-listening', version: '1.0.1', sha256: 'a'.repeat(64) },
    { id: 'gaokao-protocol-demo', version: '0.1.1', sha256: 'b'.repeat(64) },
  ],
}

describe('release-info（T16 版本可确认）', () => {
  it('shortenSha 取 8 位摘要', () => {
    expect(shortenSha('a'.repeat(64))).toBe('aaaaaaaa')
    expect(shortenSha('')).toBe('unknown')
  })

  it('collectReleaseInfo 汇总应用版本、构建 SHA、内容包版本（短摘要）', () => {
    const info = collectReleaseInfo({ appVersion: '0.1.0', buildSha: 'c'.repeat(64), catalog })
    expect(info.appVersion).toBe('0.1.0')
    expect(info.buildSha).toBe('cccccccc')
    expect(info.packs).toEqual([
      { id: 'gaokao-listening', version: '1.0.1', sha256: 'aaaaaaaa' },
      { id: 'gaokao-protocol-demo', version: '0.1.1', sha256: 'bbbbbbbb' },
    ])
  })

  it('缺失 build SHA（本地 dev）→ 标记 unversioned 而不是伪造', () => {
    const info = collectReleaseInfo({ appVersion: '0.1.0', buildSha: 'unversioned', catalog })
    expect(info.buildSha).toBe('unversioned')
  })
})
