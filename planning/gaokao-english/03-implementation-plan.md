# 高考英语触屏学习应用 Implementation Plan

> **For agentic workers:** 使用 superpowers:executing-plans 或 superpowers:subagent-driven-development，按任务依赖实施并逐项验证。下面所有任务尚未实施，不得因为计划存在就标记完成。

**Goal:** 将产品规格 P01-P09 和数据契约 D01-D11 实现为可在手机、平板上真实使用的个人高考英语补弱应用。

**Architecture:** 独立 Vue PWA；版本化内容包、纯领域规则、本地应用服务、IndexedDB 持久化；试题、音频、写作、备份共享同一内容版本契约。

**Tech Stack:** Node.js 24、Vue 3、TypeScript、Vite、Dexie、Zod、Vitest、Playwright。T01 负责精确锁定依赖。

## 执行约定

- 所有代码路径相对于 `apps/english-practice/`，该目录目前尚未创建；仓库级变更单独标识。
- 先完成依赖任务。可并行：T06/T07/T08/T09 的组件在 T04 完成后分文件开发，T15 内容可从 T02 后并行；T10 依赖所有题型契约，T14 依赖完整应用。
- 每项任务步骤均为：建立下列测试 -> 运行并确认失败原因 -> 实现明确行为 -> 运行同一测试 -> 检查变更范围 -> 记录结果。测试失败若来自环境，先处理环境，不把它算成有效红灯。
- 不先提交空组件、不批量改原书稿、不使用未审核题库冒充正式内容。用户只要求计划，本次不建分支、不提交代码、不部署。
- 若后续用户要求版本管理，建议每个任务一个可独立审查的提交；提交只包含该任务文件，不运行 `git add .`。
- 首版没有网络后端。表中 API 为本地 TypeScript 服务，课程静态下载是唯一必需网络读取。

## T01 独立工程与触屏入口

依赖：无。预计1-2日。覆盖 D01、P05。

文件：`package.json`、`index.html`、`tsconfig.json`、`tsconfig.node.json`、`vite.config.ts`、`eslint.config.js`、`src/main.ts`、`src/app/App.vue`、`src/app/router.ts`、`src/styles.css`、`src/features/today/TodayPage.vue`、`tests/unit/app.spec.ts`。仓库级 `.gitignore` 新增精确应用 dist、测试输出和本地证书路径。

- [ ] 查 `node --version`，切换到24后再建目录。只在应用目录安装包，不改原站点依赖。
- [ ] 建立下面的脚本骨架与真实 Vue 入口，采用 `createWebHashHistory()`；首页有“开始今日练习”按钮，尚无课包时进入明确空态。
- [ ] 安装依赖并记录 registry 返回版本、engines 与 peer dependencies，所有依赖以 `--save-exact` 写入，提交 lockfile 后后续只用 npm ci。
- [ ] 写 Vue Test Utils 测试：按钮可访问名称正确，点击进入无课程提示，不产生未处理异常。
- [ ] 验证 typecheck、lint、test:unit、build。断点360/768/1024下检查导航，不先做装饰性复杂动画。

`package.json` 的基础内容：

```json
{
  "name": "gaokao-english-practice",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "dev": "vite --host 0.0.0.0 --port 5174 --strictPort",
    "typecheck": "vue-tsc --noEmit",
    "lint": "eslint src scripts tests",
    "test:unit": "vitest run",
    "test:e2e": "playwright test",
    "content:check": "tsx scripts/check-content.ts --mode preview",
    "content:release": "tsx scripts/check-content.ts --mode release",
    "content:build": "tsx scripts/build-packs.ts",
    "build": "npm run typecheck && npm run content:check && npm run content:build && vite build",
    "preview": "vite preview --host 127.0.0.1 --port 4174 --strictPort",
    "check": "npm run content:check && npm run typecheck && npm run lint && npm run test:unit"
  }
}
```

