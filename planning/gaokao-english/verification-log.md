# 验证记录（Verification Log）

记录时间：2026-09-10
记录者：GLM-5.3（DSH 执行环境，T05 开发模型）
适用任务：T05 基础触屏练习页面与导航（含 M1 门）
代码位置：`/private/tmp/gaokao-english-glm-worktree/apps/english-practice`（分支 `codex/gaokao-english-glm`，未执行 commit/push）
本文件在原始仓库 `planning/gaokao-english/`（人工阅读正本）与隔离工作树 `planning/gaokao-english/` 各存一份，内容一致。

## 一、结论摘要

| 验证项 | 结果 |
| --- | --- |
| 单元测试 | 94/94 通过（11 个文件；T01–T04 既有 39 项全部保持通过，新增 55 项） |
| `npm run check`（内容校验+类型+lint+单测） | 通过（exit 0；eslint 0 errors） |
| `npm run build` | 通过（328.61 kB / gzip 110.68 kB） |
| Playwright e2e | 5/5 通过（t01 回归 3 项 + t05 新增 2 项） |
| M1 门（真实浏览器完整短单元） | 达成：5 分钟 4 题全流程 + 中途刷新恢复 |
| 断点布局 360x640/390x844/768x1024/1024x768 | 自动化检查无横向溢出；截图已存档待人工目视复核 |
| 键盘操作 | Tab 可达选项按钮，Enter 选择生效（aria-pressed="true"） |
| aria-live | 提交后 role=status 播报「已保存」；错误路径 role=alert（单测断言） |
| 真机触屏 | **未验证**（见第四节） |

## 二、证据命令与关键输出

统一环境前缀：`PATH=/Users/wu/.nvm/versions/node/v24.16.0/bin:$PATH TMPDIR=/private/tmp/tsx-tmp`，工作目录 `apps/english-practice`。

1. RED 阶段（先写测试并确认失败）：`npx vitest run` → `Tests 51 failed | 43 passed (94)`、`Test Files 4 failed | 7 passed (11)`。失败均为行为断言（如 expected false to be true、找不到预期文案），非模块/配置错误；T01–T04 既有 7 个测试文件全部保持绿色。
2. GREEN 阶段：`npx vitest run` → `Test Files 11 passed (11)`、`Tests 94 passed (94)`。
3. `npm run check` → 通过（exit 0）：content:check 预览校验 + vue-tsc 类型检查 + eslint（0 errors）+ 94 项单测。
4. `npm run build` → 通过：`✓ built in 602ms`，`dist/assets/index-BSuIjId8.js 328.61 kB │ gzip: 110.68 kB`。
5. `npm run test:e2e` → `5 passed (3.0s)`：
   - t01.spec.ts 3 项回归全部通过（今日页空态精确文案、重复点击单一状态提示等行为未受影响，规格逐字未改）。
   - t05.spec.ts「准备内容后完成 5 分钟短单元并显示单元结束统计」：今日页空态 → 前往课程列表 → 准备课程内容 → 选择单元 + 5 分钟 → 开始练习 → 依次完成单选（加入）、点词组句（5 词）、文本填空（meets）、阅读理解（.passage 可见 Room 203，选项 In Room 203.）→ 单元结束统计「独立首次完成 4 题 / 提示后完成 0 题 / 首次未通过 0 题 / 已跳过 0 题」→ 回到今日。练习全程显示草稿标记「预览内容（未审核）」。
   - t05.spec.ts「中途刷新页面可从当前位置继续练习」：提交第 1 题后 `page.reload()`，恢复到「第 2 / 4 题」且可继续完成作答。
   - 说明：运行时 Playwright webServer 在工作树内自动启动了 dev server；5174 端口上存在另一项目目录（2026trae）的旧 vite 进程，未被复用，不影响结论。
6. 浏览器冒烟（工作树 dev server @5177 + Playwright chromium 一次性脚本）：
   - 断点检查：360x640、390x844、768x1024、1024x768 全部 `scrollWidth ≤ clientWidth`（无横向溢出）。
   - 键盘检查：Tab 连按最多 12 次内聚焦到「加入」选项按钮，`Enter` 触发选择，`aria-pressed` 变为 `"true"`。
   - aria-live 检查：提交后页面存在 `[role="status"]` 区域，文本「已保存」。
   - 截图 8 张存档于 `planning/gaokao-english/evidence/t05/`：`today-{360x640,390x844,768x1024,1024x768}.png`、`learn-390x844-units.png`、`session-390x844-item1.png`、`session-390x844-keyboard-selected.png`、`session-390x844-feedback.png`。

## 三、实现清单

新增文件：

- `src/services/settings.ts`：个人设置读写（默认值合并、settings 表持久化）。
- `src/services/sessionFlow.ts`：`setCurrentIndex`（revision/范围检查）、`getSessionSummary`（独立首次/提示后完成/首次未通过/已跳过计数）、`firstUnfinished`。
- `src/services/content.ts`：`installPreviewPacks`（目录下载 → 按 pack id 取最新版本 → bytes/sha256 校验 → validatePack 预览校验 → 入 packs 表）。
- `src/components/AppButton.vue`：真实 button、variant 变体、≥44px 触控目标。
- `src/components/FeedbackPanel.vue`：保存中/已保存/错误三态；role=status / role=alert 播报；判定结果（回答正确/回答有误/部分正确）、逐空对错、中文解析（summaryZh/ruleZh/干扰项 reasonZh/证据引用）。
- `src/features/practice/ChoiceTask.vue`、`OrderTask.vue`、`GapTask.vue`：仅 emit `update:modelValue` 的受控答题组件；键盘 Enter/Space 可选；组句支持点击移除与左移/右移；填空支持 options/text 两种 inputMode、sharedOptions、uniqueOptions 占用禁用（含「已用于其他空」提示）。
- `src/features/practice/SessionPage.vue`：协调页——加载会话（暂停自动恢复）、进入未完成题目、首次呈现 exposure（经 T03 `enterCurrentSlot`）、提交/订正（幂等 command id）、查看提示（`revealHint('rule')`）、跳过、下一题、暂停、退出确认、单元结束统计；服务层异常以中文错误呈现（role=alert）。
- `src/features/onboarding/OnboardingPage.vue`：年级/目标/默认时长设置，保存到本机；起点练习样本不足说明。
- `src/features/learn/LearnPage.vue`：已安装单元列表（未审核标记、题量与时长估算）、练习时长选择、开始练习创建会话；空态提供「准备课程内容」按钮。
- `tests/unit/settings.spec.ts`、`session-flow.spec.ts`、`content-install.spec.ts`、`practice-ui.spec.ts`（共 55 项）。
- `tests/e2e/t05.spec.ts`（2 项，M1 门）。

修改文件：

- `src/features/today/TodayPage.vue`：重写——保留 T01 精确空态文案与单一状态提示行为；新增可继续练习列表（最近 3 条）、「前往课程列表」空态引导链接、「学习设置」入口。
- `src/app/router.ts`：路由表扩展（`/today`、`/onboarding`、`/learn`、`/session/:id`、catch-all 重定向）。
- `src/styles.css`：追加按钮变体、单元卡片、词块/候选池、填空位、反馈面板、练习页、退出确认等样式；focus-visible 轮廓与 ≥44px 触控目标。

未修改（逐字不变）：`src/services/learning.ts`、`src/domain/*`、`src/content/*`、`src/data/*`、`tests/e2e/t01.spec.ts`。

## 四、未验证项（如实记录）

1. **真机触屏（iOS Safari / Android Chrome）：未验证。** 所有触屏结论来自桌面 Chromium 仿真与 44px 触控目标的代码/样式约束及自动化断言；需人工真机复核后方可标记已验证。
2. **截图证据的目视复核：** 截图由脚本自动捕获，本模型无图像输入能力，未逐张目视检查。自动化断言（元素可见、无横向溢出）已通过，建议人工浏览 `evidence/t05/` 复核视觉细节。
3. **Sol 独立审查与验收：尚未进行。** 本记录仅为开发方自验证据，不构成验收结论。
4. `npm run content:release` 仍预期失败于 draft/P07 正式内容门禁（T02 既有边界，非本任务回归）。

## 五、范围决策与偏差说明（供 Sol 审查）

1. **GapTask 基础版纳入 T05**：交接文档 T05 列明 choice/order/gaps 答题组件，且 5 分钟及以上会话必然包含 gaps 题（grammar-meet-a 为文本填空）。T06 再补 PassagePanel、证据引用高亮、占用移动等增强；T07 再补完形草稿/焦点保持。
2. **新增 `sessionFlow.ts` 而不改 `learning.ts`**：T04 服务没有推进 `currentIndex` 的接口，而「下一题」与刷新恢复需要它；为遵守「不回滚/不改已验收 T04 代码」约束，新建独立服务文件。
3. **LearnPage 最小「准备课程内容」按钮（`installPreviewPacks`）**：此前 packs 表无任何写入路径，M1 门要求真实浏览器跑通短单元；完整下载/断点续传/PWA/备份按交接文档留在 T12+，未实现。预览包与发布内容用 status 字段区分（`pack.status !== 'published'` 显示未审核标记）。
4. **「查看提示」调用 `revealHint('rule')`**：使「提示后完成」计数在 UI 真实可达（T04 已实现 assistance 持久化与独立判定）；提示展示 ruleZh 并标注「已记录辅助」。
5. **提交幂等**：SessionPage 用 `crypto.randomUUID` 生成 command id 并在同一题目内复用，天然获得 T04 的重放语义（重复点击不产生重复记录，单测断言 attempts 计数为 1）。
6. **写作题占位**：显示「写作任务将在后续任务提供」并允许跳过（走 T04 `skipSlot` 计账），符合「完整写作工作流暂不实现」边界。
7. **t01.spec.ts 逐字未改且 3/3 通过**；TodayPage 空态文案「暂无可用课程，请先准备学习内容。」内嵌独立 span，兼容 Playwright exact 匹配。

## 六、重要技术发现（后续任务必读）

**Vue 深层响应式代理会破坏 Dexie 事务。**
vue-test-utils 传入组件的对象 prop（如 `db`）会被 Vue 响应式代理包装；Dexie 在代理实例上执行 `db.transaction(...)` 会抛 `PrematureCommitError`（事务过早提交），被服务层 catch 后表现为「本地存储写入失败」。普通读写经代理透明转发不受影响，因此问题只在事务路径暴露（定位过程：同一 db 在测试 realm 事务正常、组件 onMounted 内必现 PrematureCommitError；`isProxy(props.db) === true` 确认）。
已修复：四个页面组件对 db prop 以 `toRaw()` 解包；SessionPage 提交时对 draft（answer 对象，ref 深层代理同理）同样 `toRaw` 解包。真实应用路径（RouterView 渲染、模块级单例 db，无 prop 传递）不经过代理，不受影响。**后续任何把响应式对象传入服务层的代码都应先 `toRaw`。**

另一发现：fake-indexeddb 每次读写跨多个宏任务完成，组件级测试用 `settle()`（多轮 `flushPromises` + `setTimeout` 排空事件循环）代替单次 `flushPromises`。

## 七、复现附录：浏览器冒烟脚本

一次性取证脚本（执行后已从代码树移除以保持 lint 清洁）。在 `apps/english-practice` 启动 dev server 后以 `node smoke-t05.mjs` 运行可复现第二节第 6 条全部结论与截图：

```js
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = 'http://127.0.0.1:5177'
const outDir = 'planning/gaokao-english/evidence/t05'
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const report = { viewports: [], aria: {} }

// 1) 今日页四个断点布局
for (const [width, height] of [[360, 640], [390, 844], [768, 1024], [1024, 768]]) {
  const context = await browser.newContext({ viewport: { width, height } })
  const page = await context.newPage()
  await page.goto(base + '/')
  await page.getByRole('heading', { name: '今日练习' }).waitFor()
  await page.screenshot({ path: `${outDir}/today-${width}x${height}.png`, fullPage: true })
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  report.viewports.push({ viewport: `${width}x${height}`, horizontalOverflow })
  await context.close()
}

// 2) 390x844 全流程：准备内容 → 开始练习 → 键盘选择 → 提交（aria-live 播报）
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()
await page.goto(base + '/')
await page.getByRole('button', { name: '开始今日练习', exact: true }).click()
await page.getByRole('link', { name: '前往课程列表' }).click()
await page.getByRole('button', { name: '准备课程内容' }).click()
const card = page.locator('.unit-card', { hasText: '校园社团：协议演示' })
await card.waitFor()
await page.screenshot({ path: `${outDir}/learn-390x844-units.png`, fullPage: true })
await card.click()
await page.getByRole('button', { name: '5 分钟', exact: true }).click()
await page.getByRole('button', { name: '开始练习', exact: true }).click()
await page.locator('.session-progress').waitFor()
await page.screenshot({ path: `${outDir}/session-390x844-item1.png`, fullPage: true })

// 键盘可达性：Tab 聚焦到选项按钮后用 Enter 选择
const join = page.getByRole('button', { name: '加入', exact: true })
for (let step = 0; step < 12; step += 1) {
  await page.keyboard.press('Tab')
  if (await join.evaluate((el) => el === document.activeElement)) break
}
report.aria.keyboardFocusOnOption = await join.evaluate((el) => el === document.activeElement)
await page.keyboard.press('Enter')
await page.waitForTimeout(200)
report.aria.optionAriaPressedAfterEnter = await join.getAttribute('aria-pressed')
await page.screenshot({ path: `${outDir}/session-390x844-keyboard-selected.png`, fullPage: true })

// 提交后 aria-live 播报（role=status）与解析面板
await page.getByRole('button', { name: '提交答案', exact: true }).click()
await page.getByText('回答正确', { exact: true }).waitFor()
report.aria.liveRegionsAfterSubmit = await page.locator('[role="status"], [role="alert"]').allTextContents()
await page.screenshot({ path: `${outDir}/session-390x844-feedback.png`, fullPage: true })

await context.close()
await browser.close()
console.log(JSON.stringify(report, null, 2))
```

---

# 八、T06 验证记录（2026-09-10 追加）

适用任务：T06 阅读与七选五（依赖 T05；范围以 `03-implementation-plan.md` T06 小节为准，用户按交接协议直接派发）。

## 8.1 结论摘要

| 验证项 | 结果 |
| --- | --- |
| RED 阶段 | 10 failed / 99 passed（109 项；失败全部为行为断言，无模块/配置错误） |
| GREEN 后单元测试 | 109/109 通过（13 个文件；T01–T05 既有 94 项保持通过，T06 新增 15 项） |
| `npm run check` | 通过（exit 0；vue-tsc + eslint 0 errors + 109 单测） |
| `npm run build` | 通过（332.34 kB / gzip 111.88 kB） |
| `npm run test:e2e` | 5/5（t01 3 项 + t05 2 项持续回归） |
| 计划指定验证命令 | `npm run test:unit -- tests/unit/reading.spec.ts tests/unit/gaps.spec.ts` → 15/15 |
| 浏览器冒烟（真 Chromium） | 桌面双栏并排 + 切换按钮隐藏；手机滚动位置跨视图切换精确保留（1474px→1474px）；证据跳转高亮两端一致 |
| 真机触屏 | **未验证**（沿用 T05 记录） |

## 8.2 证据命令与关键输出

环境同第二节。RED：`npx vitest run` → `Tests 10 failed | 99 passed (109)`、`Test Files 3 failed | 10 passed (13)`（gaps/reading/practice-ui 三个文件，失败点：判题器不拒绝重复、无移动确认、FeedbackPanel 证据不可点击、PassagePanel 无高亮、SessionPage 无双窗格）。GREEN 后同命令 109/109。

`npm run build` → `✓ built in 650ms`，`dist/assets/index-CfUgspFv.js 332.34 kB │ gzip: 111.88 kB`。

