import { expect, test, type Page } from '@playwright/test'

// T08 听力：真实浏览器验证下载与状态机。真实扬声器播放按计划留给 T14 + 真机人工清单，
// 这里用 addInitScript 替换 HTMLMediaElement.prototype.play，保证状态机可自动化验证。
const stubAudioPlayback = async (page: Page, mode: 'accept' | 'reject') => {
  await page.addInitScript((value: string) => {
    ;(window as unknown as { __AUDIO_MODE__?: string }).__AUDIO_MODE__ = value
    HTMLMediaElement.prototype.play = function play(): Promise<void> {
      if ((window as unknown as { __AUDIO_MODE__?: string }).__AUDIO_MODE__ === 'reject') {
        return Promise.reject(new DOMException('play blocked', 'NotAllowedError'))
      }
      return Promise.resolve()
    }
  }, mode)
}

const prepareAndOpenListeningUnit = async (page: Page) => {
  await page.goto('/')
  await page.getByRole('button', { name: '开始今日练习', exact: true }).click()
  await page.getByRole('link', { name: '前往课程列表' }).click()
  await page.getByRole('button', { name: '准备课程内容' }).click()
  const card = page.locator('.unit-card', { hasText: '听力起步：社团对话' })
  await expect(card).toBeVisible()
  await card.click()
  // 资产未下载：开始练习禁用，必须先下载音频（真实 HTTP 下载 + hash 校验）
  const download = page.getByRole('button', { name: '下载音频', exact: true })
  await expect(download).toBeVisible()
  await expect(page.getByRole('button', { name: '开始练习', exact: true })).toBeDisabled()
  await download.click()
  await expect(page.getByText('音频下载完成，可以开始练习。')).toBeVisible()
  await page.getByRole('button', { name: '开始练习', exact: true }).click()
  await expect(page.locator('.session-progress')).toHaveText('第 1 / 2 题')
}

test.describe('T08 听力全流程', () => {
  test('下载音频后播放、开启字幕、完成两道听力题，字幕开启后的答对计辅助', async ({ page }) => {
    await stubAudioPlayback(page, 'accept')
    await prepareAndOpenListeningUnit(page)

    // 第 1 题：播放器出现，点击播放进入播放中（暂停按钮）
    const player = page.locator('.audio-player')
    await expect(player).toBeVisible()
    await page.getByRole('button', { name: '播放', exact: true }).click()
    // 播放器内出现「暂停」（会话头部另有暂停会话按钮，需限定作用域）
    await expect(player.getByRole('button', { name: '暂停', exact: true })).toBeVisible()
    // 字幕显式开启前不出现；开启后显示对话原文
    await expect(page.locator('.audio-transcript')).toHaveCount(0)
    await page.getByRole('button', { name: '字幕', exact: true }).click()
    await expect(page.locator('.audio-transcript')).toContainText('We meet in Room 203 every Friday after class.')
    // 速度切换按钮存在
    await expect(page.getByRole('button', { name: '0.75×', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'In Room 203.', exact: true }).click()
    await page.getByRole('button', { name: '提交答案', exact: true }).click()
    await expect(page.getByText('回答正确', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '下一题', exact: true }).click()

    // 第 2 题：换题后播放器重建
    await expect(page.locator('.session-progress')).toHaveText('第 2 / 2 题')
    await expect(player).toBeVisible()
    await page.getByRole('button', { name: 'A book he likes.', exact: true }).click()
    await page.getByRole('button', { name: '提交答案', exact: true }).click()
    await expect(page.getByText('回答正确', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '下一题', exact: true }).click()

    const summary = page.locator('.unit-summary')
    await expect(summary).toBeVisible()
    await expect(summary).toContainText('独立首次完成 1 题')
    await expect(summary).toContainText('提示后完成 1 题')
    await expect(summary).toContainText('首次未通过 0 题')
    await expect(summary).toContainText('已跳过 0 题')
  })

  test('play 被拒绝时显示重试，跳过不计听力错误且流程可继续', async ({ page }) => {
    await stubAudioPlayback(page, 'reject')
    await prepareAndOpenListeningUnit(page)

    await page.getByRole('button', { name: '播放', exact: true }).click()
    await expect(page.locator('.audio-error')).toBeVisible()
    await page.getByRole('button', { name: '重试', exact: true }).click()
    await expect(page.locator('.audio-error')).toBeVisible()
    // 跳过不计听力错误：仍可进入下一题并正常作答
    await page.getByRole('button', { name: '跳过此题', exact: true }).click()
    await expect(page.locator('.session-progress')).toHaveText('第 2 / 2 题')
    await expect(page.locator('.audio-player')).toBeVisible()
    await page.getByRole('button', { name: 'A book he likes.', exact: true }).click()
    await page.getByRole('button', { name: '提交答案', exact: true }).click()
    await expect(page.getByText('回答正确', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '下一题', exact: true }).click()

    const summary = page.locator('.unit-summary')
    await expect(summary).toBeVisible()
    await expect(summary).toContainText('已跳过 1 题')
    await expect(summary).toContainText('首次未通过 0 题')
  })
})