content 脚本在 T02 完成；T01 的工程 build 验证先直接使用 `npx vite build`，不得创建永远返回成功的假 content 脚本。scripts/tests 目录至少放实际配置或测试再运行 lint。

安装命令（实施时执行，不在计划阶段安装）：

```bash
npm install --save-exact vue@3 vue-router@4 dexie@4 zod@4
npm install --save-dev --save-exact vite @vitejs/plugin-vue typescript vue-tsc vitest @vue/test-utils jsdom fake-indexeddb @playwright/test vite-plugin-pwa workbox-precaching eslint @eslint/js eslint-plugin-vue typescript-eslint tsx @types/node
```

如最新包要求不同 Node，按兼容性选择受支持版本后重新生成锁定，不能盲目忽略 peer/engine 报错。建立配置时严格模式开启；ESLint 使用 Vue+TypeScript flat config；Vitest 环境jsdom，fake-indexeddb由需数据库的测试引入。

完成证据：`npm run typecheck`、`npm run lint`、`npm run test:unit`、`npx vite build`均exit0，应用lockfile存在。

## T02 内容协议、默认配置与打包

依赖：T01。预计1-2日。覆盖 P01/P07/P08、D02/D03。

文件：`src/content/types.ts`、`src/content/schema.ts`、`src/content/validate.ts`、`src/content/repository.ts`、`content/profiles/gaokao-common-training-v1.json`、`content/pack-manifests/gaokao-protocol-demo.json`、D08a定义的作者文件、`scripts/check-content.ts`、`scripts/build-packs.ts`、`tests/fixtures/sample-pack.json`、`tests/unit/content.spec.ts`。

- [ ] 将计划中的JSON样例复制到测试fixtures，默认配置写入content/profiles；按D08a拆为作者文件再组装，比较与样例语义一致。样例只标draft，不假装发布课程。
- [ ] 复制 D02 类型，编写对应严格Zod schema及D03外键/题型检查。
- [ ] `validatePack`返回`{ok:boolean,errors:Array<{path:string,code:string,messageZh:string}>}`，不能只返回模糊字符串。
- [ ] 实现preview与release检查，release聚合所有发布包检查P07数量，draft不能计入。
- [ ] 编写build-packs：内容校验后，按实际字节计算JSON与媒体摘要、生成不可变版本目录与catalog；失败不产生看似成功的新catalog。
- [ ] 测试预览样例通过、重复ID/丢外键/不存在答案/错误evidence/缺音频拒绝，release拒绝未审核样例。

核心用例写入`tests/unit/content.spec.ts`：

```ts
import { expect, it } from 'vitest';
import demo from '../fixtures/sample-pack.json';
import { validatePack } from '../../src/content/validate';

it('accepts a structurally valid preview but rejects release', () => {
  expect(validatePack(demo, 'preview').ok).toBe(true);
  expect(validatePack(demo, 'release').ok).toBe(false);
});
it('rejects an answer option that does not exist', () => {
  const bad = structuredClone(demo);
  Object.assign(bad.items[0], { answerOptionId: 'missing' });
  expect(validatePack(bad, 'preview').ok).toBe(false);
});
```

验证：`npm run test:unit -- tests/unit/content.spec.ts`、`npm run content:check`、`npm run build`。预览成功；`npm run content:release`此阶段应明确失败于审核/数量门禁，记录预期失败而非修掉门禁。

## T03 数据库、会话、曝光与草稿恢复

依赖：T02。预计1-2日。覆盖 D04/D05。

文件：`src/data/db.ts`、`src/data/migrations.ts`、`src/services/learning.ts`、`tests/unit/db.spec.ts`、`tests/unit/session.spec.ts`。

