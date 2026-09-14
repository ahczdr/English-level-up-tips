# T14 后全量代码评审（静态审查）

版本：1.0，2026-09-12。评审人：GLM-5.3-Flash（ZCode 会话内独立通读）。
性质：**静态代码评审，不是独立验收**。未复跑任何测试、构建或浏览器验证，未修改产品代码，不改变 T01–T14 的验收状态。发现项供主代理派发修复任务时引用。

## A. 评审范围与基线

- 代码基线：隔离工作树 `/private/tmp/gaokao-english-glm-worktree/apps/english-practice`（分支 `codex/gaokao-english-glm`，基线 `7478ac2`）。评审时工作树存在且完整。
- 阅读范围：`src/` 全部 39 个 TS/Vue 文件（约 6900 行）、`scripts/`（check-content、build-packs、release-gates、smoke-release、sync-e2e-fixtures）、`package.json`、`vite.config.ts`，并用 grep 抽查了状态机写入点、删除逻辑与 profileId 过滤。单元/E2E 测试文件未逐行阅读，只核对覆盖声明。
- 本文件所有相对代码路径以 `apps/english-practice/` 为根（沿用规划 README 约定）。
- 工作树位于 `/private/tmp`，重启即失；合入主仓库前本评审的行号引用可能漂移，已尽量用函数名+行号双定位。

## B. 总体评价

质量高于一般 v0.1 水位：TDD 痕迹扎实；服务层统一 `Result<T>` 错误协议与中文用户消息；备份含递归键排序摘要、危险键拒绝、外键与重复 ID 校验；下载状态机含中断对账与旧字节保留；E2E 时钟桥只在测试构建存在且被发布冒烟钉住；内容校验（schema + 跨引用 + 证据引用原文子串）完整。以下发现多为「随数据量增长显现」或「路径间一致性问题」，无阻断发布的缺陷。

## C. 发现清单总表

| ID | 级别 | 主题 | 位置 |
| --- | --- | --- | --- |
| CR1 | P1 | 会话永不到达 `completed`，且无清理策略 | src/data/migrations.ts:6 |
| CR2 | P1 | 升层证据与曝光表未按 profileId 过滤（数据模型缺口） | src/services/learning.ts:255 |
| CR3 | P2 | 每次交互全表扫描 packs；getSessionSummary N+1 | src/services/learning.ts:459 等 |
| CR4 | P2 | createTodaySession 同日冻结存在竞态 | src/services/learning.ts:205 |
| CR5 | P3 | CI 单次运行约 3 个 vite 构建 | package.json（build:e2e） |
| CR6 | P3 | 暂停绕过未保存草稿确认；choice/order 不落草稿 | src/features/practice/SessionPage.vue:589 |
| CR7 | P3 | 复习列表展示原始 familyId/reviewMode 且无行动入口 | src/features/review/ReviewPage.vue:88 |
| CR8 | P3 | 卸载课程包后历史作答被静默剔除出统计 | src/features/progress/ProgressPage.vue:78 |
| CR9 | P3 | 恢复备份后音频提示与实际可用性不符 | src/data/backup.ts:269 |
| CR10 | P4 | 三处刻意复制的重复实现 | src/services/learning.ts:94 |
| CR11 | P4 | STALE_SESSION 客观题路径无自动恢复（写作路径已有） | src/features/practice/SessionPage.vue:471 |
| CR12 | P4 | 杂项（见 §E） | 多处 |

P1=随时间必然恶化或锁死未来演进；P2=真实竞态/性能；P3=体验与数据口径一致性；P4=代码卫生与低风险杂项。

## D. 详细发现

### CR1（P1）会话状态机缺 `completed`，无数据治理

- `SessionState` 定义了 `completed`（src/data/migrations.ts:6），但全代码无任何写入点（`changeState` 只用于 pause/resume）。所有会话永久停留 `active`/`paused`；sessions/attempts/exposures/drafts 无任何删除逻辑（grep 确认仅 SettingsPage 全清一处）。
- 后果：TodayPage「继续上次练习」无限累积；`collectLevelUpEvidence` 与 ProgressPage 全量扫描的数据逐年增长；50 MiB 备份上限最终必被撞上（BackupPage 导出侧已有超限提示，但那是被动兜底）。
- 建议：所有 slot 提交/跳过完毕进入 summary 时置 `completed`；制定清理策略（如 completed 会话仅保留最近 N 个，清理时级联处理该会话的 drafts；attempts/exposures 作为统计底账建议保留并可另行归档）。schema 已有 `state` 索引，无需迁移。

