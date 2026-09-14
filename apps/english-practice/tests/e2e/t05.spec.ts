import { expect, test, type Page } from '@playwright/test'

// M1 门：在真实浏览器中准备内容并完整练习 demo-school-club 5 分钟短单元
const prepareAndStartShortSession = async (page: Page) => {
  await page.goto('/')
  await page.getByRole('button', { name: '开始今日练习', exact: true }).click()
  await page.getByRole('link', { name: '前往课程列表' }).click()
  await page.getByRole('button', { name: '准备课程内容' }).click()
  const card = page.locator('.unit-card', { hasText: '校园社团：协议演示' })
  await expect(card).toBeVisible()
  await card.click()
  await page.getByRole('button', { name: '5 分钟', exact: true }).click()
  await page.getByRole('button', { name: '开始练习', exact: true }).click()
  await expect(page.locator('.session-progress')).toHaveText('第 1 / 4 题')
}

test.describe('T05 触屏练习全流程', () => {
  test('准备内容后完成 5 分钟短单元并显示单元结束统计', async ({ page }) => {
    await prepareAndStartShortSession(page)
    await expect(page.locator('.draft-badge')).toContainText('预览内容（未审核）')

    // 第 1 题：单选 加入
    await page.getByRole('button', { name: '加入', exact: true }).click()
    await page.getByRole('button', { name: '提交答案', exact: true }).click()
    await expect(page.getByText('回答正确', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '下一题', exact: true }).click()

    // 第 2 题：点词组句（依次点候选区第一个词块）
    await expect(page.locator('.session-progress')).toHaveText('第 2 / 4 题')
    for (let index = 0; index < 5; index += 1) {
      await page.locator('.token-option').first().click()
    }
    await page.getByRole('button', { name: '提交答案', exact: true }).click()
    await expect(page.getByText('回答正确', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '下一题', exact: true }).click()

    // 第 3 题：文本填空
    await expect(page.locator('.session-progress')).toHaveText('第 3 / 4 题')
    await page.locator('.gap-input').fill('meets')
    await page.getByRole('button', { name: '提交答案', exact: true }).click()
    await expect(page.getByText('回答正确', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '下一题', exact: true }).click()

    // 第 4 题：阅读理解，材料可见
    await expect(page.locator('.session-progress')).toHaveText('第 4 / 4 题')
    await expect(page.locator('.passage')).toContainText('Room 203')
    await page.getByRole('button', { name: 'In Room 203.', exact: true }).click()
    await page.getByRole('button', { name: '提交答案', exact: true }).click()
    await expect(page.getByText('回答正确', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '下一题', exact: true }).click()

    // 单元结束统计
    const summary = page.locator('.unit-summary')
    await expect(summary).toBeVisible()
    await expect(summary).toContainText('独立首次完成 4 题')
    await expect(summary).toContainText('提示后完成 0 题')
    await expect(summary).toContainText('首次未通过 0 题')
    await expect(summary).toContainText('已跳过 0 题')
    await page.getByRole('button', { name: '回到今日', exact: true }).click()
    await expect(page.getByRole('heading', { name: '今日练习' })).toBeVisible()
  })

  test('中途刷新页面可从当前位置继续练习', async ({ page }) => {
    await prepareAndStartShortSession(page)

    await page.getByRole('button', { name: '加入', exact: true }).click()
    await page.getByRole('button', { name: '提交答案', exact: true }).click()
    await expect(page.getByText('回答正确', { exact: true })).toBeVisible()

    // 刷新页面，应恢复到第 2 题继续
    await page.reload()
    await expect(page.locator('.session-progress')).toHaveText('第 2 / 4 题')
    await expect(page.locator('.draft-badge')).toContainText('预览内容（未审核）')
    await expect(page.getByRole('button', { name: '提交答案', exact: true })).toBeVisible()

    // 刷新后可以继续作答第 2 题
    for (let index = 0; index < 5; index += 1) {
      await page.locator('.token-option').first().click()
    }
    await page.getByRole('button', { name: '提交答案', exact: true }).click()
    await expect(page.getByText('回答正确', { exact: true })).toBeVisible()
  })
})