- [ ] 按D05建表，提供`createDatabase(name:string)`供生产与隔离测试使用；每项测试使用唯一数据库，结束删除。
- [ ] 实现createSession/loadSession，会话固定slotId、课程版本、revision、顺序。T03先仅从显式选择的unit按原顺序取预算能容纳的完整材料组；没有unitId时返回可选课程空态，不伪造智能计划。T10接入复习优先与自动规划。
- [ ] 题目即将显示时保存exposure和slot状态；刷新不能换题，也不能清除曝光。
- [ ] 实现pause/resume；未知会话返回NOT_FOUND，缺对应版本返回CONTENT_MISSING。
- [ ] 用fake-indexeddb模拟关闭重连，验证sessions和exposures保留；模拟迁移抛错，确认原库未清空。

验证：`npm run test:unit -- tests/unit/db.spec.ts tests/unit/session.spec.ts`。一次短任务从第一题返回首页再进入，位置与题目不变。

## T04 判题器与幂等提交

依赖：T03。预计1-2日。覆盖 D05/D06。

文件：`src/domain/answers.ts`、`src/domain/calendar.ts`、`src/domain/scheduler.ts`、`src/services/learning.ts`、`tests/unit/answers.spec.ts`、`tests/unit/submit.spec.ts`、`tests/unit/scheduler.spec.ts`。

- [ ] 实现D06 normalizeAnswer/gradeAnswer，按kind窄化类型，text不做模糊纠错。
- [ ] 先实现D07纯日期和scheduleReview函数，并运行T10列出的固定复习用例，再集成提交事务，避免服务引用尚不存在的调度实现。
- [ ] 实现submitAnswer、correctAnswer、revealHint、skipSlot；数据库事务保存首次答案，订正永不覆盖。
- [ ] 提示必须先保存assistance再展示；失败不显示提示以免遗漏辅助记录。
- [ ] 同命令ID重试返回原Attempt；同slot第二次first拒绝；过期revision返回STALE_SESSION。
- [ ] 非法选项ID拒绝；多空空白项计0；全部为空需确认或返回INVALID_ANSWER。
- [ ] 测试两标签页并发、保存中断、错后改对、提示后改对的分母与首次成绩。

`tests/unit/answers.spec.ts`最小规则：

```ts
import { expect, it } from 'vitest';
import { normalizeAnswer } from '../../src/domain/answers';

const policy = { caseSensitive: false, allowTerminalPunctuation: false };
it('normalizes width and whitespace but does not correct grammar', () => {
  expect(normalizeAnswer('  ＭＥＥＴＳ  ', policy)).toBe('meets');
  expect(normalizeAnswer('meet', policy)).not.toBe('meets');
  expect(normalizeAnswer('meets.', policy)).not.toBe('meets');
});
```

事务用例的固定操作序列：建立1个slot的Session revision=0 -> 用ID c1提交正确答案 -> 重放c1 -> 新ID c2再次首次提交 -> 查询attempts。预期c1两次返回相同Attempt、c2被拒绝、库中first只有1条、revision只增加1。再注入写reviewStates失败，确认attempt/session均未新增或推进。

验证：`npm run test:unit -- tests/unit/answers.spec.ts tests/unit/submit.spec.ts`。

## T05 基础触屏练习与导航

依赖：T04。预计1-2日。覆盖 P02/P05。

文件：`src/components/AppButton.vue`、`src/components/FeedbackPanel.vue`、`src/features/onboarding/OnboardingPage.vue`、`src/features/learn/LearnPage.vue`、`src/features/practice/SessionPage.vue`、`src/features/practice/ChoiceTask.vue`、`src/features/practice/OrderTask.vue`、`src/app/router.ts`、`tests/unit/practice-ui.spec.ts`。

- [ ] 建立目标/时长设置，起点练习不足样本显示说明；空课包引导下载。
- [ ] choice点击选择、再次点击切换，不自动提交；order点击添加、点击已选词撤销，支持重排按钮。
- [ ] SessionPage统一管理渲染/提交/跳过/下一题/暂停，组件只emit答案，不写数据库。
- [ ] 显示保存中、已保存、错误，提交中禁用重复点击但保留幂等服务保护。
- [ ] 成绩只在保存成功后显示；返回恢复、退出确认仅在有未保存输入时出现。
- [ ] 单元结束有独立首次/辅助完成数量；未审核内容在预览环境明显标识。

