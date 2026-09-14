import { expect, test } from '@playwright/test'

// T14：手机/平板 viewport 回归 + 200% 文字缩放。
// 注意：本文件运行于桌面引擎 viewport 模拟（WebKit 项目为引擎级模拟），不等价 iOS/Android 真机；
// 真机触屏、软键盘弹起遮挡、安全区等仍按约定移交真机验证。

const viewports = [
  { label: '手机 360x640（最窄档）', width: 360, height: 640 },
  { label: '手机 390x844', width: 390, height: 844 },
  { label: '平板 768x1024', width: 768, height: 1024 },
  { label: '桌面 1024x768', width: 1024, height: 768 },
] as const

const assertNoHorizontalOverflow = async (page: import('@playwright/test').Page): Promise<void> => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

for (const viewport of viewports) {
  test('viewport ' + viewport.label + '：今日页与下载页无横向溢出', async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/#/today')
    await page.locator('.app-shell').waitFor()
    await expect(page.getByRole('heading', { name: '今日练习' })).toBeVisible()
    await assertNoHorizontalOverflow(page)

    await page.goto('/#/downloads')
    await page.locator('.downloads-page').waitFor()
    await assertNoHorizontalOverflow(page)
    await expect(page.getByRole('heading', { name: '课程下载' })).toBeVisible()
  })
}

test('手机最窄档：练习会话页无横向溢出（点词组句最易溢出）', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await page.goto('/')
  await page.getByRole('button', { name: '开始今日练习', exact: true }).click()
  await page.getByRole('link', { name: '前往课程列表' }).click()
  await page.getByRole('button', { name: '准备课程内容' }).click()
  const card = page.locator('.unit-card', { hasText: '校园社团：协议演示' })
  await expect(card).toBeVisible()
  await card.click()
  await page.getByRole('button', { name: '5 分钟', exact: true }).click()
  await page.getByRole('button', { name: '开始练习', exact: true }).click()
  await page.locator('.session-progress').waitFor()
  await assertNoHorizontalOverflow(page)
})

test('200% 文字缩放：CTA 可见且无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/today')
  await page.locator('.app-shell').waitFor()
  // 200% 文字缩放：基准字号翻倍（模拟系统大字模式；真机系统级缩放另测）
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  await expect(page.getByRole('button', { name: '开始今日练习', exact: true })).toBeVisible()
  await assertNoHorizontalOverflow(page)
})

test('输入控件触屏适配（软键盘布局的结构性检查）', async ({ page }) => {
  // 软键盘真实弹起行为无法在桌面引擎模拟：此处做结构性断言（viewport meta 覆盖安全区），
  // 真机软键盘遮挡与滚动联动留待真机验证（T08/T14 约定）。
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/today')
  const viewportMeta = page.locator('meta[name="viewport"]')
  await expect(viewportMeta).toHaveCount(1)
  const content = await viewportMeta.getAttribute('content')
  expect(content ?? '').toContain('viewport-fit=cover')
})