冒烟脚本输出（JSON）逐字段：

- desktop：`twoPane=true`、`sideBySide=true`（题目窗格 x 位于文章窗格右侧）、`toggleHidden=true`、证据高亮文本 `meets in Room 203`。
- mobile（390x844，hasTouch）：`toggleVisible=true`、默认题目窗格可见/文章窗格隐藏；向文章窗格注入填充段落制造真实溢出后滚动 `1474px`，切 题目→文章 后 `scrollTop=1474` 精确保留；提交后点击「查看依据」→ 文章窗格自动显示且高亮命中。

截图 4 张（`planning/gaokao-english/evidence/t06/`，主仓库与工作树各一份）：`session-1024x768-two-pane.png`、`session-1024x768-evidence-highlight.png`、`session-390x844-article.png`、`session-390x844-evidence-highlight.png`。

## 8.3 实现清单

- 新增 `src/components/PassagePanel.vue`（段落锚点、quote 定位高亮、`scrollToParagraph`；根类保留 `.passage`）。
- `src/features/practice/SessionPage.vue`：文章/题目双窗格布局（手机独立滚动容器 + v-show 切换；≥768px CSS 双栏并排并隐藏切换按钮）；`jumpToEvidence`（nextTick 后滚动到段落）；`resource.id` 复用 PassagePanel；`resetSlotState` 重置阅读视图与高亮。
- `src/features/practice/GapTask.vue`：已占用选项可点击 + 行内移动确认（`gap-move-confirm`，role=alertdialog），确认后原空清空；按钮态类 `gap-option-is-used`；「已用于第 N 空」。
- `src/components/FeedbackPanel.vue`：证据条目改为按钮「查看依据：…」并 emit `jump`。
- `src/domain/answers.ts`：`gradeGaps` 增加 uniqueOptions 重复占用拒绝（见 8.4-1）。
- `src/styles.css`：T06 样式追加；`.feedback-evidence` 从 blockquote 样式改为按钮样式。
- 新增 `tests/unit/reading.spec.ts`、`tests/unit/gaps.spec.ts`；更新 `tests/unit/practice-ui.spec.ts` 唯一占用测试。

## 8.4 范围决策与偏差说明（供 Sol 审查）

1. **修改了 T04 已验收的 `src/domain/answers.ts`**（最小增量 +5 行）：T06 计划验收项「非法重复a不接受提交」要求判题器拒绝 options+uniqueOptions 条目中同一选项占用多个空位。T04 全部既有规格在改动后保持通过（submit.spec 6/6 等）；语义只作用于 `inputMode === 'options' && uniqueOptions` 条目，text 模式与局部选项条目不受影响。
2. **practice-ui.spec「唯一共享选项不重复占用」按 T06 交互改写**：T05 旧行为是禁用已占用选项（记为「（已用于其他空）」）；T06 计划明确要求「点击时提供移动确认」，故旧断言（disabled）被替换为移动确认断言。这是计划内的行为演进，非回归。
3. **滚动保留的验证分层**：手机端两个窗格为独立滚动容器（`height: min(72vh, 640px); overflow-y: auto`），v-show 切换保留 DOM 与滚动位置。jsdom 无布局引擎（scrollTop 不被截断），单测只验证机制（元素恒等 + 属性保留 + display 切换）；真实浏览器行为由冒烟脚本验证（注入填充段落制造溢出后 1474px 精确保留）。
4. **样例包 reading-club 只有 1 段**，桌面双栏与手机默认视图仍正常；冒烟中的填充段落仅用于制造溢出，截图均取自然内容（填充段落在高亮截图前已移除）。
5. 计划文件清单中的 `SessionPage.vue`、`GapTask.vue` 均在列表内；额外新增 `styles.css` 追加与 `FeedbackPanel.vue` 修改属于实现验收项的必要载体，未触碰任何 T04 服务事务规则。

## 8.5 未验证项（如实记录）

1. **真机触屏**：T06 新交互（文章/题目切换、移动确认、证据跳转）只在桌面 Chromium（含 hasTouch 仿真）验证，未在 iOS Safari / Android Chrome 真机验证。
2. **截图目视复核**：截图自动捕获，本模型无图像输入能力，未逐张目视检查；建议人工浏览 `evidence/t06/`。
3. **Sol 独立审查与验收**：尚未进行（T05、T06 均待验收）。

## 8.6 技术发现（补充）

- `wrapper.getComponent(X).vm` 的两次引用即使底层实例相同（uid 相同），`toBe` 也可能因 Proxy/原始对象包装差异而失败——判断组件是否重挂载应比较内部实例 `vm._.uid`，而不是 vm 引用本身。
- 真浏览器会把 `display:none` 元素恢复显示后的 scrollTop 保留（Playwright 实测 1474px 不丢失），v-show 方案可以安全承载「切换视图保留滚动位置」需求。
- CSS 选择器作用域错位（`has-passage` 在 `.reading-layout` 上而样式写成 `.reading-panes.has-passage`）不会报错，只有真实布局验证才能发现——冒烟脚本的 boundingBox 断言（twoPane/sideBySide）抓住了该问题。

## 8.7 复现附录：T06 浏览器冒烟脚本

一次性取证脚本，执行后已从代码树移除（存于 /private/tmp，未入库）。dev server @5179 起动后 `node t06-smoke.mjs` 可复现 8.1/8.2 全部结论与 4 张截图。脚本与 T05 附录同构：`reachReadingItem` 复用 t05 e2e 流程（加入 → 五词组句 I/want/to/join/the club → meets → In Room 203.）；桌面 1024x768 断言 `.reading-pane-article` 与 `.reading-pane-task` 同时可见且 x 轴并排、切换按钮隐藏、证据点击后 `.passage-highlight` 文本命中；手机 390x844（hasTouch）断言默认题目窗格可见、注入 12 个填充段落后滚到底（1474px）、题目↔文章切换后 scrollTop 仍为 1474、清理填充段落后提交并点击证据断言文章窗格可见且高亮命中；截图 4 张存 `planning/gaokao-english/evidence/t06/`。

---

# 九、T07 验证记录（2026-09-10 追加）

适用任务：T07 完形与语法填空（依赖 T05/T06；范围以 `03-implementation-plan.md` T07 小节为准，用户按交接协议直接派发）。

## 9.1 结论摘要

| 验证项 | 结果 |
| --- | --- |
| RED 阶段 | 新规格 10 项中 4 项行为失败（草稿服务桩、SessionPage 草稿接线、Next 焦点），6 项既有行为钉住 |
| GREEN 后单元测试 | 119/119 通过（14 个文件；T01–T06 既有 109 项保持通过，T07 新增 10 项） |
| `npm run check` | 通过（exit 0） |
| `npm run build` | 通过（334.60 kB / gzip 112.55 kB） |
| `npm run test:e2e` | 5/5（t01+t05 持续回归） |
| 计划指定验证命令 | `npm run test:unit -- tests/unit/cloze-grammar.spec.ts` → 10/10 |
| 浏览器冒烟（真 Chromium） | **草稿跨刷新恢复（输入 'mee' → reload → 输入框恢复 'mee'）**；Enter 不交卷；clue 显示；cloze 每空独立选项池 |
| 真机软键盘 | **未验证**（仿真边界，见 9.5） |

## 9.2 计划验收项逐项对照

- 每空独立选项触屏面板（与七选五共享渲染框架、不共享选项约束）：GapTask 既有 `optionsForActiveGap` 逻辑（sharedOptions 为空时取 gap.options）+ uniqueOptions=false 不启用跨空约束；新增测试钉住「相同选项 id 可在不同空同时使用」，冒烟确认两空各自渲染 help/leave 与 thanked/ignored。
- text 模式显示 clue 提示词和输入框：既有实现（T05），冒烟确认「提示词：meet」；自动保存草稿为本轮新增（drafts 表），不把草稿计成作答（单测断言 attempts=0，提交后才产生 Attempt 且草稿被清除）。
- 多个 accepted 变体按 policy 归一化：T04 `gradeGaps` 已实现，新增测试钉住（['meets','holds'] 两变体、'MEETS ' 大小写/尾空格归一化、'hold' 不匹配）；单数不会自动改成复数（'meet' 得 0）。
- 软键盘 Next 只移动焦点不自动交卷：GapTask 输入框标注 `enterkeyhint="next"`，Enter/Next 触发 `focusNextGap` 移到下一空输入框，最后一空不越界；无 submit 事件。冒烟确认唯一空的 Enter 后焦点保持、页面停留原题。
- 新内容发布后旧会话仍用旧 accepted：T04 服务按 slot.ref 的 packId+packVersion 取包（逐字未动），新增服务级测试钉住：安装 v2（accepted 改为 holds）后旧会话提交 meets 仍判 1/1。

## 9.3 实现清单

- 新增 `src/services/drafts.ts`：`saveDraft/loadDraft/clearDraft`（drafts 表，`[sessionId+itemId]` 键，content 为 JSON 字符串）。T04 learning.ts 逐字未动。
- `src/features/practice/SessionPage.vue`：draft watch 防抖 250ms 自动保存；`restoreDraft` 在 enterSlot/goToNext 进入未完成（answering）题目时恢复；提交或跳过成功后 `cancelPendingDraftSave()` + `clearDraft`（防抖竞态：取消挂起保存先于清除，避免清除后又被回写）；`onBeforeUnmount` 冲刷挂起保存（离开页面不丢草稿）。
- `src/features/practice/GapTask.vue`：text 模式输入框 `enterkeyhint="next"`、`@keydown.enter.prevent` → `focusNextGap`（模板 ref Map，未知类型经 `Focusable` 结构窄化）。
- 新增 `tests/unit/cloze-grammar.spec.ts`（10 项）。

## 9.4 范围决策与偏差说明（供 Sol 审查）

1. 计划 T07 文件清单含 `src/domain/answers.ts`——本轮**无需改动**：accepted 变体与 policy 归一化判分在 T04 已正确实现，本轮以测试钉住（含旧会话版本隔离）。
2. 草稿 content 存 JSON 字符串而非对象：避开 Dexie 事务的 Vue 代理坑（T05 发现），也使 drafts 表内容可审计。
3. 草稿恢复只在 slot.state === 'answering' 且无反馈时进行；已提交/已跳过题目不恢复、其草稿在提交/跳过时清除。
4. 防抖 250ms 与 T09 计划的 500ms 写作串行保存不同：完形单空草稿量小，250ms 足够；T09 实现时按其计划值处理。

## 9.5 未验证项（如实记录）

1. **真机软键盘**：键盘弹出时「当前空、原文上下文、提交按钮仍可见」依赖真实软键盘的视口压缩行为，仿真环境无法复现；本记录只覆盖 Enter/Next 的焦点逻辑与 enterkeyhint 标注。需 iOS Safari / Android Chrome 真机复核。
2. 截图目视复核（3 张：text-draft / draft-restored / cloze-panel）。
3. Sol 独立审查与验收（T05–T07 均待验收）。

## 9.6 技术发现（补充）

- vue-test-utils `mount()` 默认**不附加到 document**：jsdom 中未挂载元素的 focus() 无效（activeElement 停在 body），焦点断言必须 `attachTo: document.body`（unmount 自动摘除）。
- .vue 脚本块的 no-undef 连**类型位置**的 `typeof setTimeout` 也会标记；统一用 `globalThis.setTimeout / globalThis.clearTimeout` 与 `ReturnType<typeof globalThis.setTimeout>`。

## 9.7 复现附录：T07 浏览器冒烟

脚本存于 /private/tmp/t07-smoke.mjs（未入库）。dev server @5179；手机 390x844（hasTouch）：5 分钟单元推进到语法填空 → 断言 clue 文本与 enterkeyhint → 输入 'mee' → 等 450ms → **reload** → 断言输入框恢复 'mee'（截图 draft-restored）→ Enter 后 activeElement 仍为 gap-input 且进度不变 → 填 meets 提交 → 下一题进入阅读题（t06 布局回归）。桌面 1024x768：10 分钟单元推进到 cloze-help-a → 断言两空各自局部选项池并截图。证据 3 张存 `planning/gaokao-english/evidence/t07/`（两处各一份）。

---

# 十一、T08 验证记录（2026-09-11 追加）

适用任务：T08 音频与听力（依赖 T05，内容资产流程依赖 T02；范围以 `03-implementation-plan.md` T08 小节为准，用户「继续」派发）。

## 11.1 结论摘要

| 验证项 | 结果 |
| --- | --- |
| RED 阶段 | 新规格 17 项全部行为性失败（桩服务/空壳组件/未接线），无收集错误 |
| GREEN 后单元测试 | **138/138**（15 个文件；T01–T07 既有 121 项保持通过，T08 新增 17 项） |
| `npm run check` | 通过（exit 0；含 content:check 对真实音频文件 sha256/bytes 门禁校验） |
| `npm run build` | 通过（344.07 kB / gzip 114.80 kB） |
| `npm run test:e2e` | **7/7**（t01×3 + t05×2 + 听力×2） |
| 计划指定验证命令 | `npm run test:unit -- tests/unit/audio.spec.ts` → 17/17 |
| 浏览器冒烟（真 Chromium，**未 stub 播放**） | **真实解码播放**：currentTime 0.52s 前进、duration 19s、0.75× 生效；下载前开始练习禁用；字幕显式开启；两题作答至单元结束（独立 1 + 提示 1） |
| 真机扬声器/键盘 | **未验证**（按计划移交 T14 人工清单） |

## 11.2 计划验收项逐项对照

- 原创短对话音频（真实合成）：macOS `say` 双声线（Daniel/Samantha）合成 6 句对话（WAV 拼接 + afconvert AAC，19.1s），**真实文件 sha256（03a8…2af61）与字节数写入 content/assets/catalog.json，门禁 checkAssetFiles 逐字节校验**——无占位文件。人工听辨核对移交用户。
- 点击调用 play + Promise 拒绝显示重试：AudioPlayer 点击触发 play；NotAllowedError → role=alert 错误条 + 重试按钮；单测+e2e 双层钉住「play 抛错时 Attempt 数不增加」。
- 暂停/重播/0.75 与 1 倍速：状态机组件测试钉住（重播归零+emit replay、速度写 playbackRate+emit speed）；回放与速度经新命令 `recordReplay`/`setAudioSpeed` 记录到既有 Slot.replayCount/audioSpeed 字段（revision 推进、STALE 防护）。
- 字幕与中文提示显式开启：字幕按钮走 `revealHint({hint:'transcript'})` 先落辅助状态再显示（Slot.assistance 含 transcript）；单测+e2e 钉住「字幕开启后的答对计提示后完成、不计独立听辨」。PassagePanel 对听力项不渲染，字幕开启前不泄露原文。
- 音频缺失/加载失败可跳过或返回下载：LearnPage 未就绪单元显示「下载音频」且开始练习禁用；会话内字节缺失显示下载引导 + 跳过此题可用，**跳过不计听力错误**（单测 attempts=0 + e2e summary 首次未通过 0）。
- 离开题组停止音频：AudioPlayer 卸载时 pause + revokeObjectURL；换题由既有 `:key` 重建机制保证。
- 自动化验证状态机：audio.spec.ts 17 项（资产下载/摘要拒收/读取、命令、组件状态机、会话接入）；iPhone/安卓真实播放按计划**不做 jsdom/仿真声明**，移交 T14 配置后的人工清单。

## 11.3 实现清单

