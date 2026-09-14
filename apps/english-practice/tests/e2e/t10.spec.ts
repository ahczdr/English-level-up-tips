import { expect, test } from '@playwright/test'

// T10 今日计划：准备内容后 TodayPage 生成今日计划（复习+新内容），一键开始进入会话
test('今日计划生成并可一键开始进入会话', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '开始今日练习', exact: true }).click()
  await page.getByRole('link', { name: '前往课程列表' }).click()
  await page.getByRole('button', { name: '准备课程内容' }).click()
  await page.locator('.unit-card').first().waitFor()

  await page.goto('/#/today')
  const planCard = page.locator('.today-plan-card')
  await expect(planCard).toBeVisible()
  await expect(planCard).toContainText('今日计划')
  await expect(planCard).toContainText('新内容')
  await page.getByRole('link', { name: '查看复习列表' }).click()
  await expect(page.locator('.review-page')).toBeVisible()
  await expect(page.getByText('暂无到期复习', { exact: true })).toBeVisible()

  await page.goto('/#/today')
  await page.getByRole('button', { name: '开始今日计划', exact: true }).click()
  await expect(page.locator('.session-progress')).toBeVisible({ timeout: 10000 })
})