验证：`npm run test:unit -- tests/unit/practice-ui.spec.ts`。组件测试包含仅触屏点击完成组句、键盘Enter/Space可选择、错误反馈aria-live、状态恢复。

M1门禁：真实运行一个短单元，页面刷新后继续；至少一台手机验证触控。此时只验基础流程，不宣称全题型完成。

## T06 阅读与七选五

依赖：T05。预计2-3日。覆盖P04阅读/七选五。

文件：`src/components/PassagePanel.vue`、`src/features/practice/GapTask.vue`、`src/features/practice/SessionPage.vue`、`tests/unit/reading.spec.ts`、`tests/unit/gaps.spec.ts`。

- [ ] 阅读共享Resource；手机切换文章/题目保留滚动位置，平板宽屏双栏。
- [ ] 提交后可点击evidence跳转段落，高亮匹配文本但不改变原文；提示前不展示答案依据。
- [ ] 七选五点击空位后选择共享选项；已占用选项显示在哪个空，点击时提供移动确认，不产生重复占用。
- [ ] 支持撤销该空、替换、清空；未答空不默认为A。
- [ ] 判分每空1分，5空全对组才算通过；一次提交保存完整answer map。
- [ ] 测试共享材料不重复加载、不在手机跳顶；重复选项拒绝、交换选项后结果正确。

验证：`npm run test:unit -- tests/unit/reading.spec.ts tests/unit/gaps.spec.ts`。样例七选五给出a/b/c/d/e得5/5；一个错误一个空白得3/5；非法重复a不接受提交。

## T07 完形与语法填空

依赖：T05，GapTask接口与T06协调。预计1-2日。

文件：`src/features/practice/GapTask.vue`、`src/domain/answers.ts`、`tests/unit/cloze-grammar.spec.ts`。

- [ ] 为每空独立选项建立触屏面板，与七选五共享渲染框架但不共享选项约束。
- [ ] text模式显示clue提示词和输入框；自动保存草稿，不把草稿计成作答。
- [ ] 多个accepted变体逐一按policy归一化比较；不会把单数自动改成复数。
- [ ] 软键盘出现时当前空、原文上下文、提交按钮仍可见；Next只移动焦点，不自动交卷。
- [ ] 新内容发布后未完成旧会话仍使用旧accepted，避免答案突然变化。

验证：`npm run test:unit -- tests/unit/cloze-grammar.spec.ts`。样例meets正确、meet错误、空白为0；two-gap完形a/c得2/2；替换内容版本后旧会话结果保持一致。

## T08 音频与听力

依赖：T05，内容资产流程依赖T02。预计2-3日。

文件：`src/components/AudioPlayer.vue`、`src/services/learning.ts`、`tests/fixtures/audio/preview.mp3`、`tests/fixtures/listening-pack.json`、`tests/unit/audio.spec.ts`、`tests/e2e/listening.spec.ts`。

- [ ] 准备一段原创短对话，由真实语音录制或构建时合成；人工核对。此文件才写入资产实际hash，不能用占位文件满足内容门禁。
- [ ] 通过用户点击调用HTMLAudioElement.play，捕获Promise拒绝并显示重试。
- [ ] 支持暂停/重播/0.75与1倍速度；记录回放和辅助，离开题组停止音频。
- [ ] 字幕和中文提示显式开启，开启前经revealHint保存辅助状态。
- [ ] 音频缺失、离线无缓存、加载失败时可跳过或返回下载，不计听力错误。
- [ ] 自动化验证状态机；iPhone与安卓真实播放用人工清单补验，不用jsdom声称音频正常。