- `src/components/AudioPlayer.vue`（新）：对象 URL 生命周期管理、播放/暂停/重播/双速、拒绝重试、卸载停止。
- `src/services/content.ts`：`downloadPackAssets`（fetch→bytes/sha256 校验→downloadJobs 表存原始 ArrayBuffer→翻转 packs.resourcesReady；失败标 failed）+ `getPackAssetBytes`。复用 T02 目录解析与 hash 纪律。
- `src/services/learning.ts`：`recordReplay`/`setAudioSpeed` 命令（既有 Slot 字段首次接入，T04 提交纪律一致：事务+revision+STALE）。
- `src/features/practice/SessionPage.vue`：听力项音频块（播放器/缺失引导/字幕面板）、字幕 revealHint、回放与速度命令接线；PassagePanel 听力守卫。
- `src/features/learn/LearnPage.vue`：未就绪单元的下载入口与禁用态。
- 作者内容：`content/assets/listening-preview.m4a` + catalog、resource `listening-club-audio`（audioAssetId+transcript）、2 道 listening choice items（含 evidence 原文子串）、unit、manifest（gaokao-listening@1.0.0，draft）。
- 测试：`tests/unit/audio.spec.ts`（17）+ `tests/fixtures/listening-pack.json` + `tests/e2e/listening.spec.ts`（2）。

## 11.4 范围决策与偏差说明（供审查）

1. **mime 协议扩展**：本机无 MP3 编码器（无 ffmpeg/lame），macOS 原生 `say`+`afconvert` 产出 AAC/m4a——`AssetMime` 增加 `'audio/mp4'`（types.ts+schema.ts 各 1 行）。计划文件名 preview.mp3 → preview.m4a。
2. **协议无新增字段**：T02 已预留 audioAssetId/transcript/Asset.sha256、Slot.replayCount/audioSpeed、downloadJobs 表、HintKind.transcript——T08 全部为接线，未改 DB schema。
3. `tests/fixtures/audio/preview.mp3` 未创建：资产唯一真身在 `content/assets/`（门禁+打包+e2e 均用它），单测用内存桩字节+固定 hash，避免双份资产 hash 漂移。
4. downloadJobs.data 存储 `{assets:{[id]:{sha256,data:ArrayBuffer}}}`：利用 T03 预留的 data:unknown 字段，避免 DB schema 升版；字节为 IDB 结构化克隆的原始 ArrayBuffer，无代理风险。
5. 运行时资产 URL 由目录约定构造（content-packs/<id>/<ver>/<asset.path>），与 build-packs 输出布局一致。
6. 计划列出的 e2e 文件已建但按计划**不在本任务做真实扬声器验证**（stub play 验证状态机），真播放冒烟仅为开发方附加证据。

## 11.5 未验证项（如实记录）

1. **真机扬声器/软键盘/ interruptions**（来电、锁屏、后台播放策略）与 44px 触控目标：按计划移交 T14 人工清单 + 真机复核。
2. 音频内容的**人工听辨**（发音/语速/音量是否合格）：合成语音需用户听辨确认。
3. 截图目视复核（3 张）。
4. P07 门禁仍预期失败（listening 需 20 段本地录音——现仅 1 段样例），属 T15 边界。

## 11.6 复现附录：T08 浏览器冒烟

脚本存于 /private/tmp/t08-smoke.mjs（未入库）。dev server @5179；手机 390x844（hasTouch）：课程列表→听力单元卡→**开始练习禁用**→下载音频（真实 HTTP+m4a）→会话→**真播放**（无 stub，currentTime 前进）→0.75×→字幕→作答→第 2 题→单元结束。桌面 1024x768 同流程截图。证据 3 张存 `planning/gaokao-english/evidence/t08/`（两处各一份）。


---

# 十、验收记录（2026-09-10，用户授权下由开发模型执行）

**验收授权**：用户明确指示免除 Sol（GPT-5.6）独立验收，由开发模型直接执行验收。特此记录：本验收**不是独立第三方审查**，验收人为实现者本人，独立性仅来自一个无上下文子代理的并行代码复核；真机触屏与截图目视项无法由模型完成，移交用户人工确认。

## 10.1 验收过程

1. **独立子代理复核**：全新上下文子代理逐行读取 T05–T07 全部实现与测试文件，实测 vitest 119/119，按 [严重]/[一般]/[建议] 分级输出发现（报告要点存档于本节 10.2）。
2. **开发方逐项对照**：T05/T06/T07 计划验收清单逐项核对（见第六/八/九节），约束审查（learning.ts 与 t01.spec.ts 无改动痕迹、视图层零直写 IndexedDB、判题器变更仅限 uniqueOptions）。
3. **问题修复后全量复跑**（本节末尾数字）。

## 10.2 复核发现与处置

严重级：**未发现**。

一般级 4 项，**全部当场修复**：

1. GapTask 跨题状态泄漏（任务组件无 :key 复用，上一题的移动确认可残留到下一题）→ SessionPage 三个任务组件加 `:key="item.id"` 强制换题重建，内部 activeGapId/moveConfirm/inputRefs 随之重置。
2. 换题/跳过/提示缺在途重入闸（触屏双击第二次调用持旧 revision，会把 STALE_SESSION 误报成整页错误）→ 新增 `transitioning` 在途闸：goToNext/skipCurrent/requestHint 入口拦截；skip 内部改调 advanceToNext 避免自锁；下一题/跳过/提示按钮增加 transitioning 禁用态。
3. 退出确认文案与 T07 草稿自动保存矛盾（文案称「不会被保存」而行为已落盘）→ 文案改为「已输入内容会自动保存为草稿，下次进入本题时恢复」。
4. 「确认离开」测试无导航断言 → 补 `expect(window.location.hash).toBe('#/today')`。

建议级处置：草稿冲刷异常吞噬（避免 unhandled rejection，已修）；双栏模式下题目窗格恢复 flex 布局（已修）；测试补强 3 项（判题器对非 uniqueOptions 跨空重复的正向不拒绝、防抖窗口边界、跳过后清草稿，已加）。其余记录为已知次要项、不阻塞验收，留待后续任务跟进：证据按钮在未装载对应 resource 时静默无反馈；同段多条证据只高亮第一条；ChoiceTask Enter/Space 双 emit（冗余无害）；reviewed 状态也显示未审核徽标；getSessionSummary 失败与 loadSlotContent 未命中时的静默空白（窄窗口）；e2e 未覆盖输入中途 reload/移动确认/证据跳转（冒烟已覆盖）；软键盘实际行为与 44px 触控目标只能真机验证。

## 10.3 修复后全量验证（2026-09-10）

- `npm run check`：exit 0，14 个测试文件、**121/121 单测**（较验收前 +2：判题器正向 + 防抖/跳过清草稿），lint 0 errors
- `npm run build`：exit 0（335.00 kB / gzip 112.66 kB）
- `npm run test:e2e`：5/5
- T06 focused（reading+gaps）：15/15；T07 focused（cloze-grammar）：修复前 10/10、含新增后随全量通过

## 10.4 验收结论

**T05 基础触屏练习与导航、T06 阅读与七选五、T07 完形与语法填空：验收通过。**

限定条件与移交项：①真机触屏/软键盘行为（M1 门中的「至少一台手机验证触控」与 T07 软键盘可见性）未验证，移交用户真机确认；②15 张冒烟截图未经目视复核，移交用户浏览；③本验收非独立第三方审查（见验收授权说明）；④`npm run content:release` 的 P07 门禁失败为 T15 内容生产边界，非缺陷。T08 起的任务仍建议按协议由 Sol 发布任务单（尤其 T08 的音频素材来源与人工核对清单）。



---

# 十二、T09 应用文与读后续写（2026-09-11）

## 12.1 实现范围

计划文件清单全部落地：`src/services/writing.ts`（服务）、`src/features/writing/WritingPage.vue`（写作视图）、`tests/unit/writing.spec.ts`（16 项）、`tests/e2e/writing.spec.ts`（2 项）。另接入 `SessionPage.vue`（写作占位替换 + revision 传递 + 离开冲刷 + 按钮门控）并同步更新 `tests/unit/practice-ui.spec.ts` 中 1 项 T05 时代的占位测试。

计划九条要求逐条落实：

| 计划要求 | 落实 |
| --- | --- |
| 审题要求/可选提纲/正文/自评表 | WritingPage 四区块渲染（requirementsZh / outline textarea / body textarea / checklistZh 复选） |
| 续写展示原文和两个段首句 | 段首句在 WritingPage 展示；原文复用 SessionPage 既有 PassagePanel（resourceId 非空即渲染） |
| 500ms 串行保存 + saveDraft 显式 revision | 防抖 500ms + 服务层按草稿键串行队列；saveWritingDraft 显式 expectedRevision，过期返回 STALE_SESSION |
| 离开前等待最后写入 | confirmExit/pause 均先 await WritingPage.flushPending()（暴露方法）再导航 |
| 保存失败保留文本和复制按钮 | 保存状态 error → 文案 + 「复制正文」按钮（clipboard.writeText），textarea 值不受影响 |
| finalizeWriting 先保存最新正文再冻结初稿 | 页面 finalize 先冲刷防抖写入，再进事务：读最新草稿→追加版本→slot submitted→revision+1 |
| 修改在新版本、首稿不可覆盖 | writingVersions 只追加（v1/v2…），listWritingVersions 按时间排序回放，无任何更新/删除路径 |
| 提交不产生客观 Attempt | finalizeWriting 事务不写 attempts/reviewStates；单测断言 attempts.count()===0、summary 各客观计数为 0 |
| 显式请求范文记录 model-answer 辅助 | 「查看范文」按钮 → revealHint('model-answer')（slot.assistance 记录）→ 展示范文与版本句段对比 |
| 英文单词计数规则 | 正则 (?<![0-9A-Za-z])[A-Za-z]+(?:[''-]-...)*g：撇号/连字符内连一词、数字不计、2nd 不计；字数仅展示（"仅作参考"），不改变任何通过状态 |

## 12.2 验证证据（2026-09-11，评审修复后终值）

- `npm run check`：exit 0，16 个测试文件、**158/158 单测**（T09 writing.spec 20 项，含评审驱动新增 4 项；practice-ui 占位测试改为断言新行为），lint 0 errors
- `npm run build`：exit 0，**353.99 kB / gzip 117.70 kB**（T08 后 344.07/114.80）
- `npm run test:e2e`：**9/9**（T09 新增 2 项：跳过客观题→写作提交推进；初稿+修改稿两版本并存对比）
- focused：`npm run test:unit -- tests/unit/writing.spec.ts` **20/20**
- 验证场景：输入 draft1 保存初稿→draft2 保存修改稿→重开后两版本都在（单测 6/7 + e2e 第 2 项）；两页并发编辑旧 revision 被拒（单测）；同页快速连存串行保序（单测）；存储失败保留文本+复制按钮（单测）；自动保存失败中止提交不冻结旧稿（单测）；范文重开不破坏 revision（单测）；STALE 自动重同步后重试成功（单测）；连续输入立即离开确认框+落盘（单测）

## 12.3 浏览器冒烟（390×844，hasTouch）

脚本 /private/tmp/t09-smoke.mjs（未入库），dev server @5174：课程列表→校园社团单元→25 分钟→跳过 6 道客观题→第 7/7 题写作视图→提纲+正文输入（字数 0→9，"It's a well-known fact. I have 2 cats and 203 books." 数字正确排除）→已保存→提交初稿→修改→提交修改稿（2 版本对比）→查看范文→下一题→单元结束（独立/提示后/未通过均 0、已跳过 6 题）。截图 4 张存 `planning/gaokao-english/evidence/t09/`（两处各一份）。

## 12.4 实现偏离与说明

1. **WritingPage.vue 为任务窗格内嵌视图而非独立路由页**：计划文件名保留；写作与 SessionPage 的会话状态（slot.submitted→summary、暂停/退出、revision）强耦合，内嵌避免双页会话同步问题。
2. **「保存后断网」以存储失败用例覆盖**：写作草稿为纯本地 IndexedDB，断网不涉及任何网络路径（与 T02 内容下载不同）；put 拒绝即存储失败路径，断网与其等价。
3. **「两页并发编辑」在服务层验证**（revision 链拒绝 + 重载续写）；组件级双挂载未单测。
4. **组件内部 sessionRevision 本地 +1 跟踪**：父级重载完成前再次提交/查看范文不会被误判 STALE（watch 父级 prop 保持权威同步）。
5. **props.db 需 toRaw 解包**：复用 T05 已知结论（Vue 深度响应化代理会使 Dexie 事务抛 PrematureCommitError），WritingPage 内 computed(toRaw(props.db))。
6. **范文按钮对已提交/未提交状态均可用**：辅助记录进当前 slot，不区分时序。

## 12.5 未验证项（如实记录）

1. 截图目视复核（4 张）：开发模型无图像输入能力，留待用户浏览。
2. 真机软键盘弹出对 textarea 布局/滚动的影响：移交 T14 人工清单。
3. 手写体输入、输入法候选词下的防抖时序：仅桌面浏览器验证。
4. 跨浏览器标签页并发写作未测试：saveWritingDraft 的 get+put 未包事务，跨 tab 存在 check-then-put 竞态；单应用单标签为主场景，风险已知未修。
5. 浏览器后退/刷新（beforeunload/onBeforeRouteLeave）无冲刷守卫：应用内路径（返回/暂停/下一题/跳过）均有等待或取消语义，后退最多丢防抖窗口内增量，此前自动保存均在库。

## 12.6 独立评审回填（2026-09-11）

评审方式与 T05–T07 相同：无上下文子代理静态评审（只读，未运行测试），逐行核对计划九条与并发/事务正确性。**本验收仍非独立第三方审查**（评审人为开发模型创建的子代理）。

评审结论摘要：计划九条 7 条 ✅、第 3 条 ⚠️（失败路径违反，见下）、测试场景 4/5；架构层面（串行队列、显式 revision、只追加版本、事务内纯 Dexie await、无 Attempt 副作用）判定正确。

评审发现与处置：

