import { expect, test } from '@playwright/test'

test.describe('T01 今日练习按钮', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('开始今日练习按钮具有 button role 且类型为 button', async ({ page }) => {
    const button = page.getByRole('button', { name: '开始今日练习', exact: true })
    await expect(button).toBeVisible()
    await expect(button).toHaveAttribute('type', 'button')
  })

  test('点击开始今日练习后显示暂无可用课程提示', async ({ page }) => {
    const button = page.getByRole('button', { name: '开始今日练习', exact: true })
    await button.click()
    await expect(
      page.getByText('暂无可用课程，请先准备学习内容。', { exact: true }),
    ).toBeVisible()
  })

  test('重复点击三次后仅出现一个状态提示', async ({ page }) => {
    const button = page.getByRole('button', { name: '开始今日练习', exact: true })
    for (let i = 0; i < 3; i += 1) {
      await button.click()
    }

    const status = page
      .getByRole('status')
      .filter({ hasText: '暂无可用课程' })
      .filter({ hasText: '请先准备学习内容' })

    await expect(status).toHaveCount(1)
    await expect(
      status.getByText('暂无可用课程，请先准备学习内容。', { exact: true }),
    ).toBeVisible()
  })
})