验证：`npm run test:unit -- tests/unit/audio.spec.ts`。Playwright听力测试在T14配置后运行。失败用例：play抛NotAllowedError时Attempt数不增加；字幕开启后的答对不计独立听辨。

## T09 应用文与读后续写

依赖：T05。预计2-3日。覆盖P04写作、D08。

文件：`src/features/writing/WritingPage.vue`、`src/services/writing.ts`、`tests/unit/writing.spec.ts`、`tests/e2e/writing.spec.ts`。

- [ ] 页面提供审题要求、可选提纲、正文、自评表；续写同时展示原文和两个段首句。
- [ ] 500ms串行保存，saveDraft显式revision；离开前等待最后写入。保存失败保留文本和复制按钮。
- [ ] finalizeWriting先保存最新正文再冻结初稿；修改在新版本操作，首稿不可覆盖。
- [ ] 写作提交使对应slot变为submitted并推进session.revision，但不产生客观Attempt/正确率。
- [ ] 显式请求范文后记录model-answer辅助；展示句段对比和自评勾选，不显示自动考试分。
- [ ] 用英文单词规则计数：连续英文字母、内部撇号或连字符视为一个单词；数字不计英语词，提示范围内外不改变通过状态。
- [ ] 测试连续输入后立即离开、两页并发编辑、存储失败、保存后断网、初稿与修改稿对比。

验证：`npm run test:unit -- tests/unit/writing.spec.ts`。输入draft1并保存初稿，再输入draft2保存修改稿；重开后两版本都存在，自评不出现在客观成绩分母。

## T10 今日任务、复习与难度建议

依赖：T06-T09。预计2-3日。覆盖P02/P03、D07。

文件：`src/domain/calendar.ts`、`src/domain/scheduler.ts`、`src/domain/planner.ts`、`src/features/today/TodayPage.vue`、`src/features/review/ReviewPage.vue`、`tests/unit/scheduler.spec.ts`、`tests/unit/planner.spec.ts`。

- [ ] 扩展T04已实现的studyDay与addCalendarDays回归，默认时区Asia/Shanghai；测试跨月、跨年、闰年和DST。
- [ ] 将T04的D07间隔规则接入复习列表与今日计划，复习状态key包含recognition/recall/transfer。
- [ ] planner根据预算选整组，dueDay优先，新目标<=5；无可用题给真实空态，不制造死循环。
- [ ] 题目曝光排除holdout，熟题重试不计未见题；内容不足时显示需补充平行材料。
- [ ] 升级建议按P03阈值，记录样本数与范围；用户可忽略建议。
- [ ] 冻结每日会话抽题结果，刷新/日期变化不会更换当前题，次日另建计划。

写入`tests/unit/scheduler.spec.ts`：

```ts
import { expect, it } from 'vitest';
import { scheduleReview } from '../../src/domain/scheduler';

it('schedules first success tomorrow and ignores same-day repeats', () => {
  const first = scheduleReview(null, 'independent-pass', '2026-09-08');
  expect(first).toEqual({stage:0,dueDay:'2026-09-09',lastAppliedDay:'2026-09-08',lapses:0});
  expect(scheduleReview(first, 'independent-pass', '2026-09-08')).toEqual(first);
  const next = scheduleReview(first, 'independent-pass', '2026-09-09');
  expect(next.stage).toBe(1);
  expect(next.dueDay).toBe('2026-09-12');
});
it('resets a failed due review without rewarding its correction', () => {
  const old = {stage:2 as const,dueDay:'2026-09-08',lastAppliedDay:'2026-09-01',lapses:0};
  const failed = scheduleReview(old, 'needs-help', '2026-09-08');
  expect(failed).toEqual({stage:0,dueDay:'2026-09-09',lastAppliedDay:'2026-09-08',lapses:1});
});
```

