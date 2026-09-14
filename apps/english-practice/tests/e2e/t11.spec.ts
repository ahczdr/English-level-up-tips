import { expect, test } from '@playwright/test'

// T11 成长记录：今日页入口 → 成长页渲染核心区块，奖励闪动可关闭
test('成长记录页展示核心区块且奖励可关闭', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '开始今日练习', exact: true }).click()
  await page.getByRole('link', { name: '前往课程列表' }).click()
  await page.getByRole('button', { name: '准备课程内容' }).click()
  await page.locator('.unit-card').first().waitFor()

  await page.goto('/#/progress')
  await expect(page.locator('.progress-page')).toBeVisible()
  await expect(page.locator('.progress-page')).toContainText('成长记录')
  await expect(page.locator('.progress-page')).toContainText('学习地图')
  await expect(page.locator('.progress-page')).toContainText('作品卡')

  const flash = page.locator('.reward-flash')
  if (await flash.isVisible()) {
    await flash.locator('.reward-close').click()
    await expect(flash).toHaveCount(0)
  }
})
