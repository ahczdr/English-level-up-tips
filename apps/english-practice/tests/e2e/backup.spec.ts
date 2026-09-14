import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// T13（D09/D10）：导出 → 清除学习数据 → 导入恢复全链路（dev 服务器，IndexedDB 真实读写）

const makeTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 't13-backup-'))

const prepareContent = async (page: Page): Promise<void> => {
  await page.goto('/')
  await page.getByRole('button', { name: '开始今日练习', exact: true }).click()
  await page.getByRole('link', { name: '前往课程列表' }).click()
  await page.getByRole('button', { name: '准备课程内容' }).click()
  await page.locator('.unit-card').first().waitFor()
}

const doOneAttempt = async (page: Page): Promise<void> => {
  // 产生至少一条练习会话与作答记录（复用 T05 已验证流程：课程页直接开 5 分钟短单元）
  const card = page.locator('.unit-card', { hasText: '校园社团：协议演示' })
  await expect(card).toBeVisible()
  await card.click()
  await page.getByRole('button', { name: '5 分钟', exact: true }).click()
  await page.getByRole('button', { name: '开始练习', exact: true }).click()
  await page.locator('.session-progress').waitFor()
  await page.getByRole('button', { name: '加入', exact: true }).click()
  await page.getByRole('button', { name: '提交答案', exact: true }).click()
  await expect(page.getByText('回答正确', { exact: true })).toBeVisible()
}

const exportViaUi = async (page: Page): Promise<{ json: string; digest: string; filePath: string }> => {
  await page.goto('/#/backup')
  await page.locator('.backup-page').waitFor()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出备份文件' }).click()
  const download = await downloadPromise
  const filePath = path.join(makeTempDir(), 'backup.json')
  await download.saveAs(filePath)
  const json = fs.readFileSync(filePath, 'utf8')
  const parsed = JSON.parse(json) as { payloadSha256: string; payload: Record<string, unknown[]> }
  expect(parsed.payload.attempts.length).toBeGreaterThan(0)
  return { json, digest: parsed.payloadSha256, filePath }
}

test.describe('T13 备份导出与恢复', () => {
  test('导出 → 清除学习数据 → 导入恢复 → 摘要一致、音频标缺', async ({ page }) => {
    await prepareContent(page)
    await doOneAttempt(page)

    const first = await exportViaUi(page)

    // 清除学习数据（二次确认，独立于缓存）
    await page.goto('/#/settings')
    await page.locator('.settings-page').waitFor()
    await page.getByRole('button', { name: '清除学习数据…' }).click()
    await page.getByRole('button', { name: '确认清除（不可恢复）' }).click()
    await expect(page.locator('.settings-message')).toHaveText('学习数据已清除（课程与音频保留）')

    // 导入恢复：校验 → 展示数量 → 确认
    await page.goto('/#/backup')
    await page.locator('.backup-page').waitFor()
    await page.locator('.backup-file-input').setInputFiles(first.filePath)
    await expect(page.locator('.backup-summary')).toContainText('练习会话')
    await page.getByRole('button', { name: '确认恢复（替换当前数据）' }).click()
    await page.waitForFunction(() => {
      const nodes = document.querySelectorAll('.backup-message')
      return Array.from(nodes).some((el) => (el.textContent ?? '').includes('恢复完成'))
    }, undefined, { timeout: 15000 })
    await expect(page.locator('.backup-message', { hasText: '恢复完成' })).toBeVisible()
    await expect(page.locator('.backup-message', { hasText: '音频需重新下载' })).toBeVisible()

    // 恢复后音频标缺：下载页显示待重新下载
    await page.goto('/#/downloads')
    const row = page.locator('.download-row', { hasText: '听力起步样例包' })
    await expect(row.locator('.download-status')).toHaveText('待重新下载')

    // 再导出：payload 摘要与首次一致（逐表内容相等）
    const second = await exportViaUi(page)
    expect(second.digest).toBe(first.digest)
  })

  test('损坏摘要的备份被拒绝，原库不变', async ({ page }) => {
    await prepareContent(page)
    await doOneAttempt(page)
    const first = await exportViaUi(page)
    const parsed = JSON.parse(first.json) as Record<string, unknown>
    parsed.payloadSha256 = 'deadbeef'
    const corruptedPath = path.join(makeTempDir(), 'corrupted.json')
    fs.writeFileSync(corruptedPath, JSON.stringify(parsed))

    await page.goto('/#/backup')
    await page.locator('.backup-page').waitFor()
    await page.locator('.backup-file-input').setInputFiles(corruptedPath)
    await expect(page.locator('.backup-block', { hasText: '导入恢复' }).locator('.backup-message')).toContainText('摘要不匹配')
    await expect(page.getByRole('button', { name: '确认恢复（替换当前数据）' })).toHaveCount(0)
  })
})