其他固定用例：5分钟不能装入预计360秒的七选五；10个过期组只装入预算内部分，其余仍到期；已经见过但跳过的题不当成holdout；correctAnswer不调用scheduler。

验证：`npm run test:unit -- tests/unit/scheduler.spec.ts tests/unit/planner.spec.ts`。

## T11 成长记录与兴趣反馈

依赖：T10。预计1-2日。

文件：`src/domain/progress.ts`、`src/features/progress/ProgressPage.vue`、`src/components/FeedbackPanel.vue`、`tests/unit/progress.spec.ts`。

- [ ] 实现首次独立客观正确率、提示后完成数、学习日、未见题数量、作品卡。
- [ ] 地图节点按实际课程内容生成；首次完成单元获得固定achievement key，重复提交不重复解锁。
- [ ] 自评只标自评；少于样本阈值显示数量，不算正式能力等级。
- [ ] 展示本周与前期可比较任务；题型/层级不同则分开，不画误导性统一提分曲线。
- [ ] 开关音效/动画，低动画偏好下无奖励闪动；漏学保留累计成果。

验证：`npm run test:unit -- tests/unit/progress.spec.ts`。首次错后改对仍保留首次错误；重复同题10次不增加独立题数；单元奖励只1条；writing不进入客观分母。

## T12 PWA、课程下载和更新

依赖：T10，媒体依赖T08。预计2-3日。覆盖D09。

文件：`src/pwa/register.ts`、`src/pwa/sw.ts`、`src/services/downloads.ts`、`src/features/settings/DownloadsPage.vue`、`vite.config.ts`、`public/icons/icon-192.png`、`public/icons/icon-512.png`、`public/icons/maskable-512.png`、`tests/unit/downloads.spec.ts`、`tests/e2e/offline.spec.ts`。

- [ ] vite-plugin-pwa使用injectManifest，自定义SW仅precache应用shell；课程由download service按版本cache，不把所有题库塞进precache。
- [ ] manifest设置name、short_name、start_url、scope、standalone及真实尺寸图标；iOS提供“添加主屏幕”的平台说明。
- [ ] 实现catalog读取、下载、摘要校验、准备就绪标记与启动对账。
- [ ] 模拟下载中断、quota错误、hash不匹配、DB写入失败，保持旧ready版本可用。
- [ ] SW有新版本时先提示，活动会话不自动重载；更新后旧课程引用仍可访问。
- [ ] 区分浏览器可访问、主屏幕快捷方式和独立应用；国产安卓浏览器结果单独记录。

验证：`npm run test:unit -- tests/unit/downloads.spec.ts`、生产build后的offline.spec。断网刷新须能打开已下载题和音频；只缓存shell不算离线课程通过。

## T13 导出、恢复与存储失败

依赖：T09/T12。预计1-2日。覆盖D09/D10。

文件：`src/data/backup.ts`、`src/features/settings/BackupPage.vue`、`src/features/settings/SettingsPage.vue`、`tests/unit/backup.spec.ts`、`tests/e2e/backup.spec.ts`。

- [ ] 实现D09 envelope与确定性JSON摘要，导出记录和被引用的课程JSON，不包含缓存媒体。
- [ ] 导入先限制体积再解析、校验摘要/schema/外键，展示数量与替换范围。
- [ ] 明确确认后单事务恢复所有学习表；任何失败回滚，不采用一边读一边覆盖。
- [ ] 恢复后为未缓存音频标缺资源；历史成绩和写作仍可查看。
- [ ] 建立Safari安装前备份和安装后空库导入引导；不承诺浏览器存储永久存在。
- [ ] 清除数据需二次明确操作，不能与清除缓存共用一个按钮。

验证：`npm run test:unit -- tests/unit/backup.spec.ts`。导出A -> 新DB恢复B -> 逐表记录相等；破损摘要、未来schema、孤立Attempt拒绝，B原有记录不变；50MiB+1字节拒绝。

