import { expect, test } from '@playwright/test'

// T09 写作：真实浏览器验证审题/提纲/正文/自评表、字数提示、500ms 自动保存、
// 提交初稿后版本冻结与流程推进。写作不产生客观成绩（无 Attempt）。
const prepareAndOpenFullUnit = async (page: import('@playwright/test').Page) => {
  await page.goto('/')
  await page.getByRole('button', { name: '开始今日练习', exact: true }).click()
  await page.getByRole('link', { name: '前往课程列表' }).click()
  await page.getByRole('button', { name: '准备课程内容' }).click()
  const card = page.locator('.unit-card', { hasText: '校园社团：协议演示' })
  await expect(card).toBeVisible()
  await card.click()
  // 25 分钟预算（1500s）覆盖前 7 题：6 道客观题 + 1 道应用文写作（续写 720s 超预算被排除）
  await page.getByRole('button', { name: '25 分钟', exact: true }).click()
  await page.getByRole('button', { name: '开始练习', exact: true }).click()
  await expect(page.locator('.session-progress')).toHaveText('第 1 / 7 题')
}

test.describe('T09 写作全流程', () => {
  test('客观题跳过后进入写作：审题/字数/自动保存/提交初稿推进', async ({ page }) => {
    await prepareAndOpenFullUnit(page)

    // 前 6 道客观题全部跳过，直到写作题
    for (let index = 1; index <= 6; index += 1) {
      await expect(page.locator('.session-progress')).toHaveText(`第 ${index} / 7 题`)
      await page.getByRole('button', { name: '跳过此题', exact: true }).click()
    }
    await expect(page.locator('.session-progress')).toHaveText('第 7 / 7 题')

    // 写作视图：审题要求 + 提纲 + 正文 + 自评表，不再有 unsupported 占位
    await expect(page.getByText('审题要求', { exact: true })).toBeVisible()
    await expect(page.getByText('邀请朋友', { exact: true })).toBeVisible()
    await expect(page.locator('#writing-outline')).toBeVisible()
    await expect(page.locator('#writing-body')).toBeVisible()
    await expect(page.getByText('写明邀请目的', { exact: true })).toBeVisible()
    await expect(page.locator('.writing-count')).toContainText('0 词')

    // 输入正文：字数信息性展示（数字与缩写按词规则计数），500ms 后自动保存
    const body = page.locator('#writing-body')
    await body.fill("It's a well-known fact. I have 2 cats and 203 books.")
    await expect(page.locator('.writing-count')).toContainText('9 词')
    await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 5000 })

    // 提交初稿：先冲刷最新正文再冻结版本；下一题出现并推进到单元结束
    await page.getByRole('button', { name: '提交初稿', exact: true }).click()
    await expect(page.getByText('已提交 1 个版本', { exact: false })).toBeVisible()
    await expect(page.getByText('初稿', { exact: true })).toBeVisible()
    await expect(page.locator('.writing-version-body')).toContainText("It's a well-known fact. I have 2 cats and 203 books.")
    await page.getByRole('button', { name: '下一题', exact: true }).click()

    const summary = page.locator('.unit-summary')
    await expect(summary).toBeVisible()
    await expect(summary).toContainText('已跳过 6 题')
    // 写作不计入客观成绩：独立/提示后/未通过均为 0
    await expect(summary).toContainText('独立首次完成 0 题')
    await expect(summary).toContainText('提示后完成 0 题')
  })

  test('初稿提交后继续修改生成 v2：两版本并存且首稿保留', async ({ page }) => {
    await prepareAndOpenFullUnit(page)
    for (let index = 1; index <= 6; index += 1) {
      await page.getByRole('button', { name: '跳过此题', exact: true }).click()
    }
    await expect(page.locator('.session-progress')).toHaveText('第 7 / 7 题')
    await page.locator('#writing-body').fill('Dear Alex, please come to our reading club.')
    await page.getByRole('button', { name: '提交初稿', exact: true }).click()
    await expect(page.getByText('已提交 1 个版本', { exact: false })).toBeVisible()

    // 提交后正文可继续修改，生成 v2，首稿仍在对比区
    await page.locator('#writing-body').fill('Dear Alex, I would like to invite you to our reading club on Friday.')
    await page.getByRole('button', { name: '提交修改稿', exact: true }).click()
    await expect(page.getByText('已提交 2 个版本', { exact: false })).toBeVisible()
    const versionBodies = page.locator('.writing-version-body')
    await expect(versionBodies).toHaveCount(2)
    await expect(versionBodies.nth(0)).toContainText('Dear Alex, please come to our reading club.')
    await expect(versionBodies.nth(1)).toContainText('Dear Alex, I would like to invite you')
  })
})