| 级别 | 发现 | 处置 |
| --- | --- | --- |
| 阻塞① | finalize() 忽略 persist 结果：自动保存失败时点提交会冻结旧稿并标 submitted | 已修：persist 返回布尔，冲刷失败即中止提交（「正文尚未保存成功，已中止提交」），不产生版本、不推 revision；新增单测覆盖 |
| 阻塞②(a) | showModelAnswer 无条件本地 revision+1，而重复请求不 bump → 跨挂载后提交必 STALE；含重复死代码 | 已修：以 revealHint 返回的会话 revision 为准；挂载时从 slot.assistance 恢复范文展示态并校准 revision；删除死代码；新增重开单测覆盖 |
| 阻塞②(b)(c) | STALE 无重同步、watch 盲目回写可能倒退本地 revision | 已修：finalize/范文遇 STALE 即 loadSession 重同步；watch 加单调守卫（revision 只增不减）；新增 STALE 重同步单测（重试即成功） |
| 建议③ | 下一题等离开路径无冲刷 | 已修：goToNext 推进前 await flushPending；跳过为丢弃语义，改 abortPending 取消在途防抖（防 clearDraft 后被自动保存复活） |
| 建议⑤ | 确认离开时冲刷失败被静默 | 已修：冲刷失败留在本页（退出框保持），WritingPage 显示保存失败+复制正文；暂停仍为尽力冲刷（失败仅丢防抖增量），如实记录 |
| 建议⑥ | 词计数正则缺 U+2018、U+0027 重复 | 已修：字符类显式 ['\u2018\u2019-]；新增左弯撇号单测（don‘t 计 1 词） |
| 建议⑦ | onMounted 读版本无错误处理，失败则输入永不保存 | 已修：try/catch + 提示文案 + finally 置 loaded |
| 建议⑧ | 双击提交第二次必 STALE 且文案误导 | 已修：finalizing 在途闸 + 按钮禁用 |
| 建议⑨⑩ | 句段对比为整版罗列；e2e 标题与操作不符；unit 断言脆弱 | 对比形态按「版本句段对比」理解保留（计划未定义句级 diff）；e2e 标题改为「初稿提交后继续修改生成 v2」；unit 字数断言定位于 .writing-count |
| 建议④⑪ | skipCurrent 对写作清草稿无确认；queues 无淘汰 | 维持现状：跳过=显式丢弃草稿（与 T05 起语义一致），已加 abortPending 防复活，跳过前确认移交 T10+ 交互打磨；queues 不修（键数有限） |
| 计划缺口 | 「保存后断网」无测试 | 以存储失败用例覆盖等价路径（写作草稿纯本地 IDB，断网不触及网络；见 12.4 第 2 条），记录为覆盖方式差异 |

评审后全量复跑：check 16 文件 **158/158**、e2e **9/9**、build **353.99 kB / gzip 117.70 kB**、focused writing **20/20**。评审报告全文由子代理输出，要点已并入本节；未修复项（跨 tab 竞态、后退守卫、跳过确认、queues 淘汰）已在 12.5 如实记录。

---

# 十三、T10 今日任务、复习与难度建议（2026-09-12）

## 13.1 实现范围

计划文件清单落地：`src/domain/planner.ts`（新）、`src/features/today/TodayPage.vue`（重写为今日计划视图）、`src/features/review/ReviewPage.vue`（新）+ 路由 `/review`；`src/services/learning.ts` 增加今日规划服务函数；`tests/unit/scheduler.spec.ts`（T10 计划固定用例补入）、`tests/unit/planner.spec.ts`（新 17 项）。

计划清单逐条落实：

| 计划要求 | 落实 |
| --- | --- |
| studyDay/addCalendarDays 回归，跨月/跨年/闰年/DST | T04 已有 `studyDayFor`（Intl 时区）与 `addDays`（UTC 构造）；T04 起的 scheduler.spec 已覆盖跨月/闰年/跨年/纽约 DST；本任务补入计划钦定 2 个 scheduleReview 固定用例（2026-09-08 首次次日 + 同日幂等 + 次日推进 stage1/due09-12；needs-help 重置 stage0/lapses+1） |
| D07 间隔规则接入复习列表与今日计划 | submitAnswer 既有 `scheduleReview` 接线（间隔 [1,3,7,14]）；今日规划 `planToday` 按 dueDay≤today 的 reviewStates（键 familyId+reviewMode）优先收集复习组 |
| planner 按预算选整组、dueDay 优先、新目标≤5、真实空态 | `planToday`：复习组 dueDay 升序（seed 散列平局打破，无随机数）→ 新组；整组装入、超预算即停；新条目上限 5（超限整组跳过不拆）；全装不下时回退推荐最短可装组，仍无则 `needsLongerSession: true` 真实空态，单次扫描无死循环 |
| 曝光排除 holdout、熟题重试不计未见题 | exposures 全量 itemId 集 → 全曝光组标 `familiarRetry: true`（熟题复习），未见组不标；「已经见过但跳过的题不当成 holdout」由进入即写 exposure 的事实保证并有单测钉住 |
| 升级建议按 P03 阈值，记录样本数与范围，可忽略 | `suggestLevelUp`：连续 3 次首次错误 → 基础支持；≥10 次有效独立首次 + ≥2 学习日 + ≥3 家族 + 正确率 ≥80% → 建议下一层；否则 hold 显示「样本 x/10」。TodayPage 建议卡可「忽略建议」（localStorage 按学习日记存） |
| 冻结每日会话抽题结果 | `createTodaySession`：seed=sessionId，生成即持久化 slots，重开 `loadSession` 不重抽（单测断言两份 slots 一致）；次日按新 studyDay 另建计划 |

其他固定用例：5 分钟装不下 360 秒七选五（planner.spec ✓）；10 个过期组只装预算内部分且输入不改写（✓）；correctAnswer 不调用 scheduler（T04 起 submit.spec 已断言订正后 reviewStates 不变 ✓）。

新增服务：`previewTodayPlan`（今日计划摘要，供 UI 预览）、`createTodaySession`（空内容 → CONTENT_MISSING；预算装不下 → INSUFFICIENT_SPACE；否则持久化会话）、`collectLevelUpEvidence`（P03 证据采集：有效独立首次、学习日、家族、正确率、连续首次错误）。

## 13.2 验证证据（2026-09-12）

- `npm run check`：exit 0，17 个测试文件、**182/182 单测**（T10 净增 24 项：planner.spec 22 + scheduler 计划用例 2），lint 0 errors
- `npm run build`：exit 0，**364.57 kB / gzip 121.25 kB**（T09 后 353.99/117.70）
- `npm run test:e2e`：**10/10**（新增 t10.spec：今日计划卡生成 → 复习列表空态 → 开始今日计划进入会话页）
- 计划指定验证：`npm run test:unit -- tests/unit/scheduler.spec.ts tests/unit/planner.spec.ts` 全过
- 兼容性：TodayPage 改版保持旧契约（空态 role=status 提示、`.learn-link` 引导、开始今日练习 → /learn），app.spec/practice-ui 既有用例全过

## 13.3 浏览器冒烟（390×844，hasTouch，2026-09-12）

脚本 /private/tmp/t10-smoke.mjs（未入库），dev server @5174：空库今日页空态 → 准备课程内容 → 今日计划卡「2026-09-12 · 复习 0 题 · 新内容 5 题 · 约 5 分钟」（5 组组行、P03 建议卡「待复测」）→ 复习列表（dev 档案含此前冒烟留下的到期复习记录，非空态展示）→ 开始今日计划 → 会话页「第 1 / 5 题」。截图 4 张存 `planning/gaokao-english/evidence/t10/`（两处各一份）。

## 13.4 实现偏离与说明

1. **planToday 为纯函数域模块**：从 packs/reviewStates/exposures 收集候选输入的编排放在 learning.ts（`collectTodayPlanBundle`），域逻辑可测、无 IO。
2. **今日会话 unitId 取首个选中组的单元**：混合复习+新内容的会话没有单一单元归属；submitAnswer 的单元首通成就键沿用该值，语义偏差已知（T11 进度域会重新审视成就口径）。→ **13.4 评审后已改为 unitId=null**。
3. **previewTodayPlan 的 seed 为预览键**（preview:profile:today），与 createTodaySession 的 seed=sessionId 在同 → **13.4 评审后已对齐**：已有今日会话时预览以其 sessionId 为 seed。dueDay 平局打破上可能不同——预览仅为摘要，正式抽题以会话持久化为准。
4. **复习组判定为「组内任一条目命中到期 family+mode」**：整组按复习处理（共享材料不拆），组内未到期条目随之提前复习——保守取舍，如实记录。
5. **跨标签页并发规划未加锁**：两标签同时「开始今日计划」会生成两个会话；同日标记 settings 行仅作尽力去重（竞态窗口仍在），会话本身可并存（T05 已支持继续上次练习），无数据损坏。

## 13.4 独立评审与修复（2026-09-12，回填）

独立评审（上下文无关静态评审，非独立第三方）结论：计划六条+钦定用例逐条核对到行号；planToday 算法（排序稳定/预算停止/回退扫描/无死循环/输入不可变）与 scheduleReview 两钦定用例判定落实。发现 1 项阻塞与 10 项建议，处置如下：

| 编号 | 内容 | 处置 |
| --- | --- | --- |
| B1（阻塞） | collectLevelUpEvidence 未排除提示后正确与熟题重试，且零直接单测 | **已修**：evidence 侧过滤 payload.assistance 非空与 exposures join（firstSeenSessionId≠attempt.sessionId）；连续首次错误仅统计有效独立首次；新增 2 项 DB 级单测（TDD RED→GREEN） |
| S1 | 同日重复「开始今日计划」重新抽题；预览 seed≠会话 seed | **已修**：settings 表记 today-session:<profile>:<day> 标记，active/paused 会话同日复用（completed/跨日另建）；preview seed 优先取既有会话 id；2 项单测 |
| S2 | 今日会话 unitId=首组 unitId 致 unit:first 成就错记 | **已修**：今日会话 unitId=null（Session.unitId 本为 string\|null），submitAnswer 既有守卫跳过成就；1 项单测 |
| S7/S8 | ReviewPage 不过滤 profileId；TodayPage 三处硬编码 profileId；groups 空分支不可达 | **已修**：两页改用 loadPersonalSettings().profileId；死分支移除并入 S4 文案 |
| S4 | 「需补充平行材料」未实现 | **部分采纳**：空态文案补充「当前内容与时长不匹配时需补充平行材料」；材料生产留待 T15 |
| S9 | 计划文本 addCalendarDays 实名 addDays | **已修**：calendar.ts 导出别名 addCalendarDays |
| S10 | 「输入不改写」断言过浅 | **已修**：dueReviews 深比较 toEqual |
| S3 | newCount/≤5 计入已曝光条目；未见版本优先未实现 | 暂缓：当前包无平行变体家族，T15 内容扩充后落地 |
| S5 | D07「选所选层级当前单元」未实现；settings.timeZone 未接线 | 暂缓：单包单层下无感，T15 后实现 |
| S6 | 未到期复习的 needs-help 会重置 stage | **澄清保留**：T04 用例已钉住「提前练习失败→重置」，属「不推进」语义的保守解释，不视为缺陷 |

评审测试缺口清单（8 项）中证据全链路、同日重复行为、planToday 补充语义、输入不改写深比较已随修复补齐；其余（预览-会话组成端到端、studyDayFor 默认时区断言、skip→曝光端到端、P03 建议卡 UI 三态、unit:first 回归）记入 T11+ 待办。修复后全量：182/182 单测、e2e 10/10、build 通过、lint 0 errors。

## 13.5 未验证项（如实记录）

1. 截图目视复核（4 张）：留待用户浏览。
2. P03 升级建议的「接受」动线（跳转课程列表后按层级过滤）未实现完整闭环：当前接受=自行前往课程列表，层级过滤留待 T11/T15 内容扩充后有实际意义。
3. 真机长列表滚动与软键盘：移交 T14。
4. 闰年/DST 仅覆盖 scheduler.spec 既有 UTC 构造断言；Asia/Shanghai 无 DST，真实时区切换场景无法在本机复现。


---

# 十四、T11 成长记录与兴趣反馈（2026-09-12）

## 14.1 实现范围

计划文件清单落地：`src/domain/progress.ts`（新）、`src/features/progress/ProgressPage.vue`（新 + 路由 `/progress`）、`src/components/FeedbackPanel.vue`（扩展奖励动效）、`tests/unit/progress.spec.ts`（新 13 项）。今日页新增「成长记录」入口链接。

计划清单逐条落实：

| 计划要求 | 落实 |
| --- | --- |
| 首次独立客观正确率、提示后完成数、学习日、未见题数量、作品卡 | `summarizeProgress`：objective=独立首次（非辅助、本会话首曝光、非写作）正确率；assistedCompletions=辅助后满分完成数（与独立口径分开）；studyDays 累计去重 + 当日标记；unseenCount=总条目-已曝光；writingCards 初稿/修改稿对比 |
| 地图节点按实际课程内容生成；首次完成单元固定 achievement key，重复提交不重复解锁 | 节点来自 installed packs 的 units；key=unit:first:<unitId>（T04 起 submitAnswer 写入）；重复记录取最早解锁时间，单测钉住 |
| 自评只标自评；少于样本阈值显示数量 | SELF_EVAL_MIN=3；未达标显示「自评样本 x/3，暂不算正式能力等级」 |
| 本周与前期可比较任务；题型/层级分开，不画统一提分曲线 | series 按 kind+level 分桶（本周=周一起算，weekStart 单测含跨月/年初），无统一曲线、无进步结论 |
| 开关音效/动画，低动画偏好无奖励闪动；漏学保留累计成果 | settings.sound/animation 既有字段接线（ProgressPage 开关按钮）；奖励闪动仅动画开+非 prefers-reduced-motion 渲染，CSS 侧同样尊重 reduced-motion，≤600ms 动画、可关闭；studyDays 累计不清零 |

计划钦定验证逐条：首次错后改对保留首次错误（objective 只数 first ✓ 单测）；重复同题10次独立题数不增（按 itemId 去重 ✓）；单元奖励只1条（同 key 去重取最早 ✓）；writing 不进客观分母（kind=writing 过滤 + T09 finalize 本就不写 attempts ✓）。

## 14.2 验证证据（2026-09-12）

- `npm run check`：exit 0，18 个测试文件、**195/195 单测**（T11 净增 13 项），lint 0 errors
- `npm run build`：exit 0，**373.37 kB / gzip 124.00 kB**（T10 后 364.57/121.25）
- `npm run test:e2e`：**11/11**（新增 t11.spec：成长页核心区块渲染 + 奖励闪动可关闭）
- 计划指定验证：`npm run test:unit -- tests/unit/progress.spec.ts` 13/13
- `npm run test:unit -- tests/unit/scheduler.spec.ts tests/unit/planner.spec.ts`（T10 协议沿用）保持全过

## 14.3 浏览器冒烟（390×844，hasTouch，2026-09-12）

dev server @5174：今日页准备内容 → /#/progress 渲染学习地图/作品卡/未见题区块 → 动画开关「关闭动画」切换生效。截图 2 张存 `planning/gaokao-english/evidence/t11/`（两处各一份）。奖励闪动本次冒烟未显示（今日尚无有效任务，todayMarked=false 时按设计隐藏，e2e 中条件渲染分支已覆盖）。

## 14.4 实现偏离与说明

1. **selfEvalSamples 口径**：按写作任务数计（同任务多版本不重复累加；每任务有任一自评即计 1 样本）；阈值 3 为本任务自定（计划未给出具体数值），如需调整只改 `SELF_EVAL_MIN`。（14.6 R6 修正）
2. **提示后完成数定义**：辅助首次且满分完成（earned=possible>0）；辅助但未完成的首次不计入完成数。
3. **作品卡版本口径**：versionNumber 来自 WritingVersionBody.version（v1=初稿，v2+=修改稿）；「不虚构进步结论」由 WritingCard.conclusion 类型 never + 页面无结论文案保证。
4. **本周分界**：以学习日字符串推算周一开始（UTC 日历日运算），与复习调度的日历日口径一致；不做跨时区换算。
5. **ProgressPage 直接读库**：与计划文件清单一致（无 services/progress.ts），装配逻辑在页面层，纯计算在 domain 层。

## 14.5 未验证项（如实记录）

1. 截图目视复核（评审修复后共 4 张，见 14.6）：留待用户浏览。
2. 奖励闪动的真机动效观感（≤600ms 动画时长为 CSS 设定）：留待真机。
3. 音效开关仅存储/接线，首版无实际音效播放文件（P06 默认不自动播放音乐），行为等价于无操作。
4. 单人试用的实际返回/完成率/自述（P06 兴趣检验）依赖真实使用，本地记录口径已备（studyDays/完成率），检验留待试用阶段。

## 14.6 独立评审结论与修复回填

独立评审（上下文无关静态复核，非独立第三方）：T11 主体扎实、四类口径（独立/辅助/订正/写作）隔离干净、无上报、无清零。发现 1 项阻塞 + 11 项建议，处置如下：

| 编号 | 结论 | 处置 |
|---|---|---|
| B1 | `today` 用 UTC 日（`toISOString().slice(0,10)`），与 attempt.studyDay 的 Asia/Shanghai 口径在每日 00:00–07:59 窗口错判今日已标记/奖励 | **已修**：页面新增 `pageToday(now, timeZone)` 域函数（studyDayFor 同源），页面默认路径调用；域级边界测试（16:30Z=上海次日）+ today 注入渲染测试 |
| R1 | exposures Map 仅按 itemId 键控，多包同 itemId 互混 | **已修**：对齐 submitAnswer 的 `packId|packVersion|itemId` 三元组键 |
| R2 | totalItems 按 pack 行累加，换版并存时重复计数 → unseenCount 偏小 | **已修**：按 `(packId,itemId)` 去重计数 |
| R3 | 今日会话（unitId=null）永不解锁地图节点，与 P06 L75「完成首次任务解锁」口径差 | **已修（行为变更）**：独立通过时按条目所属单元（pack.units 反查）写 `unit:first:<unitId>`，与手动单元会话同键；planner.spec T10 旧断言（今日写 0 条）同步更新为「按条目所属单元解锁一次」；冒烟验证真机路径解锁 |
| R4 | achievements.put 覆盖同 id，重复独立通过刷新 unlockedAt | **已修**：put-if-absent 保留首次解锁时间；服务级双会话测试（第二独立通过不覆盖） |
| R5 | 学习日仅由独立首次派生，只做提示后完成/写作的当天不标记 | **已修（口径扩宽）**：学习日=客观/辅助首次作答与写作成品覆盖日（P06「有效任务」口径从宽，客观正确率分母不变） |
| R6 | selfEvalSamples 按 checklist 条数累加，多版本虚增越过阈值 | **已修（口径修正）**：按任务数计（同任务多版本不重复累加），14.4 口径同步更新 |
| R7 | 包卸载/换版后历史 attempt 被页面口径静默丢弃（数据仍在库） | **记录不改**：属 T13 备份/恢复与设置页议题；数据无清零、可回溯 |
| R8 | 写作卡跨会话合并噪声（版本号按会话重置 → 两个 v1） | **已修**：页面按 createdAt 排序取初稿/最新，版本数=记录数；页面级跨会话测试 |
| R9 | 音效开关无 UI | **已修**：ProgressPage 增加音效开关按钮（与动画开关并列），冒烟验证 |
| R10 | P06 路由表「未见题复测、句子成果」入口未落地 | **记录不改**：P06 级能力缺口，属 T12+ 议题 |
| R11 | 奖励闪动每次进入都重现 | **记录不改**：可关闭即达标（评审亦判定可接受） |

评审补充的测试缺口：缺口1（服务级成就一次）与缺口2（时区窗口）本轮已补；缺口3-8（多包装配容错、reward e2e 出现断言、reduced-motion 渲染、地图解锁 e2e 等）记入 T12+ 待办池。

### 评审修复后复验

- `npm run check`：18 个文件 **201/201** 通过（较评审前 +6：B1/R4/R5/R6/R8 及 planner 旧断言更新）。
- `npm run build`：**373.93 kB / gzip 124.22 kB**，通过。
- `npm run test:e2e`：**11/11** 通过。
- 冒烟（Playwright，390×844 触屏上下文）：今日会话首题独立通过 → /progress 显示「今日已标记」、学习地图出现对应节点、奖励闪动渲染并可关闭、音效开关文案切换。截图：`evidence/t11/progress-review-fix.png`、`progress-sound-toggled.png`（连同评审前两张共 4 张）。

## 十五、T12 PWA、课程下载和更新（D09）

### 15.1 实现范围

- `src/services/downloads.ts`（新）：`estimateDownloadFeasibility`（`navigator.storage.estimate` 估算，剩余不足报 `INSUFFICIENT_SPACE`，API 缺失放行）、`startPackDownload`（状态机 absent→downloading→verifying→ready/failed）、`reconcileInstalledPacks`（启动对账：资源缺失标 `needs-download` 并置 `resourcesReady=false`，就绪标志丢失则复位）、`collectDownloadOverview`（页面装配）。
- `src/services/content.ts`：`downloadPackAssets` 重构为两阶段（全部获取→统一校验），新增 `onStateChange` 钩子供状态机写 job 状态；`markFailed` 现在同步置 `resourcesReady=false`（失败后旧 job 数据被覆盖，如实标记未就绪；其他版本包不受影响）。
- PWA：`vite.config.ts` 采用 `vite-plugin-pwa` **injectManifest** + `registerType: 'prompt'`（无 skipWaiting）；`src/pwa/sw.ts` 仅 precache 应用 shell（构建 8 项 / 390 KiB，**不含 content-packs**），`content-catalog.json` 网络优先 + 4s 超时回退缓存，导航离线回退 precache `index.html`；`src/pwa/register.ts` 手动注册（仅 PROD），暴露 `applyUpdate`（仅用户点击触发）、`detectDisplayMode`（standalone / iOS toplevel / browser，仅本地展示不上报）。
- 更新提示：`App.vue` 底部横幅「新版本已就绪」；`SessionPage` 挂载/卸载写 \`gaokao-active-session\` sessionStorage 标志，活动会话点击「更新」只显示提示不重载（D09：活动会话不自动重载）。
- `src/features/settings/DownloadsPage.vue`（新）+ `/downloads` 路由（P05）+ 今日页「下载课程」入口：存储用量/配额、显示形态、iOS「添加主屏幕」说明（含安装前备份与空库导入提示）、包列表（版本/状态/大小）、失败或待重下可重试。
- 图标：`public/icons/icon-192.png`、`icon-512.png`、`maskable-512.png`（maskable 内容落在内切 80% 安全区）；manifest 含 name/short_name/start_url/scope/display/主题色/三种图标。

### 15.2 存储介质偏离说明

D09 原文以 Cache Storage 表述「临时版本 cache」；T02/T08 既定实现将课程 JSON 与音频字节存 **IndexedDB**（`packs` / `downloadJobs` 表，逐资产 bytes+sha256 校验）。T12 遵循既定介质：启动对账交叉检查 DB 与资源完整性，SW 缓存仅承载 shell 与 catalog 回退。该偏离使「断网打开已下载题与音频」不依赖 HTTP 层，负向断言证明资源 URL 断网不可达。

### 15.3 验证记录

- `npm run test:unit -- tests/unit/downloads.spec.ts`：**12/12**（空间估算 3、状态机 3、启动对账 2+损坏容错 1、B1 旧字节保留 1、B2 僵尸作业 1、DB 写失败 1、MIME 1、页面装配 1；hash 不匹配→failed 且 resourcesReady 如实置 false、网络中断可重试、缺失→needs-download、复位→restoredReady）。
- `npm run check`：19 个文件 **210/210** 通过。
- `npm run build`：**373.93 kB / gzip 124.22 kB**；PWA precache 8 项（无题库）；`dist/sw.js` 无 skipWaiting、含 catalog 处理器；`manifest.webmanifest` 字段齐全。
- `npm run test:e2e`：dev **11/11** + 生产 preview 离线 **2/2**（`playwright.offline.config.ts`；主配置 testIgnore 防误跑）。
- 冒烟（Playwright 390×844，生产 preview :4174）：manifest/icon 200 → 准备内容 → 下载页点击下载 → 「音频下载完成」→ SW 接管 → **断网刷新 shell 正常** → 断网打开今日课程（第 1/5 题）→ 断网时音频 HTTP 路径不可达（负向断言）。截图：`evidence/t12/downloads-ready-390x844.png`、`offline-downloads-390x844.png`、`offline-session-390x844.png`。

### 15.4 实现偏离与口径

1. **MIME 校验**：D09 要求「逐个检查 MIME、bytes、sha256」——已实现：默认 HTTP 路径记录响应 Content-Type，与声明 MIME 严格相等或同音频家族（audio/*）视为兼容，跨类型报 `ASSET_MIME_MISMATCH`；preview 实测 .m4a 为 audio/mp4 与声明一致。自定义 fetchBinary 注入路径无 MIME 信息，跳过该检查（仅测试用）。
2. **hash 失败后旧字节丢失**：同版本重下失败会覆盖 `downloadJobs` 数据行并置 `resourcesReady=false`；「旧 ready 版本可用」指**其他版本**的包不被清理，D09 语义一致。
3. **verifying 状态写入**为 fire-and-forget（`void…catch`），失败静默：仅影响 UI 瞬时状态，最终 ready/failed 由引擎事务写入，不影响正确性。
4. **pack JSON 损坏容错**（补充）：启动对账对 pack 记录非对象/缺 id 的情况按不可用处理，标 `needs-download` 而非视为「无资产包」；单测钉住。
5. **B1 语义修正（评审后）**：失败/重下全链路保留旧 job 已有资产字节（downloading/verifying/failed 状态写入均合并旧 assets），`getPackAssetBytes` 以实际存储字节为准（非状态字段），旧 ready 版本在重试失败后仍可读、`resourcesReady` 保持 true——对齐「保持旧 ready 版本可用」。
6. **B2 语义补充（评审后）**：启动对账将中断残留的 downloading/verifying 僵尸作业重置为 needs-download（保留已存字节），下载页出现「重试下载」按钮，消除死路。
4. `package.json` `test:e2e` 串联两个 Playwright 配置（dev + 生产 preview）。

### 15.5 未验证项（如实记录）

1. 真实设备的「添加到主屏幕」安装流程与 iOS Safari 存储分区行为：留待真机（P05 明确浏览器形态不当作真机证据）。
2. 国产安卓浏览器的 display-mode 判定结果：无法自动验证，页面仅做本地展示说明，不上报。
3. SW 更新提示的真实 waiting→激活链路：需要两次发布才能在真机观察；自动化仅覆盖 shell 离线与更新横幅的存在逻辑（`hasActiveSessionFlag` 单元级）。
4. 截图目视复核（3 张）：留待用户浏览。
5. 音频在断网下的真实播放声学验证：留待真机扬声器（T08 约定延续）。
### 15.6 独立评审结论与修复回填

独立评审（上下文无关静态复核，非独立第三方）总评：六条 checkbox 中 1/2/3/5 实质落实；D09 逐句绝大部分有对应实现；「需修复（小修）后可收口」。评审发现的 2 项阻塞与建议处置如下：

| 编号 | 结论 | 处置 |
|---|---|---|
| B1 | 失败重试整体覆盖 downloadJobs 记录，销毁同版本旧 ready 字节，与「保持旧 ready 版本可用」冲突 | **已修**：markFailed/downloading/verifying 写入均合并保留旧 assets；getPackAssetBytes 按存储字节可读；旧字节保留时 resourcesReady 保持 true；测试重写为新语义并验证对账不误标 |
| B2 | 首次下载中断残留僵尸 downloading/verifying 作业，/downloads 无重试出路 | **已修**：reconcile 将非终态作业重置为 needs-download（保留已存字节），按钮出现；单测钉住（resetStaleJobs） |
| R1 | verifying 写入 void+catch 吞错 | **已修**：onStateChange 可返回 Promise，引擎 await；写入失败不再静默 |
| R2 | 启动对账仅挂下载页 | **已修**：App.vue onMounted 全局对账一次 |
| R3 | D09 载体偏离记录不完整 | **已修**：planning 02 D09 增补 v0.1 载体说明；downloads.ts 注释更正为 IndexedDB 口径 |
| R4 | SW catalog：HTTP 错误不回退缓存；cache.put 抛错吞响应 | **已修**：非 ok 先回退缓存；put 单独 try/catch |
| R5 | 空 Content-Type 静默跳过 MIME | **记录不改**：宽松策略（无 MIME 信息时不判）已在注释说明 |
| R6 | 损坏包 UI 显示「无需媒体资源」 | **已修**：overview 暴露 packValid，显示「课程数据异常，待重新下载」+ 重试按钮 |
| R7 | SessionPage 绕过状态机 | **已修**：改调 startPackDownload（含估算与状态落库） |
| R8 | 下载按钮无 in-flight 锁 | **已修**：downloadingKey 锁 + 按钮 disabled |
| R9 | 激活即清理旧缓存，多标签懒加载 404 风险 | **记录不改**：v0.1 单标签为主；限制记录于 15.5 |
| R10 | installPreviewPacks 无超时 | **已修**：默认 fetchText 8s AbortController |
| R11 | /today 空态缺 /downloads 引导 | **已修**：空态操作区新增「下载课程」链接（契约安全经评审 grep 证实） |

测试缺口处置：缺口 1/2（quota/DB 写失败→STORAGE_FAILED）、3（B1 语义重写）、4（僵尸作业）、13（构建产物断言）已补；缺口 5（并发竞态 e2e，UI 层已加锁）、6/7（SW 更新链路需两次发布模拟）、8（sw.ts 单测）、9/10（边缘跳过路径）、11（真机音频播放）、12（display-mode 呈现）记入 T12+ 待办池。

**评审修复后复验**：check 19 文件 **213/213**；build 通过（precache 不含题库由 e2e 断言钉住）；e2e dev **11/11** + 离线生产 **3/3**；冒烟全绿（下载→就绪→断网 shell→断网开课）。

## 十六、T13 导出、恢复与存储失败

### 16.1 范围

- `src/data/backup.ts`：D09 备份 envelope（format/schemaVersion/exportedAt/appVersion/payloadSha256/payload）、递归键排序确定性 JSON 摘要（SHA256）、导出 9 表 + 课程快照（排除 downloadJobs 与音频字节）、导入先限体积再解析、结构/摘要/版本/外键/ID 重复校验、NEWER_SCHEMA/UNSUPPORTED_SCHEMA、单事务恢复（clear+bulkAdd 9 表，失败 Dexie 回滚）、恢复后按资产重算 resourcesReady（音频标缺）。
- `src/features/settings/SettingsPage.vue`：音效/学习日时区偏好、备份页入口、「清除学习数据」二次确认（独立按钮，不清课程与音频，附加清除 today-session:* 会话键）、存储非永久声明。
- `src/features/settings/BackupPage.vue`：导出下载（Blob）、导入校验→数量与替换范围展示→确认恢复→音频重下提示；Safari 安装前导出/安装后导入引导；envelope 保存在非响应式变量（Vue ref 深度代理会致 IDB DataCloneError，评审点已自查修复）。
- 路由 /settings、/backup；今日页工具行新增「设置与备份」；styles.css T13 段；eslint.config.js 为 .vue 补浏览器 globals。
- 测试：tests/unit/backup.spec.ts（11 用例）、tests/e2e/backup.spec.ts（2 用例）。

### 16.2 关键口径

- **只读快照一致性**：exportBackup 逐表 toArray 无显式事务；单用户串行操作下撕裂风险可忽略（D09 未要求导出快照事务）。评审如判需加固，回填本节。
- **体积/条数限制等价验证**：默认常量 MAX_BACKUP_BYTES=50MiB 有断言钉住；50MiB+1 场景以注入 maxSizeBytes 阈值等价验证（避免 50MB 内存分配），50000 条同理以注入 maxAttempts 验证。
- **恢复替换范围**：9 张学习/内容表整库替换；downloadJobs（音频缓存作业）保留不动——恢复的包 resourcesReady 按资产重算，音频重下后写新作业。
- **历史备份复习积压**：reviewStates.dueDay 随备份恢复，可能整体过期形成积压；v0.1 不做归一化，由复习页自然排队（记录待办）。

### 16.3 验证记录

- `npm run test:unit -- tests/unit/backup.spec.ts`：**15/15**（envelope 结构与排除项 1、确定性摘要+键序无关 1、合法通过 1、DIGEST_MISMATCH 1、NEWER_SCHEMA 1、UNSUPPORTED_SCHEMA 1、INVALID_FORMAT×2+INVALID_PAYLOAD 1、ORPHAN_RECORD 1、DUPLICATE_ID×3（sessions/packs/reviewStates）1+1+1、SIZE_LIMIT 1、ATTEMPT_LIMIT 1、A→B 逐表相等+音频标缺 1、注入失败回滚原库不变 1）。
- `npm run check`：全量 **228/228**；lint 0 错误（.vue 块补浏览器 globals 后）。
- `npm run build`：typecheck + content 校验 + vite build 通过；PWA precache 维持 8 项（e2e 断言钉住不含题库）。
- `npm run test:e2e`：dev **13/13**（新增备份 2 用例：导出→清除→导入→摘要一致+音频标缺；损坏摘要拒绝+原库不变）+ 生产 preview 离线 **3/3**。
- 冒烟（探针脚本）：备份导出 18394 字节，摘要 a26c5c08…；清除后导入恢复成功，消息「恢复完成：1 个课程包的音频需重新下载」；下载页状态「待重新下载」。

### 16.4 过程记录

- e2e 首跑发现恢复失败：**DataCloneError**（Vue ref 深度代理 envelope → Proxy 不可结构化克隆入 IDB）→ envelope 改存非响应式变量；单测未覆盖此层（jsdom 无 Vue 响应式介入），以 e2e 钉住。
- DownloadsPage statusText 补「无作业且资源未就绪 → 待重新下载」分支（恢复后场景）；offline.spec 相应断言由「未下载」更新为「待重新下载」。
- 评审修复后（见 16.6）新增：exportBackup 只读事务快照、__proto__ 类危险键拒绝、未知顶层键拒绝、packs/reviewStates 复合主键重复校验、导出侧超限警告、file.size 体积预检前移、备份页 busy 态禁用文件输入与取消键、触控目标 min-height 44px、空库 /backup 全局入口（下载页备份链接）。

### 16.5 未验证项

1. 真机 Safari「安装前导出 / 安装后空库导入」全流程：留待真机（存储分区与文件下载行为与桌面 Chromium 不同）。
2. 双设备互备（iOS 导出 → Android 导入）实际文件交换。
3. 备份文件的落盘完整性（下载管理器接管后的文件损坏场景）。
4. 截图目视复核（评审与报告均不读图，仅结构断言）。

### 16.6 独立评审结论与修复回填

独立评审（上下文无关静态复核，非独立第三方）总评：六条 checkbox 中 1/2/3/4/6 落实，5 因空库无 UI 入口判 ❌；「需修复后收口」。处置如下：

| 编号 | 结论 | 处置 |
|---|---|---|
| B1 | 「设置与备份」链接在 hasContent 块内，空库时 /settings、/backup 全应用无 UI 入口（standalone 无地址栏），违反 D10 空库导入路径 | **已修**：下载页新增「备份与恢复（导入备份）」全局入口（空库可达：今日空态→下载课程→备份） |
| B2 | ID 重复校验缺 packs[id+version] 与 reviewStates[profileId+familyId+reviewMode]，穿透后报笼统 STORAGE_FAILED | **已修**：keyPaths 补两表；新增 2 个 DUPLICATE_ID 单测 |
| R1 | exportBackup 逐表 toArray 无快照，并发写可撕裂 | **已修**：包 `transaction('r', 9 表)` 只读快照 |
| R2 | canonicalize 对 own __proto__ 键丢键/改原型，可预计算摘要绕过校验 | **已修**：validatePayload 递归拒绝 __proto__/constructor/prototype 键 + 拒绝九键外未知顶层键 |
| R3 | 备份页竞态：文件输入未随 busy 禁用、恢复中取消未禁用 | **已修**：两处 :disabled="busy"；confirmRestore 保留 busy 前置判断 |
| R4 | 体积预检在 file.text() 之后，大文件内存峰值 | **已修**：file.size 预检前移（validate 内检查保留双保险） |
| R5 | 同设备恢复时字节仍在库却标 resourcesReady=false，今日页暂无课程直至对账自愈 | **记录不改**：下载页进入即自愈（reconcile），v0.1 接受；恢复完成提示已引导前往下载页 |
| R6 | 导出侧超限无提示（导出成功但导不回） | **已修**：exportInfo 追加体积/条数超限警告（仍允许导出） |
| R7 | /settings 缺「主题」项（P05:63） | **记录不改**：v0.1 主题未实现，PersonalSettings 无该字段；记入 T14+ 待办池 |
| R8 | appVersion 硬编码 0.1.0 与 package.json 双份维护 | **记录不改**：vite define 注入留待 T14 构建治理 |
| R9 | 裸按钮触控目标低于 44px | **已修**：五个新增按钮 min-height:44px + padding 12px |
| R10 | 首装包显示「待重新下载」措辞误导 | **记录不改**：与恢复后语义统一，按钮文案「下载资源」已可区分；口径记录于 16.2 |

测试缺口处置：缺口①（packs/reviewStates 重复）随 B2 补齐；②（UNSUPPORTED_SCHEMA/INVALID_FORMAT/INVALID_PAYLOAD）补 3 用例；③（确定性摘要用例重写为键序倒置等价 payload 校验通过）已重写；④（pack 本体畸形）记录不改（reconcile packValid 兜底）。e2e 用例 1 的 digest 往返等价依赖样例包音频未下载——口径记录，fixture 变化时需 stripReady 比较。

**评审修复后复验**：check 全量 **228/228**；build 通过；e2e dev **13/13** + 离线生产 **3/3**。

## 十七、T14 自动化回归与质量门禁

### 17.1 范围

- **生产链 E2E**：主 playwright 配置切换为生产构建 preview（:4174、reuseExistingServer=false、strictPort、独立输出 test-results/prod-main）；离线配置同端口串联（reuse=false、prod-offline 输出）。三引擎：Chromium 全量 + Firefox/WebKit 基础流程（learning.spec；项目级 testMatch）。WebKit 为引擎模拟，非 iOS 真机（真机项按约定移交）。
- **E2E 内容加载器**：`VITE_E2E=true` 构建经 `src/data/e2e-fixtures.ts`（动态加载 `e2e-fixture-data.ts`，?raw 内联 catalog 与 gaokao-listening/1.0.0/pack.json，按 id/version 精确路由）提供固定 fixtures；音频仍走真实 HTTP；validatePack + bytes/sha256/MIME 校验不关闭、评分逻辑零改动。生产构建条件常量假 → 动态块摇树剔除。scripts/sync-e2e-fixtures.mjs 由 build:e2e 前置同步 public → src/data/fixtures 并做字节防漂移检查。
- **时钟**：服务层 LearningClock 默认实现改 `e2eNow()`（src/data/e2e-clock.ts）；偏移只能经 `window.__GAOKAO_E2E__.advanceDays`（installE2eBridge，仅 E2E 构建安装）修改；生产构建 e2eNow ≡ new Date()，入口缺席（单测钉住 + 发布冒烟断言）。
- **学习回归**：tests/e2e/learning.spec.ts（reload 持久化 + `first-attempt-result` testid、复习跨日走时钟桥、缓存损坏直删 downloadJobs → 启动对账 → 待重新下载）；SessionPage 恢复会话时渲染上轮作答结果。
- **移动/缩放**：tests/e2e/mobile-layout.spec.ts（390/768 viewport 横向溢出、200% 文字缩放、viewport-fit=cover 结构检查；软键盘真机行为移交）。
- **发布冒烟**：scripts/smoke-release.mjs（release 构建 shell 标题 + 无 __GAOKAO_E2E__ + SW 注册三断言；test:smoke 自带 build:release）。
- **CI**：仓库级 `.github/workflows/english-practice-ci.yml`（Node 24、working-directory apps/english-practice、npm ci、三引擎 playwright install、check + test:e2e、失败 trace/截图仅存内部 artifacts；release-smoke job 另跑不含 VITE_E2E 的 build + smoke）。

### 17.2 关键口径

- **E2E/发布构建分离**：test:e2e 用 VITE_E2E=true 构建（fixtures + 时钟桥仅在该构建存在）；build:release/test:smoke 不含标记，防误发测试入口（smoke 含 dist 扫描门禁）。环境变量前缀为 POSIX 写法：本地 macOS/Linux 与 CI ubuntu 一致，Windows 贡献者需 cross-env 或 WSL（R6）。直接 `npx playwright test` 前必须先 `npm run build:e2e`（webServer 不构建，防 stale dist 静默通过）。
- **多引擎覆盖口径**：Firefox/WebKit 跑 learning.spec 基础流程（含三引擎声明运行）；全量回归以 Chromium 为准（WebKit 引擎模拟 ≠ iOS 真机）。
- **fixtures 校验不降级**：fixture pack.json 为真实摘要，下载音频仍走 HTTP 并全量校验；未覆盖的包走真实网络。
- **复习跨日**：advanceDays(2) 仅影响 LearningClock 默认链路；显式注入 now 的调用方（测试/服务）不受影响。

### 17.3 验证记录

- `npm run test:unit -- tests/unit/e2e-env.spec.ts`：**2/2**（非 E2E 构建 fixtures 恒 null、时钟 advance no-op）。
- `npm run check`：全量 **230/230**；lint 0 错误（scripts/*.mjs 补 node globals）。
- `npm run test:e2e`：E2E 构建 + 生产 preview 链全绿——主配置 **29/29**（Chromium 23 全量 + Firefox/WebKit 各 3 基础流程；含 R7 新增 360/1024 档与练习会话页溢出用例）+ 离线配置 **3/3**。
- `npm run test:smoke`：**SMOKE OK**（release 构建：shell 标题 ✓、无 __GAOKAO_E2E__ ✓、SW 注册 ✓）。
- 过程修复：e2e fixtures 初版按 URL 子串匹配导致 demo 包错配 listening pack.json（未通过校验 2 个）→ 改 id/version 精确路由；firefox/webkit 本地缺浏览器 → playwright install；plan 槽位构成随日期变化 → learning.spec 改选项组首选项 + 弹性断言；计划与空态按钮并存 → 精确点击「开始今日计划」。

### 17.4 未验证项

1. CI workflow 未在实际 GitHub Actions 运行（本地无法验证 runner 行为；语法经人工核对）。
2. WebKit/Firefox 引擎对 SW/offline 行为的深度差异（仅基础流程，SW 用例仍 Chromium-only）。
3. 真机 200% 系统级文字缩放与软键盘遮挡（结构性检查已在 mobile-layout，真机行为移交）。
4. Windows 贡献者本地跑 test:e2e 的环境变量前缀兼容。

### 17.5 独立评审结论与修复回填

独立评审（上下文无关静态复核，非独立第三方）总评：六条 checkbox 中 2/3/5/6 达标，1/4 有缺口；「B1 修复后可验收」。处置：

| 编号 | 结论 | 处置 |
|---|---|---|
| B1 | 复习跨日用例恒真（断言 /复习|到期|待/ 与静态标题恒匹配）且 due 语义未建立：ReviewPage.vue/ProgressPage.vue 直连 new Date()，时钟桥只到服务层 | **已修**：两页改 `studyDayFor(e2eNow())`（生产构建零行为变化）；断言改强断言 `.review-status` =「已到期」；三引擎实测通过 |
| R1 | 摇树结论应固化为门禁 | **已修**：smoke-release.mjs 扫描 dist/assets/*.js 禁含 fixtures 专属字符串 |
| R2 | smoke 端口被占静默借道 + npm 孙进程清理不可靠 | **已修**：4174 预检有响应即 fail；改直启 node_modules/.bin/vite + process exit 钩子清理 |
| R3 | CI 细项：quality 缺显式生产 build、release-smoke 重复构建、report 路径 | **已修**：quality 补 build:release 步；smoke 步改 `node scripts/smoke-release.mjs`；两配置加 html reporter（open:never），artifact 路径不再恒空 |
| R4 | sync 脚本 stale 目录不清、catalog 缺失无明确报错 | **已修**：同步前清理陈旧项 + catalog 缺失 fail-fast |
| R5 | SessionPage earned>=possible 与评分器 === 口径不一 | **已修**：对齐 ===（评分器不变量 earned≤possible 下等价） |
| R6 | POSIX-only 与 stale dist 口径未落文档 | **已修**：本节 17.2 记录（Windows 需 cross-env；直接 npx playwright test 前必须先 build:e2e，webServer 不构建） |
| R7 | viewport 缺 360x640/1024x768 两档、未覆盖 /session | **已修**：四档齐备 + 新增最窄档练习会话页溢出用例 |
| 补测 | 订正/未答空确认/暂停恢复/onboarding 无显式用例 | **记录不改**：订正与题型内嵌于 t05 五题单元（显式化记入 T15+ 待办池）；暂停恢复已有 t05 中途刷新覆盖变体；onboarding 首次进入记入待办池 |

**评审修复后复验**：check 全量 **230/230**；test:e2e **29+3 全绿**（B1 强断言三引擎通过）；test:smoke **SMOKE OK**（加固版：dist 扫描 + 端口预检 + vite 直启）。

## 十八、T15 正式课程包生产与独立审核（工具与门禁部分）

### 18.1 范围

- **固定 skillIds 目录**：content/sources/skills.json 登记 26 个技能（vocab×3、sentence×1、grammar×9、reading×5、cloze×2、listening×2、writing×4），与计划 T15 清单一一对应；scripts/release-gates.ts 以 RELEASE_SKILL_IDS 常量钉死，skills.json 增删均触发 CATALOG_DRIFT/MISSING。
- **P07 规模门禁**（既有 checkP07 + 本轮 T15 增量）：718 客观项分 section 最低量、词汇 ≥120 family × ≥3 版本、阅读 18 篇分 G0/G1/G2、七选五 5 空 7 选项、完形 10/15 空分布、语法填空 10 空×12、听力 20 段录音、写作 6+4。
- **平行版本门禁**：同 family 同 section 题干唯一性检查（DUPLICATE_STEM）；draft 起步变体 content/items/vocab-join-b.json（join-context 第二平行题干，非交换选项）。
- **30 次学习计划**：content/sources/learning-plan-30.json——24 新课（每次 goalTargetCount≥5 词句目标）+ 6 复测；长文 section（reading/gap-reading/cloze/grammar/listening/写作）不进 <10 分钟任务；序号连续；按 P07 六段主内容映射技能。
- **review-log 交叉验证**：content/sources/review-log.csv 固定 8 字段表头（packId/version/itemId/author/reviewer/reviewedAt/result/notes）；release 模式要求每个 item 有 result=pass、reviewer 非空且 ≠ author、reviewedAt 有效；当前仅表头（不填虚构审核人）→ content:release 逐 item REVIEW_MISSING、exit 1，**正式 catalog 不出**。
- **单元测试**：tests/unit/release-gates.spec.ts 9 项（TDD：先 RED 后 GREEN）。

### 18.2 关键口径

- **机器自检 ≠ 审核完成**：本轮交付的是工具、draft 课程起步与拦截门禁；718 项内容、20 段录音录音与逐题人工审核、逐段听审是 15-25 日人工投入，未完成。content:release 此刻 exit 1 是设计内正确状态。
- **平行版本机器边界**：机器只拦「题干重复」；不同题干但选项互换的伪平行、变体质量（难度梯度、干扰项合理性）必须靠人工逐题审核——reviewer 字段是唯一放行凭证。
- **review-log 解析限制**：notes 含逗号会破坏 split(',') 解析（简单 CSV，无引号转义，fail-closed 硬抛）；审核记录 notes 留空或用分号。
- **内容变更纪律（R8）**：已发布版本不可变（build-packs 拒绝覆盖同版本不同字节）；改内容必须 bump version 并全量重审；fixtures 由 content:build 自动同步生成（build:e2e = build + VITE_E2E=true vite build），不手工维护。

### 18.3 验证记录

- `npm run content:check`（preview）：**exit 0**（draft 流水不受门禁影响，含新平行变体）。
- `npm run content:release`：**exit 1**，逐 item REVIEW_MISSING（含 vocab-join-b）——门禁按预期拦截。
- `npm run check`：全量 **245/245**（release-gates.spec 15 项含 B1-B3 对抗性钉死 + 原 230 项；listening 内容缺陷修复 + gaokao-listening 1.0.1 / gaokao-protocol-demo 0.1.1 版本 bump）。

### 18.4 未验证项

1. 718 项正式内容与 20 段录音：未生产（人工门禁，移交）。
2. 独立审核人：无 → review-log 无任何行（不填虚构审核人），发布门禁 BLOCKED。
3. 平行变体仅 1 个起步（vocab-join-b），不代表 P07 规模。

### 18.5 独立评审结论与修复回填

独立评审（上下文无关静态复核 + tsx 对抗性 probe，非独立第三方）：立场与骨架正确，但门禁对抗强度低于宣称（四条伪造向量实证可整体通过）、release 门禁未接构建/CI 路径；并纠正本节 18.3 初版实测声明（content:release 32 行失败中含 1 条真实内容缺陷 listening.gist，不止 REVIEW_MISSING）。处置：

| 编号 | 结论 | 处置 |
|---|---|---|
| B1 | 独立性校验可绕：reviewer 空白/大小写伪装第二审核人（精确串比较） | **已修**：release-gates normalizeName（trim+小写折叠）+ author 非空白 + CSV author 交叉比对（AUTHOR_MISMATCH）；validate.ts 同源加固 |
| B2 | rows.find 取首条：pass-在前-fail-在后掩盖复审不通过 | **已修**：任一 fail 即 REVIEW_NOT_PASS（复审语义） |
| B3 | reviewedAt 接受未来时间/date-only | **已修**：ISO 日期时间正则 + 拒未来时间（与 validate.ts release 口径一致） |
| B4 | release 门禁未接构建/CI，「失败不出正式 catalog」空真 | **已修**：CI release-smoke 增 content:release 步（continue-on-error，注释明确 T16 部署前必须转绿） |
| R4 | 30 段计划技能覆盖无检查（reading.main-idea 实测零引用） | **已修**：SKILL_UNCOVERED 门禁 + s22 补 main-idea（26 技能全覆盖） |
| R5 | 平行题干检查单包作用域，跨包重复漏网 | **已修**：跨包聚合（family+section 全局唯一） |
| R7 | listening.gist 真实内容缺陷 + item-demo/unit-demo 孤儿文件 | **已修**：gist→listening.detail（版本 bump 1.0.1）；孤儿脚手架删除；内容变更按 bump-version 纪律执行 |
| R9 | GatePack/GateItem 冗余字段 | **已修**：status/estimatedSeconds/resourceId 移除 |
| R10 | 测试缺口（行级 COLUMNS、NOT_PASS、目录漂移、MIX/ORDER、对抗向量零覆盖、weak 断言、死代码） | **已修**：release-gates.spec 9→15 项，全部补齐；B1 向量修正为大小写变体作者名（中文无大小写） |
| R2 ghost 行 / R6 CI 显式 build / R8 仓库内操作文档 | 加固建议 | R6 已并入 B4（quality job 有显式 build:release）；R2 ghost 行告警、R8 独立操作文档记入待办池（不影响门禁语义） |
| 数量类失败 | 718 项/20 段录音未生产 | **按已知口径为预期剩余缺口**（人工 15-25 日），不计阻塞 |

**评审修复后复验**：check **245/245**；test:e2e **29+3 全绿**；content:release **exit 1 且仅剩 11×REVIEW_MISSING**（审核门禁，预期）；test:smoke **SMOKE OK**。listening.gist 由门禁逮出——恰好证明门禁值得修好再用。

## 十九、T16 HTTPS 部署准备与真机验收

### 19.1 范围

- **版本可确认（spec 条目 3）**：vite define 注入 `__APP_VERSION__`（package.json 版本）与 `__BUILD_SHA__`（CI/发布脚本经 BUILD_SHA 环境变量注入，缺省 unversioned 不伪造）；设置页新增「关于与版本」块（.settings-release-info）：应用版本 + 构建 SHA 8 位 + 内容包 id@version + sha256 前 8 位（经 collectReleaseInfo 汇总，catalog fetch 失败如实显示「版本信息不可用」）；scripts/collect-release-info.mjs 生成 dist/release-info.json（发布批次对账凭证）。组件测试 3 项（渲染/包清单/失败态）+ 服务测试 3 项。
- **deployment-runbook.md**：发布前置门禁表（check/build/content:release/test:smoke/e2e；content:release 未转绿前禁止发布正式 catalog，仅允许受控 draft 环境做真机验收）；缓存头策略（sw.js no-cache、catalog 60s、assets/content-packs immutable 1y、无自定义头托管的折衷）；混合内容核查（同源相对路径）；根路径部署口径（fetch /content-catalog.json 绝对路径）；发布流程（归档 dist-archive/<buildSha> → 上传 → 手机页面核对）；回滚（静态产物切回 + SW prompt 制 + 个人数据不回滚 + 课程不可变版本）；发布授权（未授权前 §3 不执行）。
- **device-matrix.md**：四类真机（iPhone/iPad/安卓手机/安卓平板）× 8 组场景（首次加载安装、离线重开、音频、软键盘、分屏旋转、备份恢复跨设备、课程更新、空库迁移与缓存损坏）逐行矩阵，字段=设备/场景/结果/证据路径/构建 SHA/未解决问题；国产安卓浏览器 PWA 不可装时的网页使用说明行；明确「不写全平台通过除非四类真机都有真实记录」。
- **并发修订收敛（外部 WIP，如实记录）**：T16 期间工作树出现非本会话的并发修改（migrations/learning/db.spec 等，21:27-21:31）——profileId 贯穿 attempt/exposure + CR3 packs 读缓存（WeakMap + invalidatePacks 写侧接线，生产写路径已全部接线）。收敛动作：writeAttempt 补 profileId；4 个测试文件的 attempt/exposure fixture 补 profileId；db.spec 以迁移语义重建（v1 legacy 库 → v2 upgrade 回填 profileId：session 归属行取 session.profileId、孤儿行落 FALLBACK_PROFILE_ID）；session.spec 在直改 packs 表后补 invalidatePacks（对齐 CR3 不变量）。
- **事故记录**：会话期间本代理以「部分 read + 全量 write」方式改 db.spec.ts 造成文件截断（仅剩 11 行）——同因先误伤 listening-meeting-a.json（已从组装产物恢复）。db.spec.ts 依据迁移语义与先前读取的片段重建为 2 项测试（表索引清单 + v2 回填），**原文件中被外部修订加入但未被读取到的任何断言可能已丢失**，需后续评审时与提交历史比对。教训：全量重写文件前必须完整读取（limit ≥ totalLines）。

### 19.2 验证记录

- `npm run check`：**258/258**（release-info 3 + settings 版本区 3 + db.spec 重建 2 + profileId 收敛后全绿）；lint 0 error（131 warnings 为既有 vue 风格类，不阻塞）。
- `npm run build:release`（经 test:smoke 链）+ `node scripts/collect-release-info.mjs`：release-info.json 生成，包含 6 个 catalog 条目版本。
- `npm run test:e2e`：**29+3 全绿**。
- `npm run test:smoke`：**SMOKE OK**（dist 扫描 + shell + 无测试入口 + SW 注册）。

### 19.3 未验证项（真机移交）

1. device-matrix.md 全部 ⬜ 行：iPhone/iPad/安卓手机/安卓平板 × 首次加载/主屏幕/离线重开/音频/软键盘/分屏旋转/备份恢复/课程更新——**无真机，未执行**。
2. Safari 主屏幕与标签页空库迁移、国产安卓浏览器安装降级：结构性说明已入 runbook/matrix，真机行为未验证。
3. 回滚演练（dist-archive 切回）未实际执行（无托管入口）。
4. HTTPS 托管本身：等待用户指定入口与发布授权；默认不触碰原书稿 GitHub Pages。
5. content:release 门禁仍 BLOCKED（T15 独立审核未完成）——正式发布的前置门禁未满足。

### 19.4 独立评审结论与修复回填

评审方式：上下文无关子代理静态评审（同会话内生成，非独立第三方），对照 spec 369-380 行；复核手段含独立复跑 unit（258/258 与实现声明一致）、逐字节解析 dist/sw.js precache manifest、public 与 dist catalog diff。报告全文（结论表/逐项排查/B/R/测试缺口/总评）已归档于本条目所在会话记录。

- **B1（SW 缺 SKIP_WAITING 监听器，阻塞）**：registerSW(true) 发送 {type:'SKIP_WAITING'}，但 sw.ts 无对应监听 → 新 SW 永远 waiting，「确认更新」与回滚后确认语义失效。修复：sw.ts 增加 message 监听 → self.skipWaiting()；smoke-release.mjs 新增门禁「dist/sw.js 必须含 SKIP_WAITING」（防回归）。
- **B2（BUILD_SHA/release-info 链不可复现，阻塞）**：CI 两 job 未传 BUILD_SHA；collect-release-info 未接线，dist 产物曾被后续 build 覆盖丢失。修复：build:release 链末尾串接 node scripts/collect-release-info.mjs；CI quality 与 release-smoke 两 job 的 build 步骤注入 env BUILD_SHA=github.sha；smoke-release.mjs 新增门禁「release-info.json 存在且 buildSha === BUILD_SHA env（缺省 unversioned）」。本地验证：SMOKE OK，日志输出「release-info.json 已生成： 0.1.0 unversioned + 6 包清单」。
- **R1**：SettingsPage catalog 失败态改为仍显示构建期 appVersion/buildSha（仅内容包清单降级为「版本信息不可用」），离线真机行可记版本；补回归测试（失败态含 0.1.0 与构建 SHA）。
- **R2（Exposure 跨 profile 独立性）**：原方案「主键补 profileId」被 Dexie 拒绝（UpgradeError: Not yet support for changing primary key），改为语义修正：submitAnswer 独立判定增加 row.profileId !== session.profileId 放行分支，与规划/证据侧 per-profile 过滤口径一致；per-profile 曝光行记入多用户版本范围（migrations.ts 内注释）。v0.1 单 profile 行为不变。
- **R4**：device-matrix.md 补 iPad/安卓平板的备份恢复接收端（6.1a/6.1b）与课程更新（7.3/7.4）行；3.3/4.3 拆分为单设备行（3.3/3.4、4.3/4.4）。
- **R5**：db.spec 孤儿 attempt/exposure 断言精确化（toBe(FALLBACK_PROFILE_ID) / toBe('profile-a')）；新增「session 行缺 profileId → FALLBACK」用例（v2 迁移 fallback 分支）。
- **R3**：并入 B2（smoke 校验 release-info 存在性与一致性）。

评审未复跑 e2e（29+3 为实现侧声明）；评审后实现侧已全量复跑（见 19.5）。

### 19.5 评审修复后全量门禁（T16 终态）

- `npm run check`：**260/260**（+R1 回归 1、+R5 fallback 用例 1、db.spec 断言精确化）
- `npm run test:smoke`（= build:release + collect-release-info + smoke 门禁）：**SMOKE OK**，含 SKIP_WAITING 与 release-info/BUILD_SHA 一致性门禁
- `npm run test:e2e`：**29+3 全绿**
- 门禁历史：check 中途出现 2 处实现侧小错（migrations 重建时 configureSchema 被误删、learning 4-key 残留）——均已修复并全量复跑，最终状态以上述为准。

### 19.6 T16 遗留（全部为人工移交/待授权，无未闭环的可自动化项）

1. device-matrix.md 全部 ⬜ 行（四类真机 × 8 组场景，含 6.1a/6.1b/7.3/7.4 新增行）——无真机。
2. 回滚演练（dist-archive 切回 + SW 更新确认）——无托管入口。
3. HTTPS 托管选择与发布授权（§3 未授权不执行；默认不触碰原书稿 GitHub Pages）。
4. content:release 门禁 BLOCKED（T15 独立审核未完成）——正式发布前置门禁。
5. R2 后续：多用户版本以新表重建 per-profile 曝光行（Dexie 主键限制）。

## 二十、T17 七天试用与 v0.1 验收

### 20.1 范围

- **pilot-report.md 建立**：每日记录协议（任务完成/实际时长/独立首次表现/主观难度/是否愿意再练——只存所需汇总，不存可识别信息）；首次独立完成基础单元的「需要帮助的操作」记录项；明确不以开发者演示代替用户试用。当前状态=**试点未开始**，D1-D7 占位，不伪造数据。
- **第 7 天平行题抽取（自动化，TDD）**：src/services/pilot-day7.ts 纯函数——selectUnseenParallel（同 family=同题型/同辅助结构 + 同技能 + 同层级 G0/G1/G2 + 未曝光；确定性无随机、count 截断保序）、collectExposedItemIds（backup exposures 按 profile 聚合）、practicedFamilyIds；scripts/pilot-day7.ts CLI 读试点备份导出 JSON，输出每技能×层级建议与缺口清单（无候选如实标缺口）；npm run pilot:day7。测试 5 项（排除已曝光/family 未练不入选/skill-level 不匹配/顺序稳定/按 profile 聚合）。
- **阻塞判定**：数据丢失、答案错判、无法退出/恢复、音频阻断=阻塞，修复并复测后才发布；其余为一般问题。
- **P09 逐条验收（真实状态）**：P09-2/4 自动化覆盖 ✅；P09-5/7 自动化 ✅ + 真机 ⬜；P09-3 ❌（content:release BLOCKED，718 项独立审核未做）；P09-6 ❌（四类真机未验收）；P09-8 ❌（试用未开始）；P09-1 ⬜ 待真机。**v0.1 不标注完成**，结论与局限预置不可删改（单人试用不能推断稳定提分）。

### 20.2 验证记录

- npm run check（评审修复前基线）：**265/265**（+pilot-day7 5 项）；评审修复后终态 275/275（见 20.3）
- pilot:day7 CLI（评审后终态：envelope 校验拆包 + loud fail + 解析层测试；真实数据待试点备份产生后运行）

### 20.3 独立评审结论与修复回填

评审方式：上下文无关子代理静态评审（同会话生成，非独立第三方）；独立复跑 unit（265/265 属实）、实测 content:release exit 1（恰 11×REVIEW_MISSING）、实测旧 CLI 对 envelope 备份静默空输出 exit 0（B1 复现）。

- **B1（阻塞）**：pilot-day7 CLI 不拆备份 envelope 的 payload 层（format=gaokao-personal-backup/payload/payloadSha256），对真实导出 0 输入→0 建议→exit 0 静默失败。修复：CLI 复用 validateBackupJson（含摘要核对），分析逻辑抽为 analyzeBackupPayload 纯函数；空 items/空 exposures/旧 schema（曝光行全缺 profileId）均 loud fail 非 0 退出；直接调用守卫使 CLI 主流程可测。补解析层测试 10 项（envelope 主流程/空输入/多版本去重/多 profile/缺口语义/alsoCovers/格式错误）。
- **R1-R4**：空输入 loud fail；输出含 profile 计数、多 profile 必须显式传参、缺口语义区分 never-practiced / no-unseen-candidate；同包多版本同题去重；多技能题标 alsoCovers。
- **R5**：pilot-report §二改为如实口径（无静态辅助配置，辅助可用性由题型/栏目/资源决定；同 family 结构一致未被内容门禁强制），并补施测要求——第 7 天平行题须在无提示新会话中作答方满足「辅助条件一致」。
- **R6**：count=3 默认值写入文档与 CLI 参数；D1-D7 表保持 spec 五字段不变。
- **R7**：旧 schema 备份 → OLD_SCHEMA 错误退出（不再静默视为全未曝光）；部分行缺失则告警并计数。

评审后全量门禁：npm run check **275/275**（+解析层测试 10 项，含 pilot-day7 5 项与 CLI 解析 10 项中的其余 5 项——合计 pilot 相关 15 项）。

### 20.4 二次并发修订收敛（外部 WIP，如实记录）

T17 期间（13 日 08:42）工作树再次出现非本会话修改：packs 读缓存失效机制由「写侧手动 invalidatePacks」改为「createDatabase 注册 Dexie CRUD 钩子自动失效」（db.ts 接线 + pack-reader.ts 新增 registerPackCacheInvalidation + 写侧手动调用全部移除）。收敛：pack-reader.spec 两条按新语义改写（直写后立即可见/update 即时失效/invalidatePacks 保留为手动逃生口），全量复跑绿。本会话 T16 期间补的 session.spec invalidatePacks 调用成为冗余但不报错，保留。

### 20.5 移交/未完成（不伪造）


1. 七天真人试用与每日记录——**需真实用户执行**，代理不得代跑或编造。
2. 第 7 天平行题实际抽取——待试点备份导出后运行 pilot:day7。
3. P09-3 内容独立审核、P09-6 四类真机——沿用 T15/T16 移交。
4. v0.1 完成标注——待以上全部真实完成后才能给出；当前所有任务（T01-T17）的可自动化部分已完成。

## 二十一、CR1–CR5 全量代码评审修复（评审清单落地）

### 21.1 范围与交叉说明

- 依据 `dispatch/T14-code-review.md`（CR1–CR12，P1–P4，存于主仓库 planning）。本轮按 §E 建议顺序实现 CR1/CR2/CR3/CR4/CR5 及 CR12.5（草稿清理随 CR1）；CR6–CR12 其余项保持待办。
- 本节与 20.4 是同一批并发修订的两条记录线：20.4 由 T17 会话收敛记录（其视角），本节由评审修复会话完整记录。两条线交叉期间曾出现测试与类型错误的中间态，最终收敛一致。

### 21.2 修复内容

- **CR1 会话完成态**：新增 `completeSession`（learning.ts）——进入总结前置 `completed` 并在同一事务清理本会话残留草稿（幂等，重复调用不推 revision）；SessionPage `finishSession` 在 enterSlot/advanceToNext 的 summary 分支接线。`completed` 不再是死状态；attempts/exposures 作为统计底账保留。
- **CR2 profileId 数据模型**：DB schema v2——attempts/exposures 增 profileId 列与索引（attempts 另补 sessionId 索引），upgrade 按 sessions 表回填、找不到会话的孤儿行落默认 profile（FALLBACK_PROFILE_ID）；attempt payload 携带 profileId；collectLevelUpEvidence、collectTodayPlanBundle 的曝光、ProgressPage 的作答与曝光均按 profile 过滤（旧数据无字段视为同 profile）；restoreBackup 对旧版备份行做同样回填。
- **CR3 packs 读取缓存与 N+1**：新增 src/data/pack-reader.ts——WeakMap 按 db 实例隔离的缓存；失效机制唯一：createDatabase 注册 packs 表 CRUD 钩子自动失效（20.4 所述即此变更；不依赖写侧手动调用，测试直写/恢复备份等旁路写入同样覆盖）；getSessionSummary 去 N+1（attempts 按 sessionId 索引一次拉回 + 曝光一次性建内存映射）；SessionPage loadSlotContent 走缓存。
- **CR4 今日会话竞态**：createTodaySession 的 marker 复用判定、建会话、写 marker 收进同一 rw 事务；并发调用在事务上串行化，第二个调用复用第一个的会话。
- **CR5 构建链去重**：package.json 拆出 build:vite；build:e2e = typecheck + content:check + content:build + sync-e2e-fixtures + 单次 VITE_E2E vite 构建（不再整跑 build，CI 少一次 vite 构建；sync-e2e-fixtures.mjs 首次真实接入脚本链，此前注释声称前置执行但从未接线）；build/build:release 语义不变。

### 21.3 验证记录

- 红灯：先写 8 个失败用例——completeSession×2、并发冻结×1（复现 race-a/race-b 双会话）、profile 过滤×2、pack 缓存×3（含外部直写不可见/隔离性）。
- `npm run check`：**275/275**（28 文件；含 CR 用例 8 项与 T17 收敛项）；typecheck、lint 0 错误。
- `npm run build`：通过（vite precache 413.20 KiB）。
- `npm run test:e2e`：主配置 **29/29**（chromium 全量 + firefox/webkit 基础流程）+ 离线配置 **3/3**。
- 发布冒烟：**SMOKE OK**（dist 无 fixtures 痕迹、shell 标题、无 E2E 桥、SW 注册）。

### 21.4 未验证项与移交

1. completed 会话的归档/删除策略与备份体积治理（CR12.2）未实现——本轮只做到「完成即置 completed + 草稿清理」。
2. v1→v2 迁移未在 iOS/Android 真机实测（随 T16 真机移交项一起验）。
3. CR6（暂停/退出草稿保护一致性）、CR7（复习列表可用性）、CR8（卸载包统计口径）、CR9（恢复后音频提示）、CR10（重复实现抽取）、CR11（STALE 自动恢复）、CR12.1/12.3/12.4/12.6 未动，保持待办池。

## 二十二、应用合入主仓库与设置入口收尾

### 22.1 范围

- **交付落地**：`apps/english-practice` 整体合入主仓库（源自 `/private/tmp/gaokao-english-glm-worktree`，含 T15–T17 成果与 CR1–CR5/CR12.5 修复）；planning 新增 deployment-runbook.md、device-matrix.md、pilot-report.md；`.github/workflows/english-practice-ci.yml` 以工作树版本为准（quality 与 release-smoke 两 job 均注入 `BUILD_SHA: github.sha`，B2 修复完整落地）；根 `.gitignore` 增加 `apps/english-practice/dist/`。隔离工作树自本次合并起废弃，主仓库为唯一代码基线。
- **评审遗留收尾**（T16 事故项 + onboarding 可达性）：
  1. db.spec 补回「后续版本迁移失败韧性」用例（v2→v3 upgrade 抛错时拒绝打开且已升级数据完整保留）——T16 截断事故中丢失的原「迁移失败保数据」测试按当前 schema 语义重建。
  2. SettingsPage 练习偏好补齐年级/目标/默认时长三字段（读经 loadPersonalSettings、写经 savePersonalSettings，同时消除该页绕过设置服务直写的 CR12.6 不一致）。
  3. TodayPage 首次使用（settings 表无 personal 记录）显示「完成学习设置」引导卡，链接打通 /onboarding 孤儿路由；保存或跳过后不再出现。
  4. 新增 `tests/unit/onboarding-setup.spec.ts` 3 项（空库默认值+合并保存、已有设置回显+保留未改字段、首启入口出现/消失）。

### 22.2 验证记录

- `npm run check`：**279/279**（275 + 新增 4：onboarding-setup 3 + db.spec 迁移韧性 1）；typecheck、lint 0 错误（112 条 vue 风格 warnings 为既有存量）。
- `npm run build:release`：通过，release-info.json 生成（0.1.0 unversioned + 6 包清单）。
- `npm run test:e2e`：主配置 **29/29**（chromium 全量 + firefox/webkit 基础流程）+ 离线配置 **3/3**。
- 发布冒烟：**SMOKE OK**（dist 无 fixtures 痕迹、shell 标题、无 E2E 桥、SW 注册、release-info 与 BUILD_SHA 一致）。
- 环境怪癖（如实记录，非产品缺陷）：本机自动化框架将长时命令转后台并以沙箱承载时，smoke-release.mjs 的 loopback fetch 与 vitest 启动会无限阻塞（0% CPU 挂起）；非沙箱前台裸调用同一命令均正常通过。CI/Linux 不受影响；本地复跑冒烟建议直接 `node scripts/smoke-release.mjs`。

### 22.3 移交/未完成（不伪造）

1. 正式内容编写与独立人工审核（P07 约 718 项；`content:release` 仍 BLOCKED）——需内容作者与独立审核者。
2. 四类真机验收（device-matrix 全部 ⬜）、七天真人试用、第 7 天平行题实际抽取、HTTPS 托管与发布授权——沿用 §20.5/§19.3 移交。
3. 评审清单 CR6–CR12（除 12.5/12.6 已顺带处理）保持待办池。
4. 根 README/CHANGELOG 尚未向读者介绍应用（本次不含营销性内容，待产品定名后补充）。

### 22.4 提交落地与安全收尾（2026-09-14）

- 首次提交被 Mimosa 阻断（2 项 high）：`scripts/subset-pdf-fonts.py` XML 内部实体扩展（XXE/billion-laughs 面）；`apps/english-practice/tests/e2e/backup.spec.ts` 临时文件落 `/private/tmp` 固定前缀路径（符号链接/抢注风险）。
- 修复与验证：
  - subset-pdf-fonts.py 新增 `parse_chapter`——章节 ≤ 8 MiB、拒绝自定义 `<!ENTITY>`、仅放行生成器简单 DOCTYPE 序言并在解析前整体剥离；真实 epub 62 章全部解析通过、3 类攻击载荷（自定义实体/复杂 DOCTYPE/超长章节）全部拒绝、`&amp;` 预定义实体正常。修正了实施中一度写出的「带空格 needle 查无空格 haystack」比较 bug（`<!doctypehtml>`）。
  - backup.spec.ts 临时文件改 `fs.mkdtempSync(os.tmpdir())`（主仓库与隔离工作树两份同改，diff 字节一致）；typecheck 通过、该文件 E2E 复跑 **2/2**。
- 根 `.gitignore` 增加 `.mimosa/`/`.v2c/`/`.video_agent/`（本轮 `git add apps/` 曾把 `.mimosa` hook 状态文件带入暂存区，已移出并忽略）。
- 提交 `2104105`「Land english-practice app with review fixes」落地 master：196 文件、+32326 行。push 未执行（未授权）。
- 如实记录：该次提交 Mimosa 未取得完整扫描结论（library_source 不可用、callgraph 部分缺失），按兼容策略放行——不据此宣称项目安全，完整深度审计待补跑。
- 提交者身份为 git 自动配置（`吴 <wu@wudeMacBook-Air.local>`），与仓库既往作者 `Leap 离谱 <pg98@vip.qq.com>` 不一致；如需统一，配置身份后于 push 前 `git commit --amend --reset-author`。

## 二十三、第二轮全量代码评审与 CI 实测（T18）

### 23.1 推送与 CI 实测（2026-09-14）

- 推送 fork（`ceed862`，快进）后 GitHub Actions 三条工作流全红，逐条诊断：
  - english-practice-ci：quality job **全绿**（279 单测 + typecheck + lint + 生产构建 + 主配置 E2E 29 + 离线 3，2m07s）——合并基线在真实 CI 的最强验证；release-smoke 失败根因为 workflow 两处叠加缺陷：第 39/72 行 `BUILD_SHA: \${{ github.sha }}` 带字面反斜杠（CI 日志确认 env 值 `\ceed862…`，污染 release-info 与设置页展示），且 smoke 步骤未定义 BUILD_SHA env（`?? 'unversioned'` 恒不匹配）。本地当时全绿为 build/smoke 两侧均 unversioned 的巧合；冒烟门禁正确拦截，校验链有效。修法（CR13/CR14，见 T18 文档）：去反斜杠 + smoke 步骤补 env + smoke 增加格式断言。
  - 根 CI：validate 失败于 `npm audit --audit-level=high`（根 lockfile 本轮未触碰，上游既有审计项）。
  - Deploy Pages：`configure-pages` 404——fork 未启用 GitHub Pages（环境配置）。
- 身份统一：filter-branch 重写两个未推提交的 author/committer 为 `Leap 离谱 <pg98@vip.qq.com>`（tree diff 为零），仓库级 git config 已设；推送至 fork `ahczdr/English-level-up-tips`（快进，覆盖其 6 月以来的落后）。用户确认 GitHub 账号为 ahczdr，上游 byoungd 不管。

### 23.2 第二轮全量评审落盘（2026-09-15）

- 三路并行独立通读（服务/数据/领域、UI、构建/发布/CI + 仓库集成）+ 关键发现人工复核，落盘 `dispatch/T18-code-review.md`：CR13–CR65 共 53 项（P1×2、P2×14、P3×24、P4×13），编号自 CR13 顺延，不重复 T14 的 CR1–CR12；含已确认无问题清单与四批建议处理顺序。
- 重点新发现：CR17 未到期已曝光题以「新内容」反复入计划且做对被判 needs-help 打回 stage 0（调度核心口径缺口）；CR18/CR19 学习日时区口径分裂与写作 UTC 日期；CR20 本轮 onboarding 修复的三处缺口（跳过不落标记/保存默认覆盖写/文案错位，已复核源码属实）；CR21 备份 `__proto__` 深度绕过；CR25 大面积页面零 CSS。
- 更正记录（如实）：评审过程中「app 未推送、CI 从未生效」为过时结论（评审与推送并发），「smoke 与 env 自洽、发现不了污染」的推断与实测相反，均以 CI 实测为准。
- 本轮未修改产品代码；修复待派发。

## 二十四、T18 修复轮：CR13–CR28 批次落地与 CI 首次全绿（2026-09-15）

### 24.1 修复内容（三个提交，均推送 fork）

1. `ed377d2`：CR13/CR14——workflow 两处 `BUILD_SHA` 去字面反斜杠、release-smoke 步骤补 `BUILD_SHA` env；smoke-release.mjs 增加「40 位十六进制或 unset」格式断言（脏值 `\ceed…` 与「env≠release-info」两种输入实测按预期 exit 1）；.gitignore 增 `.content-stage-*`；worktree prune + 删除 `codex/gaokao-english-glm` 分支（CR60 部分/CR64 git 部分）。
2. `90e05ef`：CR17/CR20/CR22/CR24/CR25/CR26/CR27/CR28 + CR18 文案部分 + CR42/CR45，详见 T18 §H.1。CR17 语义：整组已曝光且无到期复习的组不再作为新内容重排；候选全排除时 planToday 返回真实空态（needsLongerSession=false），createTodaySession 返回 kind='empty'（「今日计划已全部完成」），与 INSUFFICIENT_SPACE（预算不足）区分。
3. `067d54b`：**CI 实测新发现并修复**——smoke-release.mjs 成功路径从不退出（vite preview 子进程管道使事件循环永续），SHA 检查通过后脚本打印 SMOKE OK 即挂死；这正是 CI release-smoke 两次长时间无进展的根因（此前 CI 总在 SHA 比对处先失败，浏览器段从未到达）。修复：成功路径 cleanup + process.exit(0)，失败路径 finally 关浏览器（CR58 完整版）。

### 24.2 验证记录

- 红灯先行：CR17×3 + CR20×2 + CR27×1 共 6 个新用例先写（4 红 2 绿守卫），实现后全绿；app.spec 2 用例为 CR24 适配（新增 settleToday：等加载完成再点击，disabled 按钮 VTU 不触发）。
- `npm run check`：**285/285**（29 文件；279 + 6）；typecheck、lint 0 错误。
- `npm run build:release`：通过；`node scripts/smoke-release.mjs` **SMOKE OK 且 exit=0**。
- **CI 终验全绿**（fork run `34965565933`）：quality ✓ 2m09s（含 285 单测 + 生产构建 + 主配置 E2E 29 + 离线 3）+ release-smoke ✓ 38s，整条 success 2m54s——english-practice-ci 自落地以来首次整条通过。

### 24.3 更正与环境说明（不伪造）

- **更正 §22.2**：所谓「smoke-release.mjs 本地沙箱挂起」根因是 24.1 第 3 条的退出 bug，输出被管道 `tail` 缓冲掩盖造成「0 字节挂起」假象；修复后本地前台直跑正常退出。主仓库 vitest 本轮前台直跑正常，此前「主仓库 vitest 挂起」的记录很可能同样与命令自动转后台机制有关，非产品或环境缺陷；下次复现时再核实。
- 本轮 CI 共取消 2 个 run：`34961339949`（release-smoke 38 分钟无进展，事后证实为退出 bug）、`34964709335`（被修复提交取代）。
- 根 CI（npm audit）与 fork Pages 未动，维持 T18 CR15/CR16 的环境决策建议。
- **身份更正（2026-09-15，用户确认）**：提交者身份最终采用 GitHub 账号 `ahczdr`（noreply 邮箱 `58420023+ahczdr@users.noreply.github.com`），不再沿用 §22.4 建议的仓库既往作者；本方 7 个提交已整体重写并强推 fork（树内容零差异），仓库级 git config 同步更新，后续提交均为此身份。

### 24.4 仍开放

CR18/CR19/CR38/CR54（时区口径统一）、CR21、CR23、CR29–CR36、CR46–CR52、CR53–CR57、CR59–CR65；T14 遗留 CR6–CR12。