### CR2（P1）多 profile 数据模型缺口

- `collectLevelUpEvidence`（src/services/learning.ts:255）签名接收 `profileId` 但从未使用：`db.attempts.toArray()` 后仅按 phase 过滤，不分 profile。`AttemptRecord` 与 `Exposure` 表均无 profileId 字段。
- 当前单 profile（`gaokao-common-training-v1`）无害；但 attempts/exposures 是要长期沉淀的底账，一旦引入 profile 概念，正确率、连续错误、曝光判定全部跨 profile 混算，且 Dexie 补索引需要版本迁移，越晚越贵。
- 建议：趁 schema 未冻结（仍是 version 1），给 attempts/exposures 补 profileId 列与索引，`collectLevelUpEvidence`、ProgressPage 按 profile 过滤；随数据迁移一并升 schemaVersion 2。

### CR3（P2）packs 全表扫描 + N+1 查询

- `findInstalledPack`、`verifySlotContent`、`enterCurrentSlot`、`loadSlotContent` 每次调用 `db.packs.toArray()`。一次切题路径扫 3–4 遍；P07 正式内容约 700+ 条目后 pack JSON 达 MB 级。
- `getSessionSummary`（src/services/sessionFlow.ts:76）对每个 slot 逐条 `attempts.where(...).first()` + `exposures.get()`，为 2N+1 次查询。
- 建议：加模块级 `Map<"id@version", CoursePack>` 缓存（安装/恢复/对账时失效）；getSessionSummary 改为一次 `where('sessionId').equals()` 拉回后内存分组。`collectLevelUpEvidence` 与 `collectTodayPlanBundle` 同理可减表扫描，可并入同一任务。

### CR4（P2）createTodaySession 同日冻结竞态

- src/services/learning.ts:205：先读 settings marker、await 后再 `sessions.add`，两步间无事务；并发双击（UI 有 `starting` 闸，服务层无）可创建两个会话，marker 后写者胜出，另一会话成为孤儿。
- 建议：整个「查 marker → 建 session → 写 marker」包进 `db.transaction('rw', db.sessions, db.settings, ...)`。

### CR5（P3）CI 构建次数冗余

- `build:e2e` = `npm run build`（typecheck+content:check+content:build+vite build）+ `VITE_E2E=true vite build`。quality job 实际执行 check → build:release → test:e2e（内含两次构建），单次 CI 约 3 个完整 vite 构建。
- 建议：拆出独立 `vite build` 步骤供 e2e 复用，或 `build:e2e` 接受 `SKIP_GATE=1` 跳过 typecheck/content 前置（CI 已单独跑过 check）。

### CR6（P3）离开路径的草稿保护不一致

- `requestExit` 检查 `hasUnsavedDraft` 并弹确认（SessionPage.vue:602），`pause`（:589）直接跳走；写作有 flushPending 保护，choice/order 的已选项完全不落草稿（`watch(draft)` 只持久化 gaps，:171 注释为 T07 设计范围）。
- 建议：pause 走与 requestExit 相同的确认；中期考虑 choice/order 也存草稿（drafts 表结构已支持，Answer 全类型可序列化）。

### CR7（P3）复习列表可用性

- ReviewPage 直接展示 `familyId`/`reviewMode` 原始 ID（如 `cloze-help-family · recall`），目标用户为基础薄弱高中生；且页面纯只读，复习实际靠今日计划的 due 优先级。
- 建议：显示题型/家族中文标签（需从已安装包反查 familyId→单元），并提供到「开始今日计划」的行动入口；或将该页并入成长页。

### CR8（P3）卸载包后统计静默缩水

- ProgressPage 的 `itemIndex` 只含已安装包条目，历史 attempt 找不到 item 即整行剔除（:81 返回 null）——删除课程包会让正确率、独立题数「倒退」。
- 建议：kind/level 未知的行保留计数、不参与题型分组；或在卸载入口提示统计影响。

### CR9（P3）恢复后音频口径矛盾

