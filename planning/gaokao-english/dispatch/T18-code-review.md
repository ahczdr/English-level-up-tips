# T18 第二轮全量代码评审（合并后主仓库基线 + 推送实测）

版本：1.0，2026-09-15。评审人：GLM-5.3-Flash（ZCode 会话：三路并行独立通读 + 关键发现人工复核 + 真实 CI 实测诊断）。
性质：**静态代码评审 + CI 实测证据**。未修改产品代码，不改变 T01–T17 的验收状态。发现项供派发修复任务时引用。
与 T14 的关系：编号自 **CR13** 顺延。CR1–CR5 与 CR12.5/12.6 已修复（verification-log §21），CR6–CR12 仍开放，本文不重复报告它们。

## A. 评审范围与基线

- 代码基线：主仓库 master `ceed862`（身份重写后已推送 fork 的状态；工作树 `/private/tmp/gaokao-english-glm-worktree` 已废弃，主仓库为唯一基线）。行号基于该 commit。
- 三路并行评审（各路独立通读）：① 服务/数据/领域层（src/services、src/data 非 e2e 文件、src/domain、src/content，约 3400 行）；② UI 层（src/features 全部 Vue、src/components、router、styles.css、index.html）；③ 构建/发布/PWA/测试/CI 链与仓库集成（vite/playwright 配置、scripts、src/pwa、e2e 桥、workflow、README 等根文档）。
- 人工复核项：BUILD_SHA 反斜杠（`sed -n 'l'` 确认文件真实字节）、fork 三条工作流失败日志（gh run view 逐条）、OnboardingPage 全文、根 README/CONTRIBUTING 对 app 零提及、quality job 全绿结论。P4 杂项组为各路核实结论，未逐条二次复核。
- 相对代码路径以 `apps/english-practice/` 为根（沿用 T14 约定）。

## B. 总体评价

- **quality job 在真实 CI 全绿**（279 单测 + typecheck + lint + 生产构建 + 主配置 E2E 29 + 离线 3，2m07s）——合并基线在远端环境得到最强一次验证。冒烟门禁亦正确拦截了 workflow 配置缺陷（见 CR13/14），校验链本身可信。
- 代码主体质量延续 T14 判断。本轮 53 项新发现集中在三类：① CI/provenance 配置缺陷（CR13/14，实测踩雷）；② 计划/调度/时区的口径分裂（CR17–CR19，连续多日使用后必然显现）；③ 近两轮修复的遗漏面与 UI 修复引入的缺口（CR20/CR28、CR47–CR51）。无新的「数据损坏级」缺陷；CR13/14 的 P1 定级针对 CI 阻断与 provenance 污染，非产品数据风险。

## C. 发现清单总表