## T14 自动化回归与质量门禁

依赖：T11-T13。预计2日。

文件：`playwright.config.ts`、`tests/e2e/learning.spec.ts`、`tests/e2e/mobile-layout.spec.ts`及前面任务预留spec，仓库级`.github/workflows/english-practice-ci.yml`。

- [ ] 配置Chromium/WebKit/Firefox基础流程；手机和平板viewport回归，注意WebKit模拟不是iOS真机。
- [ ] 使用生产构建和preview，`reuseExistingServer=false`、端口4174、单独测试输出目录，防止连到其他项目服务。
- [ ] 测试用内容加载器仅在`VITE_E2E=true`构建提供固定fixtures，生产默认关闭；不能为测试关闭校验或修改评分。
- [ ] clock通过服务层依赖注入，避免测试等待真实7天；e2e的测试时钟/种子入口只能存在于E2E构建。
- [ ] CI用Node24、应用目录npm ci、安装Playwright浏览器、check/build/e2e；失败保留trace与截图，报告去除学习正文。
- [ ] 发布构建另跑一次不含VITE_E2E的build与冒烟，避免误发测试入口。

基本页面测试写入`tests/e2e/learning.spec.ts`；fixture默认启动到未提交的词义题：

```ts
import { expect, test } from '@playwright/test';

test('touch-first task persists after reload', async ({ page }) => {
  await page.goto('/#/today');
  await page.getByRole('button', { name: '开始今日练习', exact: true }).click();
  await page.getByRole('button', { name: '加入', exact: true }).click();
  await page.getByRole('button', { name: '提交答案', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存');
  await page.reload();
  await expect(page.getByTestId('first-attempt-result')).toContainText('正确');
});
```

E2E至少覆盖：首次进入、所有题型、订正、未答空确认、暂停恢复、写作、复习跨日、断网重开、缓存损坏、备份恢复、软键盘布局、200%文字缩放。单元测试至少覆盖业务分支而不是只验证组件存在。

验证命令（应用目录）：

```bash
npm ci
npm run check
npm run build
npx playwright install chromium webkit firefox
VITE_E2E=true npm run build
npm run test:e2e
npm run build
```

最后一次build恢复正式构建。真实发布再执行content:release，不能用preview内容门禁替代。

## T15 正式课程包生产与独立审核

依赖：T02开始并行，发布依赖T06-T09实际渲染验证。内容投入15-25日另计。

文件：`content/sources/catalog.json`、`content/profiles/gaokao-common-training-v1.json`、`content/items/*.json`、`content/resources/*.json`、`content/units/*.json`、`content/skills.json`、`content/review-log.csv`、`scripts/check-content.ts`。

- [ ] 固定skillIds目录：vocab.context/collocation/polysemy、sentence.core、grammar.tense/agreement/article/preposition/pronoun/word-form/infinitive/clause/comparison、reading.detail/main-idea/inference/word-meaning/cohesion、cloze.context/logic、listening.detail/inference、writing.task/organization/coherence/accuracy。
- [ ] 按P07分配718个客观作答项与10个写作任务，区分调度组和原子题数。
- [ ] 每个题目家族写不同题干的平行版本；不要只交换选项就声称未见迁移。
- [ ] 建立30次学习推荐，长文专项不硬塞进短时任务；内容映射学习技能与层级。
- [ ] 逐题审核正确答案、合理变体、干扰项、中文解析、证据定位；逐段听审音频。
- [ ] review-log字段固定为packId/version/itemId/author/reviewer/reviewedAt/result/notes；只有真实审核通过才发布，不填写虚构审核人。
- [ ] `content:release`交叉验证审核记录与包状态、数量、技能覆盖、资源摘要；失败不出正式catalog。

验证：`npm run content:release`必须exit0；内容抽查不是替代完整答案复核。缺少独立审核人时继续完成工具和draft课程，明确剩余内容审核门禁，不能把机器自检当作审核完成。

