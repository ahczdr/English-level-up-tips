import { expect, test } from '@playwright/test'

test.describe('T01 今日练习按钮', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('选择今日练习内容按钮具有 button role 且类型为 button', async ({ page }) => {
    const button = page.getByRole('button', { name: '选择今日练习内容', exact: true })
    await expect(button).toBeVisible()
    await expect(button).toHaveAttribute('type', 'button')
  })

  test('点击选择今日练习内容后进入课程页', async ({ page }) => {
    const button = page.getByRole('button', { name: '选择今日练习内容', exact: true })
    await button.click()
    // CR12.1：单一入口总是进入课程页；空课程状态由课程页的「准备课程内容」承接
    await expect(page.getByRole('heading', { name: '课程' })).toBeVisible()
    await expect(page.locator('.learn-page')).toBeVisible()
  })

  test('重复三次进入课程页均稳定（原「重复点击仅一个提示」语义随单一入口更新）', async ({ page }) => {
    const button = page.getByRole('button', { name: '选择今日练习内容', exact: true })
    for (let i = 0; i < 3; i += 1) {
      await page.goto('/')
      await button.click()
      await expect(page.locator('.learn-page')).toBeVisible()
    }
  })
})
