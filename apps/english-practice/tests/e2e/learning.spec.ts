import { expect, test, type Page } from '@playwright/test'

// T14：基本学习页面回归（生产构建 preview）。
// - reload 持久化：作答保存后刷新，会话恢复并展示首轮结果
// - 复习跨日：经 E2E 时钟桥推进天数（仅 VITE_E2E 构建；生产构建无该入口）
// - 缓存损坏：作业记录被清后启动对账标 needs-download

const prepareContent = async (page: Page): Promise<void> => {
  await page.goto('/')
  await page.getByRole('button', { name: '开始今日练习', exact: true }).click()
  await page.getByRole('link', { name: '前往课程列表' }).click()
  await page.getByRole('button', { name: '准备课程内容' }).click()
  await page.locator('.unit-card').first().waitFor()
}

test('touch-first task persists after reload', async ({ page }) => {
  await prepareContent(page)

  await page.goto('/#/today')
  await page.getByRole('button', { name: '开始今日计划', exact: true }).click()
  await page.locator('.session-progress').waitFor()
  // 计划槽位构成随日期变化：点击选项组第一个选项（对错不限，持久化是断言点）
  await page.getByRole('group', { name: '答题选项' }).getByRole('button').first().click()
  await page.getByRole('button', { name: '提交答案', exact: true }).click()
  await expect(page.getByRole('status').first()).toContainText('已保存')

  await page.reload()
  await page.locator('.session-progress').waitFor()
  await expect(page.getByTestId('first-attempt-result')).toContainText(/正确|需订正/)
})

test('复习跨日：时钟推进后复习队列出现到期项（E2E 构建入口）', async ({ page }) => {
  await prepareContent(page)

  // 完成今日首题（产生复习状态）
  await page.goto('/#/today')
  await page.getByRole('button', { name: '开始今日计划', exact: true }).click()
  await page.locator('.session-progress').waitFor()
  await page.getByRole('group', { name: '答题选项' }).getByRole('button').first().click()
  await page.getByRole('button', { name: '提交答案', exact: true }).click()
  await expect(page.getByRole('status').first()).toContainText('已保存')

  // 推进 2 个学习日（服务层 LearningClock 默认实现读取该偏移；生产构建无此入口）
  await page.evaluate(() => {
    const bridge = (window as { __GAOKAO_E2E__?: { advanceDays: (days: number) => void } }).__GAOKAO_E2E__
    if (!bridge) throw new Error('E2E bridge missing (非 E2E 构建?)')
    bridge.advanceDays(2)
  })

  await page.goto('/#/review')
  await expect(page.locator('.review-page')).toBeVisible()
  // B1 强断言：推进 2 日后该条目渲染为已到期（ReviewPage 与服务层同用 e2eNow 时钟）
  await expect(page.locator('.review-row').first().locator('.review-status')).toHaveText('已到期', { timeout: 10000 })
})

test('缓存损坏：作业记录缺失 → 启动对账标待重新下载', async ({ page }) => {
  await prepareContent(page)

  // 下载音频（真实 HTTP + 校验）
  await page.goto('/#/downloads')
  const row = page.locator('.download-row', { hasText: '听力起步样例包' })
  await row.locator('.download-start').click()
  await expect(page.locator('.downloads-message')).toHaveText('音频下载完成，可以离线练习。', { timeout: 15000 })

  // 破坏：删除 downloadJobs 作业记录（模拟缓存丢失）
  await page.evaluate(async () => {
    const request = indexedDB.open('gaokao-english-v1')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('downloadJobs', 'readwrite')
      tx.objectStore('downloadJobs').delete(['gaokao-listening', '1.0.1'])
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  })

  // 重载触发 App onMounted 启动对账
  await page.reload()
  await page.goto('/#/downloads')
  await expect(row.locator('.download-status')).toHaveText('待重新下载', { timeout: 10000 })
  await expect(row.locator('.download-start')).toBeVisible()
})