## T16 HTTPS部署准备与真机验收

依赖：T14/T15。预计2-3日。仓库文件：`planning/gaokao-english/device-matrix.md`、`planning/gaokao-english/deployment-runbook.md`，发布静态产物为应用dist。

- [ ] 构建独立静态站，选用户已有可用HTTPS托管入口；默认不修改原书稿GitHub Pages地址。准备可审查的发布产物后按实际发布授权执行。
- [ ] catalog和SW使用可更新缓存头，带hash的版本化素材长期缓存；HTTPS无混合内容，手机可实际访问。
- [ ] 记录build SHA、应用版本、内容包版本；从手机页面确认版本而不是只看本机构建日志。
- [ ] 在iPhone、iPad、安卓手机、安卓平板分别完成：首次加载、主屏幕进入、离线重开、音频、软键盘、分屏/旋转、备份恢复、课程更新。
- [ ] 检查Safari标签页与主屏幕空库迁移；国产安卓浏览器不支持安装时仍提供网页使用说明。
- [ ] 资源暂不可达时可退回上一静态构建；不回滚个人数据到旧schema。课程更新保持不可变版本。

验收矩阵每行：设备型号/系统/浏览器版本、场景、结果、证据路径、构建SHA、未解决问题。不写“全平台通过”除非四类真机都有真实记录。

## T17 七天试用与v0.1验收

依赖：T16。预计7自然日使用，另3-5工作日整理和修复（包含在M4估算）。

文件：`planning/gaokao-english/pilot-report.md`、`planning/gaokao-english/verification-log.md`，按发现问题修改其所属模块。

- [ ] 使用者首次独立完成一个基础单元，记录需要帮助的操作；不以开发者演示代替用户试用。
- [ ] 每天保留任务完成、实际时长、独立首次表现、主观难度、是否愿意再练；只保存所需汇总。
- [ ] 第7天从未曝光的平行题中抽取同技能同层级题，保持辅助条件一致。
- [ ] 数据丢失、答案错判、无法退出/恢复、音频阻断属于阻塞问题，修复并复测后才发布。
- [ ] 输出真实结果与局限：单人试用不能推断稳定提分，兴趣改善只说明该用户当期反馈。
- [ ] 对照P09逐条验收，全部真实通过才标v0.1完成；缺内容审核/真机/试用记录则分别保留未完成状态。

## 需求到任务映射

| 需求 | 实施任务 | 必须留下的证据 |
| --- | --- | --- |
| 高考通用范围与地区差异 | T02/T15 | 默认profile不允许整卷计分 |
| 触屏练习与低起点 | T05/T06/T07 | 组件测试、真机完成一个单元 |
| 听力 | T08/T12/T16 | 错误降级、缓存音频和真机播放 |
| 应用文/续写 | T09 | 初稿/修改稿恢复，无伪造自动分 |
| 复习与真实掌握 | T04/T10/T11 | 幂等、日期、提示与未见题测试 |
| 兴趣与成果 | T11/T17 | 不刷奖励、真实试用反馈 |
| 本地可靠保存 | T03/T04/T09 | 重开、并发、写入失败回滚 |
| 离线与更新 | T12/T16 | 下载中断、版本保留、断网真机 |
| 导出与恢复 | T13 | 另一设备恢复、损坏文件拒绝 |
| 内容质量 | T02/T15 | 完整数量、校验、独立审核 |
| 原仓库兼容 | T01/T14 | 独立命令；涉及原脚本时跑原站点检查 |

## 后续范围，不能混入首版完成承诺

跨设备自动同步需要独立身份和同步冲突设计；跟读需要录音权限、媒体存储和删除流程；AI反馈需要服务端密钥、用量控制与反馈质量验证；省份整卷模拟需要对应年份官方卷型和真实评分规则。这四项独立立项，不通过增加几个UI按钮宣布已支持。
