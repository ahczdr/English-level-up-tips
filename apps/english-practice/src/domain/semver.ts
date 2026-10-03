// 语义化版本比较的唯一实现（src 侧）。scripts/sync-e2e-fixtures.mjs 为 Node 侧独立副本，语义须保持一致。
export const compareSemver = (left: string, right: string): number => {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10) || 0)
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}
