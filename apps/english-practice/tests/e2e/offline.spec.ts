import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

test('构建产物：precache 仅 shell，不含题库（T12 checkbox 1，缺口13）', () => {
  const swSource = fs.readFileSync(path.resolve(process.cwd(), 'dist/sw.js'), 'utf8')
  expect(swSource.includes('content-packs')).toBe(false)
  expect(swSource).toContain('content-catalog.json')
})

// T12（D09）离线验证：生产构建 + Service Worker。
// 断网刷新须能打开已下载题目；音频字节在本地 IndexedDB（T08），
// 断网时音频资源路径不再依赖 HTTP（用负向断言证明资源 URL 不在离线播放链路上）。

const waitSwControlled = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    if (navigator.serviceWorker.controller) return
    // 首次注册后等待 claim
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
      void registration
      setTimeout(() => resolve(), 3000)
    })
  })
}

const prepareContent = async (page: Page): Promise<void> => {
  await page.goto('/')
  await page.getByRole('button', { name: '开始今日练习', exact: true }).click()
  await page.getByRole('link', { name: '前往课程列表' }).click()
  await page.getByRole('button', { name: '准备课程内容' }).click()
  await page.locator('.unit-card').first().waitFor()
}

test.describe('T12 离线（生产构建）', () => {
  test('断网刷新后应用 shell 可用', async ({ page }) => {
    await page.goto('/')
    await page.locator('.app-shell').waitFor()
    await waitSwControlled(page)
    await page.context().setOffline(true)
    try {
      await page.reload()
      await expect(page.locator('.app-shell h1')).toHaveText('高考英语练习')
      await expect(page.getByRole('heading', { name: '今日练习' })).toBeVisible()
    } finally {
      await page.context().setOffline(false)
    }
  })

  test('下载音频后断网刷新：下载页显示已就绪，今日课程可打开', async ({ page }) => {
    await prepareContent(page)

    // 通过下载页下载听力包音频资源（真实 HTTP + hash 校验）
    await page.goto('/#/downloads')
    await page.locator('.downloads-page').waitFor()
    const row = page.locator('.download-row', { hasText: '听力起步样例包' })
    await expect(row).toBeVisible()
    await expect(row.locator('.download-status')).toHaveText('待重新下载')
    await row.locator('.download-start').click()
    await expect(page.locator('.downloads-message')).toHaveText('音频下载完成，可以离线练习。', { timeout: 15000 })
    await expect(row.locator('.download-status')).toHaveText('已就绪')

    await waitSwControlled(page)

    // 断网：shell + 已下载内容全部本地可用
    await page.context().setOffline(true)
    try {
      await page.reload()
      await page.locator('.downloads-page').waitFor()
      // 启动对账：job 数据仍在 DB → 对账后保持已就绪
      const rowOffline = page.locator('.download-row', { hasText: '听力起步样例包' })
      await expect(rowOffline.locator('.download-status')).toHaveText('已就绪')

      // 题目来自 IndexedDB 中的课程 JSON，断网可打开
      await page.goto('/#/today')
      await page.getByRole('button', { name: '开始今日计划', exact: true }).click()
      await expect(page.locator('.session-progress')).toBeVisible({ timeout: 15000 })

      // 负向断言：音频 HTTP 路径断网不可达 —— 离线播放完全依赖本地 DB 字节，不经网络
      const audioOffline = await page.evaluate(async () => {
        try {
          await fetch('/content-packs/gaokao-listening/1.0.1/assets/listening-preview.m4a')
          return 'reachable'
        } catch {
          return 'unreachable'
        }
      })
      expect(audioOffline).toBe('unreachable')
    } finally {
      await page.context().setOffline(false)
    }
  })
})