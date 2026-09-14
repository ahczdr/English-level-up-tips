// T16：构建版本信息汇总——应用版本、构建 SHA、内容包版本在页面可确认（不能只看本机构建日志）。
export interface ReleaseCatalog {
  packs: { id: string; version: string; sha256: string }[]
}

export interface ReleasePackInfo {
  id: string
  version: string
  sha256: string
}

export interface ReleaseInfo {
  appVersion: string
  buildSha: string
  packs: ReleasePackInfo[]
}

export const shortenSha = (sha: string): string => (sha === 'unversioned' ? 'unversioned' : sha.length >= 8 ? sha.slice(0, 8) : 'unknown')

export const collectReleaseInfo = (input: { appVersion: string; buildSha: string; catalog: ReleaseCatalog }): ReleaseInfo => ({
  appVersion: input.appVersion,
  buildSha: shortenSha(input.buildSha),
  packs: input.catalog.packs.map((pack) => ({
    id: pack.id,
    version: pack.version,
    sha256: shortenSha(pack.sha256),
  })),
})
export const readBuildInfo = (): { appVersion: string; buildSha: string } => ({
  appVersion: globalThis.__APP_VERSION__ ?? 'unversioned',
  buildSha: globalThis.__BUILD_SHA__ ?? 'unversioned',
})