| ID | 级别 | 主题 | 位置 |
| --- | --- | --- | --- |
| CR13 | P1 | BUILD_SHA 带字面反斜杠，污染 provenance（CI 实测） | .github/workflows/english-practice-ci.yml:39,72 |
| CR14 | P1 | smoke 步骤未定义 BUILD_SHA env，只修 CR13 仍红（CI 实测） | 同上:79-80 + scripts/smoke-release.mjs:28 |
| CR15 | P2 | 根 CI `npm audit --audit-level=high` 失败（既有，与本次改动无关） | 根 package-lock（上游议题） |
| CR16 | P2 | fork 未启用 GitHub Pages，Deploy 恒红 | 仓库环境配置 |
| CR17 | P2 | 未到期已曝光题以「新内容」反复入计划，做对被判 needs-help 打回 stage 0 | src/domain/planner.ts:82 + src/services/learning.ts:146 |
| CR18 | P2 | 学习日时区口径分裂；「04:00 划分」文案无实现 | src/services/learning.ts:85 + ProgressPage.vue:123 + SettingsPage.vue:47 |
| CR19 | P2 | 写作版本按 UTC 日期混入学习日统计 | src/domain/progress.ts:130 + src/services/writing.ts:148 |
| CR20 | P2 | onboarding 跳过不落标记、保存默认覆盖写、文案与链接错位 | src/features/onboarding/OnboardingPage.vue:43-61 + TodayPage.vue |
| CR21 | P2 | 备份危险键检查可被深度绕过；canonicalize 触发 `__proto__` setter | src/data/backup.ts:53-78 |
| CR22 | P2 | LearnPage「开始练习」无防重复提交，双击建双会话 | src/features/learn/LearnPage.vue:132-154 |
| CR23 | P2 | 听力音频加载无竞态保护，可能按错误材料作答 | src/features/practice/SessionPage.vue:247-275 |
| CR24 | P2 | 加载中当空态：首屏快速点击误报「暂无课程」 | src/features/today/TodayPage.vue:24 + learn/LearnPage.vue:35 |
| CR25 | P2 | 写作/成长/复习/今日卡大面积零 CSS | src/styles.css（全文对照） |
| CR26 | P2 | 成长页常显无关的「已保存」 | src/features/progress/ProgressPage.vue:210 + FeedbackPanel.vue:106 |
| CR27 | P2 | 设置页保存失败完全静默且残留旧提示 | src/features/settings/SettingsPage.vue:139-151 + src/services/settings.ts:49-51 |
| CR28 | P2 | 设置页新增字段触控目标约 30px（<44px） | SettingsPage.vue:12-22 + styles.css:815 |
| CR29 | P3 | CR5 遗漏：CI 单 job 内 typecheck×3、content:check×3、content:build×2 | workflow:34-41 + package.json |
| CR30 | P3 | fixtures 双写；「最新版本」三处口径不一（字符串排序/未定义 readdir 序/semver） | scripts/build-packs.ts:145 + scripts/sync-e2e-fixtures.mjs:27 |
| CR31 | P3 | content:release 的 continue-on-error 吞噬一切失败，非只审核缺口 | workflow:75-77 |
| CR32 | P3 | push 无分支过滤、workflow 无 concurrency | workflow:7-15 |
| CR33 | P3 | Playwright 浏览器双 job 各自全量安装、无缓存 | workflow:32-33,67-68 |
| CR34 | P3 | check-content.ts/build-packs.ts 不在任何 typecheck 范围 | tsconfig.json:23 + tsconfig.node.json:17 |
| CR35 | P3 | 根文档对 app 零集成说明；无 workspaces 声明 | README/CONTRIBUTING/MAINTENANCE/根 package.json |
| CR36 | P3 | Playwright 配置无 CI retries/forbidOnly（低于根仓库自身标准） | playwright.config.ts + playwright.offline.config.ts |
| CR37 | P3 | 证据按钮 v-for key 可撞；同段多证据只高亮第一条 | FeedbackPanel.vue:150 + PassagePanel.vue:12 |
| CR38 | P3 | ReviewPage 到期判定未传设置时区（CR18 的 UI 侧单列） | src/features/review/ReviewPage.vue:34 |
| CR39 | P3 | 读取失败并入空态文案 / 错误与空态同屏 | ReviewPage.vue:51 + DownloadsPage.vue:59 + LearnPage.vue:71 |
| CR40 | P3 | 「暂停/返回」缺 transitioning 闸，换题在途点击闪 STALE 误报 | SessionPage.vue:898-909 |
| CR41 | P3 | 三处伪 alertdialog 无焦点管理/Esc/aria-modal | SessionPage.vue:838,915 + GapTask.vue:204 |
| CR42 | P3 | 「继续上次练习」多条按钮同文案无法区分 | TodayPage.vue:252-268 |
| CR43 | P3 | 下载全程无进度指示、不可取消 | DownloadsPage.vue:76-84 |
| CR44 | P3 | 退出确认文案对 choice/order 用户失实（草稿只覆盖 gaps；与 CR6 互补） | SessionPage.vue:921 |
| CR45 | P3 | 今日计划组 v-for key 跨包可撞 | TodayPage.vue:209 |
| CR46 | P3 | 同 packId 多版本并存：今日计划重复内容组、跨版本重复计独立首答 | src/services/learning.ts:146 + src/services/content.ts:105 |
| CR47 | P3 | pack-reader 缓存对「事务内写后读再回滚」的注释保证与实际相反（当前无触发路径） | src/data/pack-reader.ts:32-48 |
| CR48 | P3 | （CR2 遗漏）getSessionSummary「外会话曝光」判定不分 profile | src/services/sessionFlow.ts:75-95 |
| CR49 | P3 | （CR2 遗漏）unit:first 成就主键不含 profileId，跨 profile 互相覆盖 | src/services/learning.ts:597 + migrations.ts:27 |
| CR50 | P3 | （CR2 注记未声明）跨 profile 曝光永不记录 → 同题反复计独立首答 | src/services/learning.ts:416-428 + migrations.ts:65 |
| CR51 | P3 | （CR3 遗漏）attempts/exposures/reviewStates 仍全表 toArray，v2 索引未用 | src/services/learning.ts:170,273 |
| CR52 | P3 | downloads reconcile 的 asset-missing 回退丢弃 job 中保留的资产字节 | src/services/downloads.ts:146-158 |
| CR53 | P4 | 服务层状态机守卫缺口（completeSession 槽位终结/revealHint 对已提交槽/skip 后可提交/finalizeWriting 重复冻结） | src/services/learning.ts:469,668,694 + writing.ts:135 |
| CR54 | P4 | e2e 时钟桥注释宣称全覆盖，writing/drafts/sessionFlow 直接 new Date() | src/data/e2e-clock.ts:2 + writing.ts:111,148 + drafts.ts:21 + sessionFlow.ts:19 |
| CR55 | P4 | restoreBackup 旧备份逐行 update，最坏 10 万次事务内写 | src/data/backup.ts:274-283 |
| CR56 | P4 | 服务层杂项（a–e，见 §D.8） | 多处 |
| CR57 | P4 | UI 杂项（a–j，见 §D.8） | 多处 |
| CR58 | P4 | smoke 失败路径不关闭 Chromium | scripts/smoke-release.mjs:77-93 |
| CR59 | P4 | SW 自定义 navigate 分支与 workbox precache 双 respondWith 竞态（hash 路由下近乎不可达） | src/pwa/sw.ts:12,57-71 |
| CR60 | P4 | `.content-stage-<pid>` 残留无跨 pid 清理且不在 .gitignore | scripts/build-packs.ts:99 + 根 .gitignore |
| CR61 | P4 | offline 用例的「precache 仅 shell」断言实际跑在 E2E 构建 dist 上 | tests/e2e/offline.spec.ts:5-9 |
| CR62 | P4 | 双 playwright 配置共用 playwright-report/，后者覆盖前者 | playwright(.offline).config.ts + workflow:47-49 |
| CR63 | P4 | 根 deploy.yml 对 master push 无路径过滤，app-only 改动触发全书构建部署 | .github/workflows/deploy.yml:4-5 |
| CR64 | P4 | prunable worktree 与已合并分支未清理；dist 随不可变版本只增不减 | git 状态 + public/content-packs |
| CR65 | P4 | POSIX 专属语法与裸二进制路径，Windows 本地不可跑（engines 未声明平台） | package.json:21 + smoke-release.mjs:50 |