- `restoreBackup`（src/data/backup.ts:269）把含资产包的 `resourcesReady` 置 false 并提示「N 个课程包音频需重新下载」，但旧 `downloadJobs` 字节未清除，`getPackAssetBytes` 按字节存在性读取——音频实际立即可用。
- 建议：二选一并写进口径——恢复时保留旧字节且重算提示为「已保留/需补齐差额」，或恢复时清 downloadJobs 与提示一致。

### CR10（P4）刻意复制的重复实现

- `mergeBySharedResource`（learning.ts:94）与 createSession 内联实现（:310）重复，注释自述「独立实现避免回归」；`firstUnfinished` 在 sessionFlow.ts:26 与 SessionPage.vue:124 重复。
- 建议：抽为共享纯函数并以单测钉住（防回归应由测试承担，不应由复制承担）。

### CR11（P4）STALE 恢复不一致

- 客观题提交遇 `STALE_SESSION` 只提示手动刷新（SessionPage.vue:471 分支）；写作路径已实现 `resyncRevision()` 自动恢复。建议客观题同样自动 `loadSession` 重取。

### CR12（P4）杂项

1. TodayPage「开始今日练习」按钮实际只跳 `/learn`，旁边另有「前往课程列表」链接，双入口同指且按钮文案误导。
2. 备份 payload 每份内嵌完整课程包 JSON 快照（可再下载、有 sha256 校验）；正式内容上线后备份显著膨胀。可考虑省略 packs 或在导出提示给体积构成。
3. validate.ts:212 的 HTML 标签检查对「a < b > c」类正文可能误报；内容经 Vue 插值转义，属防线收窄问题。
4. AudioPlayer.replay 在 `play()` 被拒时仍计 replayCount，轻微失真。
5. 被放弃会话的 drafts 永不清除（提交/跳过才清）；可随 CR1 的清理策略一并处理。
6. SettingsPage.savePrefs 绕过 `loadPersonalSettings` 的字段校验直写 settings 表（当前字段受限无害，属一致性）。

## E. 建议动手顺序

CR1 → CR2（趁 schemaVersion=1 未发布，合并为一次迁移）→ CR3 → CR4 → CR5；CR6–CR12 攒入 T15+ 待办池随任务搭车处理。每项修复按合同走「先写规则用例 → 红灯 → 实现 → 绿灯」，并在 `verification-log.md` 追加记录。

## F. 未验证项

- 本评审未运行任何命令；所有行为推断来自静态阅读，竞态（CR4）与性能（CR3）未实测。
- tests/unit、tests/e2e 共 30 个 spec 文件未逐行审阅，测试真实性以既有 verification-log 记录为准。
- `content/` 下 JSON 素材只核对结构来源（build-packs/check-content 链路），未审内容质量（内容审核另行由 T15 门禁与人审承担）。

## G. 修复记录（2026-09-13 更新）

按 §E 顺序完成 **CR1、CR2、CR3、CR4、CR5 及 CR12.5**（随 CR1），实现与验证详录见 `verification-log.md` 第二十一节。要点：

- CR1：新增 `completeSession`（事务内置 completed + 清理本会话草稿，幂等），SessionPage 进总结前接线；`completed` 不再是死状态。
- CR2：DB schema v2——attempts/exposures 增 profileId 列与索引并按 sessions 回填（孤儿行落默认 profile）；证据/计划/成长页按 profile 过滤；恢复备份回填旧备份行。
- CR3：新增 `src/data/pack-reader.ts` 读取缓存，失效唯一机制为 createDatabase 注册的 packs CRUD 钩子（自动覆盖旁路写入）；`getSessionSummary` 去 N+1。
- CR4：createTodaySession 复用判定+建会话+写 marker 收进同一事务，并发复现用例（race-a/race-b 双会话）转绿。
- CR5：build:vite 拆分，build:e2e 改为门禁 + sync-e2e-fixtures（首次真实接线）+ 单次 E2E vite 构建；CI 少一次完整 vite 构建。

门禁终态：check **275/275**、build 通过、test:e2e **29+3 全绿**、发布冒烟 **SMOKE OK**。

**仍开放**：CR6、CR7、CR8、CR9、CR10、CR11、CR12.1/12.2/12.3/12.4/12.6（CR12.2 备份体积治理随 completed 会话归档策略一并考虑）。§D 中其余行号引用基于评审时快照，已在修复中部分位移，以 verification-log 21.2 的函数级描述为准。