P1=CI 阻断/ provenance 污染；P2=真实缺陷或用户可即刻感知；P3=口径一致性/体验/工程效率；P4=低风险杂项。

## D. 详细发现

### D.1 紧急：CI 红灯实测（CR13–CR16）

推送 fork（`ceed862`）后三条工作流全红（run 34818539176/79/87，2026-09-14）：

- **CR13**：workflow 第 39/72 行为 `BUILD_SHA: \${{ github.sha }}`——反斜杠是文件真实字节（`sed -n 'l'` 核实）。CI 日志确认 env 值为 `\ceed862…`；该值经 vite.config.ts:9 进 `__BUILD_SHA__`，写入 dist/release-info.json 并显示于设置页，`shortenSha` 截出的 8 位同样含 `\`。smoke-release.mjs:29 的比对被本次错误触发，证明校验链有效。修法：改为 `BUILD_SHA: "${{ github.sha }}"`；并给 smoke-release.mjs 加「40 位十六进制或 unversioned」格式断言防再犯。
- **CR14**：`BUILD_SHA` 只定义在两个 build 步骤；「Release smoke」步骤（:79-80）未定义 → `process.env.BUILD_SHA ?? 'unversioned'` 恒为 unversioned，与 release-info 中的真实值必然不等。本地当时全绿是 build/smoke 两侧均 unversioned 的巧合。**只修 CR13 不修本条，smoke 仍红**。修法：smoke 步骤补 `env: BUILD_SHA: ${{ github.sha }}`。
- **CR15**：根 CI validate job 失败于 `npm audit --audit-level=high`（13s，根 package-lock）。根 lockfile 本轮未触碰，属上游既有审计项。独立议题：升级根依赖或调整审计门禁，随 T16 部署规划处理，不阻塞 app CI。
- **CR16**：Deploy Pages 失败于 `configure-pages`（Pages site Not Found）——fork 未启用 GitHub Pages，环境配置问题。修法：fork 设置启用 Pages（或 configure-pages 加 `enablement: true`），或在 fork 上禁用该 workflow。

### D.2 学习调度与时区口径（CR17–CR19）

- **CR17**：`collectTodayPlanBundle` 把已曝光但未到期的组归入 new（planner.ts:82-86 中 `seen` 仅作 familiarRetry 标志，new 组不排除）；用户做对后 `submitAnswer`（learning.ts:558-560）因 `firstSeenSessionId !== session.id` 判 needs-help → scheduler.ts:15 重置 stage 0、lapses+1。时序推演：Day1 通过（dueDay=Day2）→ Day2 复习通过（stage 1，dueDay=Day5）→ Day3/Day4 被当新内容重排 → 答对反而打回起点。连续多日使用高频触发。与 verification-log:508/513 已记录的 S3（newCount 失真）/S6（重置语义）是不同侧面——此前未记录「计划器主动排入」这一根因。修法：new 候选剔除「组内全部条目已曝光且未到期」；补「Day3 不再见到 Day1 做过的未到期题」规则用例。
- **CR18**：写入侧 `studyDayFor(date)` 不传时区（learning.ts:85-86，固定 Asia/Shanghai）；ProgressPage.vue:123 用 `settings.timeZone` 读。用户切 UTC 后北京 00:00–07:59 做题，成长页「今日已标记」永不成立。另 SettingsPage.vue:47 宣称「从本地 04:00 划分」——全 src/ 无任何 hour 边界逻辑，文案虚构。修法：写入/读取统一口径（接线 timeZone 或砍掉选项），文案与实现对齐。
- **CR19**：progress.ts:130 的 daySources 对写作版本用 `createdAt.slice(0,10)`（UTC ISO 串），客观题用 studyDay（北京日）。北京 08:00 前冻结写作记前一日，当日仅写作时 `todayMarked` 误 false。修法：写入版本时落 studyDay 字段（studyDayFor 生成），统计侧直用；与 CR54 一并处理。

### D.3 本轮修复引入/遗漏（CR20、CR28）

- **CR20**（onboarding 链路三缺口，已人工复核源码）：a) `skip()` 仅 `router.push('/today')`（OnboardingPage.vue:59-61），不写任何记录，而 TodayPage 判定 `needsSetup = settings.get('personal') === undefined` → 跳过后引导卡立刻重现，与文案「也可以先跳过」矛盾；b) `save()` 用 `{...DEFAULT_PERSONAL_SETTINGS, grade, goal, defaultMinutes}` 落库（:43-49），用户此前在设置页改过的 sound/timeZone/animation 被静默重置（SettingsPage 是「读-合并-写」，此页是「默认-覆盖-写」，两入口协议不一致）；c) 引导卡文案说「随时在设置中完成」，链接却指向 `/onboarding` 且叫「前往学习设置」。修法：skip 落默认 personal（或独立 marker）；save 改读-合并-写；文案与去向统一。
- **CR28**：`.settings-row select`（padding 4px 8px）与 goal 输入框无 min-height，约 30px；音效 checkbox 约 13px——均低于 44px 触控标准，且与 onboarding 同字段（`min-height:44px`，styles.css:153-161）不一致。属 CR12.6 修复引入字段的遗漏。修法：补 `min-height:44px; font-size:1rem`，checkbox 放大 label 点击区。

### D.4 其他 P2（CR21–CR27）

- **CR21**：`hasDangerousKeys` 的 `maxDepth` 缺省 32，更深嵌套中的 own `__proto__` 漏检；`canonicalize` 用 `sorted[key] = …` 普通赋值，key 为 `__proto__` 时触发原型 setter（键丢失 + 局部原型改写）；且恢复侧 bulkAdd 用原始 payload 而非 canonicalize 产物。backup.ts:64-65 注释自声明此攻击面。修法：`Object.defineProperty` 写入 + 去深度上限（显式栈迭代）。
- **CR22**：`startPractice` 无 in-flight 闸（同页 preparing/downloadingAudio 有、TodayPage starting 有）；`createSession` 无同日复用机制，`await` 期间再点即再建会话，孤儿会话挤占「继续上次练习」（上限 3）。修法：加 `starting` ref + `:disabled`；中期服务层复用同单元同日未完成会话。
- **CR23**：`loadAudio` 在 `await getPackAssetBytes` 前后无请求序号/代数保护；听力题 A 在途时切到 B，A 后完成会覆盖 audioBytes/audioMime——B 的题目播 A 的音频，按错误材料作答污染底账。修法：请求序号，过期结果丢弃。
- **CR24**：TodayPage `hasContent` 初始 false、无 loading 分支，packs 读取完成前点「开始今日练习」误报「暂无可用课程」；LearnPage `loading` ref 已定义但模板未引用，`v-else` 空态在加载期渲染「准备课程内容」按钮，加载失败也并入同一空态文案。修法：两页补 loading 态（禁用主按钮），错误与空态分开。
- **CR25**：styles.css（837 行）逐类对照，以下类零定义：writing-page/writing-brief/writing-outline/**writing-body**/writing-count/writing-checklist/writing-actions/writing-save-state/writing-version；progress-page/progress-summary/progress-map/progress-series/progress-cards/writing-card/animation-toggle/sound-toggle；review-page/review-list/review-row/review-family；today-setup-card/today-plan-card/today-plan-summary/today-plan-groups/levelup-card/today-actions；onboarding-error；audio-missing（在用，仅 .audio-missing-panel 有定义）。`.writing-unsupported` 已无引用（死样式）。最痛：`<textarea class="writing-body" rows="8">` 无宽度规则，375px 手机上主作答区只占半屏。修法：按上述清单补最小样式；顺带删死样式。
- **CR26**：ProgressPage:210-215 为借用奖励动效传 `:status="'saved'" :message="null"`，FeedbackPanel saved 分支渲染 `message ?? '已保存'` → 成长页顶部永远一行「已保存」。修法：拆独立奖励动效组件，或 FeedbackPanel 在 attempt/item 均空且 message 为 null 时跳过状态行。
- **CR27**：`savePrefs` 无 try/catch，`savePersonalSettings` 内部也无（对比 loadPersonalSettings 有 catch；OnboardingPage.save 有）——IndexedDB put 失败时 unhandled rejection、无界面反馈，且 message 停留上一次「偏好已保存」。修法：包 try/catch 设「保存失败，请重试」；或下沉为 Result。

### D.5 P3 构建/CI（CR29–CR36）

- **CR29**：quality job 内 `npm run check`（含 content:check+typecheck）→ `build:release`（再跑 typecheck+content:check+content:build）→ `test:e2e`（build:e2e 再跑 typecheck+content:check+content:build）。CR5 只消掉了重复 vite 构建，前置门禁仍三连跑。修法：build:e2e 加 `SKIP_GATE=1` 分支，CI 侧 `SKIP_GATE=1 npm run test:e2e`；本地默认行为不变。
- **CR30**：build-packs 尾部已写 fixtures（`versions.sort().at(-1)` 字符串排序，`1.0.10 < 1.0.2`）；sync-e2e-fixtures 再写同一目录，结果依赖未定义的 readdirSync 顺序；应用侧 compareSemver 是真 semver。当前 fixtures 恰为最新版是 mac 序与 CI 序巧合一致的结果，一旦翻转 → fixtures 提供旧字节、sha256 校验失败 → 按平台 flaky。修法：收敛为单一来源，版本选择统一数值比较。
- **CR31**：workflow:75-77 的 `continue-on-error: true` 作用于整步，check-content.ts 自身崩溃/素材 sha256 不匹配/P07 门禁新增失败同样被吞。修法：check-content 输出机器可读失败分类（如 exit 78 = 审核缺口专属）后收窄容忍范围；T16 部署前移除容忍时一并处理。
- **CR32**：`on: push` 无 branches 过滤（任意分支/tag 触碰 app 路径即跑三引擎 E2E 双 job）；同分支 push + pull_request 双事件各跑一遍；无 concurrency（连跑 commit 全排队）。修法：`push: branches: [master]` + `concurrency: { group: english-practice-${{ github.ref }}, cancel-in-progress: true }`（deploy.yml:13-15 有先例）。
- **CR33**：quality 装 chromium+firefox+webkit、release-smoke 再装 chromium，均无缓存（app 用 @playwright/test 1.63.0，与根 1.62.1 二进制不共享）。修法：actions/cache（`~/.cache/ms-playwright`，key 含版本与 runner OS），或 quality 用 playwright 官方容器镜像。
- **CR34**：tsconfig include 仅 src+tests，tsconfig.node.json 仅 vite.config+eslint.config——发布链核心 check-content.ts/build-packs.ts 只经 tsx 运行无类型检查（release-gates/pilot-day7 因被单测 import 而被传递覆盖）。修法：tsconfig.node.json include 加 `scripts/**/*.ts`。
- **CR35**：根 README/CONTRIBUTING/MAINTENANCE/CHANGELOG 对 english-practice 零命中（已 grep 核实）；根 package.json 无 workspaces（app 独立 lock/eslint/playwright 版本）。修法：README 加「项目结构」小节；MAINTENANCE 加子项目条目（依赖独立、CI 路径、BUILD_SHA 约定）；CONTRIBUTING 划清两套 lint/测试边界。
- **CR36**：app 两个 playwright 配置均无 `forbidOnly`/`retries`/全局 timeout（根配置有 `forbidOnly: CI`、`retries: CI?2:0`）。真实 HTTP 音频下载 + IndexedDB + 三引擎下偶发失败直接红整个 job。修法：补 `forbidOnly: Boolean(process.env.CI)`、`retries: CI ? 1 : 0`。

### D.6 P3 UI（CR37–CR45）

- **CR37**：证据按钮 `:key="evidence.paragraphId"`——同段多条证据时撞 key（校验器不限制每段一条，阅读/完形多空同段合法）；PassagePanel `highlightFor` 用 find 只高亮该段第一条。修法：key 加 quote；PassagePanel 改 filter 支持段内多高亮。
- **CR38**：ReviewPage.vue:34 `studyDayFor(e2eNow())` 未传 settings.timeZone，与 ProgressPage 口径不一致（CR18 根因的 UI 侧）。
- **CR39**：ReviewPage catch 后 rows=[] 显示「暂无到期复习」而非「读取失败」；DownloadsPage refresh 失败时错误 message 与「还没有已安装的课程」空态同屏互斥；LearnPage 同理。修法：独立错误态（role=alert + 重试），空态仅在非错误时显示。
- **CR40**：session-secondary 的「暂停」「返回」未绑 `:disabled="transitioning"`（其余操作键都有）——换题在途时点暂停，pauseSession 携带旧 revision → STALE_SESSION 误报。修法：补 disabled。
- **CR41**：gap 空位确认、退出确认、选项移动确认三处 div[role=alertdialog] 打开时焦点不移入、Tab 可逃逸、Esc 不关闭。最低成本：focus 第一个按钮 + `@keydown.esc`；完整做法原生 `<dialog>` 或焦点陷阱。
- **CR42**：「继续上次练习」最多 3 条按钮全部同文案，无日期/进度信息。修法：附 `updatedAt 本地日期 + 第 N/M 题`。
- **CR43**：下载仅有 downloading/verifying 两个文字态，无百分比/字节数/取消。修法：startPackDownload 暴露 onProgress（fetch 流式 + Content-Length）。
- **CR44**：退出确认承诺「已输入内容会自动保存为草稿」，但草稿 watch 限定 `kind === 'gaps'`（SessionPage.vue:176）——choice/order 用户确认离开后已选项直接丢失。短期改文案，长期随 CR6 落地。
- **CR45**：TodayPage 计划组 `:key="group.unitId + group.kind"`，两个包各有同名 unitId（如 unit-1）且同 kind 时撞 key。修法：对齐 LearnPage 的全键 `packId@version:unitId` 形式。

### D.7 P3 服务/数据（CR46–CR52）

- **CR46**：`installPreviewPacks` 装新版不撤旧行（受支持的多版本并存）；`collectTodayPlanBundle` 对 allPackRecords 不按 packId 取最新 → 同单元两版本各生成一组候选；exposures 主键含版本，v1 曝光不命中 v2 查询 → submitAnswer 判 independent=true，同题在新版本重新计独立首答（升层证据可灌水）。旧会话按精确版本取包不受影响。修法：计划侧按 packId 取最高 version（或输入侧按 itemId 去重）。
- **CR47**：pack-reader 钩子在写事务内同步清缓存；同一事务内再经缓存读会把未提交视图缓存为 loaded=true，Dexie 回滚不触发钩子——注释「回滚只导致多一次重读」与实际相反。当前全部路径已核实无触发（事务内读 packs 均直连），但 submitAnswer 事务表清单已含 db.packs，未来加事务内 packs 写即成真缺陷。修法：allPackRecords 检测 `Dexie.currentTransaction` 存在时绕过缓存；修正注释。
- **CR48**：getSessionSummary 的 foreignSessionByRef 收集所有 `firstSeenSessionId !== sessionId` 的曝光，未过滤 profileId——跨 profile 曝光把本会话首答判 assistedFirst，与 submitAnswer 的跨 profile 放行（independent）互相矛盾。当前单 profile 无实际影响。修法：过滤条件加 profileId 相等。
- **CR49**：成就 put-if-absent 主键 `unit:first:${unitId}` 不含 profileId，AchievementRecord 虽有 profileId 字段但主键/索引均不含；进度页 unlocked 全 profile 共用，与证据/计划侧 per-profile 口径分裂。修法：键加 profileId 或复合主键，需小迁移。
- **CR50**：exposures 主键不含 profileId，profile B 做其他 profile 已曝光的题时 existing 命中、跳过写入 → B 的曝光永不记录 → 计划侧视之为新内容 + submitAnswer 跨 profile 放行 → 同题反复计 independent-pass。短期修：独立判定处补 attempts 查询（已有 profileId 索引）；长期随 per-profile 曝光表重建解决。
- **CR51**：collectTodayPlanBundle（reviewStates/exposures）与 collectLevelUpEvidence（attempts/exposures）仍全表 toArray 后内存 filter；attempts/exposures 的 profileId 索引（v2 新建）与 reviewStates 复合主键前缀均未使用。T14 CR3 原建议明确含此项，修复只做了 packs 缓存与 getSessionSummary 部分。attempts 上限 5 万条时每次今日页预览拉数 MB。修法：改 `where('profileId').equals()`；getSessionSummary 的 exposures 全表可改按 slot refs 逐条 get。
- **CR52**：reconcile 的 markedNeedsDownload 分支写 `data: { reason: 'asset-missing' }` 直接覆盖 job.data，丢弃同函数僵尸重置分支与 content.ts:202-219 各失败路径特意保留的旧字节——违背本函数自声明的 B1「旧版本继续可用」原则（触发边缘：resourcesReady=true 且字节缺失）。修法：合并保留 job.data.assets。

### D.8 P4（CR53–CR65）

- **CR53** 服务层守卫缺口（一组）：completeSession 不校验槽位终结（active 会话带 unseen 槽位可被置 completed 并清草稿；当前 UI 接线正确，纯服务层缺口）；revealHint/recordReplay/setAudioSpeed 对已 submitted 槽位仍可变更（追加提示会记进订正 attempt）；skipSlot 后的槽位仍可提交首次答案；finalizeWriting 可对已 submitted 写作题重复冻结追加版本（与客观题 ALREADY_SUBMITTED 语义不对称）。修法：各补 slot.state 守卫。
- **CR54**：e2e-clock.ts 注释宣称「学习/日界逻辑全部经 LearningClock」，实际 writing.ts:111,148,154、drafts.ts:21、sessionFlow.ts:19 直接 `new Date()`——生产无影响，E2E 跨日推进时写作时间不偏移（与 CR19 叠加）。修法：统一 e2eNow() 或修正注释声明覆盖范围。
- **CR55**：restoreBackup 回填逐行 `update(...)`（最坏 5+5 万次），同库 v2 迁移用 `toCollection().modify` 一次完成。修法：收集后 bulkPut。
- **CR56** 服务层杂项：a) gradeOrder 不校验 token 重复（answers.ts:41，只导致判错不误判对）；b) settings 表 today-session marker 按日累积永不清理（learning.ts:216,260，年积 365 行）；c) getPackAssetBytes 死代码（content.ts:297-300，288 行已判空后恒真）；d) 写作队列 Map 键随题数线性增长不释放（writing.ts:39-48）；e) saveDraft 无乐观锁，两标签页同编辑 last-writer-wins（drafts.ts:17-26，与 saveWritingDraft 的 CAS 不对称；与 CR6 修复可一并对齐）。
- **CR57** UI 杂项：a) ChoiceTask 对原生 button 再挂 enter/space keydown 致同一点击双触发（:37-39，当前幂等无害）；b) App.vue setupPwa 在 updateReady 声明前调用（:9-14，回调异步故无 TDZ，顺序脆弱）；c) 页面主标题层级不一致（Settings/Backup 用 h1，其余 h2；WritingPage 内部跳级 h4）；d) summary 读取失败回退最后一题视图形成「下一题」循环（SessionPage.vue:218-232，低频）；e) viewport-fit=cover 但 sw-update-banner 无 safe-area-inset-bottom；index.html `color-scheme: light dark` 与 styles.css 强制 light 矛盾；f) 无 role 的 div 加 aria-label（SessionPage:748、GapTask:173，建议 role=group）；g) firstAttemptLabel 显示全会话最早 attempt，恢复会话用户无从对应（本为 E2E 断言而设）；h) OrderTask 无「清空重排」；i) BackupPage「已导出 N 字节」建议 formatBytes 化；j) FeedbackPanel gapResults() 在 v-if 与 v-for 各调一次（提 computed）。
- **CR58**：smoke-release.mjs 的 browser.close() 只在成功路径（:89），waitForServer 超时/断言失败走 catch → exit(1)，Chromium 孤儿残留。修法：finally 收口。
- **CR59**：应用为 hash 路由，导航请求恒为 `/`；workbox precacheAndRoute 先命中并 respondWith，自定义 navigate 分支（sw.ts:57-71）二次 respondWith 抛 InvalidStateError（仅控制台噪音，功能无碍）。修法：删除该分支或改用 NavigationRoute 统一注册。
- **CR60**：build-packs 启动只清自己 pid 的 staging；SIGKILL 后 `public/.content-stage-<旧pid>` 残留被 copyPublicDir 拷进 dist 且出现在 git status。修法：启动时 glob 清全部残留（保持同设备 rename 语义，勿移 os.tmpdir）；.gitignore 补模式。
- **CR61**：offline.spec 的 precache 断言读 dist/sw.js，但 test:e2e 串联时 dist 已被 VITE_E2E 构建覆盖——「precache 仅 shell」防线从未对发布产物执行（当前 globPatterns 与 VITE_E2E 无关，风险低）。修法：三条断言迁入 smoke-release.mjs。
- **CR62**：双 playwright 配置 html reporter 均默认 playwright-report/，test:e2e 串行后 artifact 只剩离线轮报告（trace 因 outputDir 分离仍完整）。修法：offline 配置 reporter outputFolder 分离。
- **CR63**：根 deploy.yml 对 master push 无 paths 过滤，app-only push 触发全书构建 + Pages 部署（幂等但每次数分钟，且 cancel-in-progress 会取消在途部署）。修法：加 `paths-ignore: ['apps/**', 'planning/**']`（或 T16 统一规划部署边界）。
- **CR64**：`git worktree list` 显示 `/private/tmp/gaokao-english-glm-worktree` 已 prunable、分支 `codex/gaokao-english-glm` 仍挂着——`git worktree prune` + 删分支即可；另 public/content-packs 入库含全部历史版本，发布 dist 体积随版本只增不减，体积策略留 T16 部署设计时定。
- **CR65**：`VITE_E2E=true npm run build:vite` 为 POSIX env 前缀语法；smoke 的 `node_modules/.bin/vite` 无 .cmd 扩展、spawn 无 shell——Windows 本地不可跑（CI/当前环境不受影响）。修法：改 `vite build --mode e2e` 或 cross-env + `npm exec`，或 README 声明仅支持 POSIX。

## E. 已确认无问题的方面（本轮复核）

- **Result 错误协议**全链一致（7 个服务 + 备份 + pilot），中文用户消息齐全；事务纪律逐表核对齐全（createTodaySession/submitAnswer/completeSession 的表清单覆盖全部写点）。
- **CR1/CR4 修复本体**正确：completed 幂等不推 revision；事务内二次 reusable() 检查处理并发双进入。
- **E2E 桥摇树链**完整：动态 import 位于常假分支后可 DCE，冒烟三重 marker + `__GAOKAO_E2E__` undefined 检查钉死发布构建（且 CR14 实测证明冒烟门禁真实生效）。
- **PWA 更新流程**自洽：prompt 注册 → 横幅 → 活动会话守卫（sessionStorage）→ SKIP_WAITING → clients.claim()。
- **备份管线**：导出只读事务快照防撕裂；恢复单事务 clear+bulkAdd 原子回滚；体积/作答数先检后解析；未知顶层键拒绝。
- **下载状态机**：downloading→verifying→ready/failed、bytes/sha256/MIME 三重校验、失败路径旧字节保留（CR52 所指为 reconcile 一个分支的例外）。
- **判分器与内容校验**完备（跨引用、组句每词块恰一次、听力必须音频+transcript、release 门禁作者≠审核人）。
- **UI 安全与卫生**：全项目无 v-html；objectURL 双路径 revoke；防抖 timer 均有清理；prefers-reduced-motion 双重尊重；抽查对比度组合均 ≥4.5:1；中文文案无错别字。
- **CI 基础正确性**（除已列项）：paths 过滤含 workflow 自身、pull_request 无 secrets、artifact 路径正确、node 24 与 engines 一致、根/测试配置端口与目录互不误扫、全部 E2E spec 无硬等待。

## F. 建议处理顺序

1. **立即（推送即修）**：CR13 + CR14（同一文件两处 + smoke 格式断言），推送后观察 english-practice-ci 整条转绿；CR16（fork 启用 Pages 或禁用 workflow）；CR15/CR63/CR64 属上游/仓库卫生，可单独小批处理。
2. **第二批（用户可即刻感知）**：CR17（调度口径）、CR20（onboarding 链路）、CR25（CSS 缺失）、CR27（保存静默失败）、CR24（加载态）。
3. **第三批（口径与安全）**：CR18+CR19+CR38+CR54（时区/写作日期/时钟桥一并统一）、CR21（备份加固）、CR22+CR23+CR26+CR28。
4. **工程攒批**：CR29–CR36（CI 效率与稳健性）、CR46–CR52（服务口径收尾，CR48–CR50 可合并为一次 per-profile 补全）、CR53–CR65 按池消化。
5. 已知待办 CR6–CR12 不变，CR44 与 CR6、CR56.e 与 CR6 关联，修复时对齐。

## G. 记录更正与可信度说明（不伪造）

- 评审过程中一条中间结论「app 合入 commit 未推送、CI 从未生效」为**过时**判断（评审与推送并发进行）——实际推送已完成且 CI 已实测三条。本文件按实测结果记录。
- 另一条推断「smoke 与 env 自洽、校验链发现不了 BUILD_SHA 污染」与实测**相反**：smoke 正确拦截了 CR14（配置缺陷）与 CR13 的脏值。校验链有效，本文件以 CI 日志为准。
- 三路并行评审的全部 P1/P2 发现与关键 P3 已由主会话二次核实（源码/CI 日志/git 状态）；P4 杂项组维持各路核实结论未二次复核，引用时以实际代码为准。
