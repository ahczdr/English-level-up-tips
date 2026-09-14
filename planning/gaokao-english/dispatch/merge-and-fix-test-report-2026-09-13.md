# 合并与收尾测试报告（english-practice v0.1）

日期：2026-09-13。执行：GLM-5.3-Flash（ZCode 会话）。范围：应用合入主仓库、评审遗留收尾修复、全量回归门禁。详细过程记录见 `verification-log.md` §22（合并收尾）、§21（CR1–CR5 修复）、§19/§20（T16/T17）。

## 1. 本轮交付内容

| 项 | 内容 | 状态 |
| --- | --- | --- |
| 交付落地 | `apps/english-practice` 合入主仓库（含 T01–T17 全部成果与 CR1–CR5/CR12.5 修复）；planning 补齐 deployment-runbook / device-matrix / pilot-report；CI 工作流落地（两 job 注入 BUILD_SHA） | ✅ |
| db.spec 韧性用例补回 | 「v2→v3 迁移失败时拒绝打开且已升级数据完整保留」——修复 T16 截断事故丢失的测试 | ✅ |
| 设置页偏好字段 | SettingsPage 补年级/目标/默认时长（经设置服务读写，消除绕过服务的直写） | ✅ |
| onboarding 可达性 | TodayPage 首启（无 personal 记录）显示引导卡，打通 /onboarding 孤儿路由；保存/跳过后消失 | ✅ |
| 新增测试 | tests/unit/onboarding-setup.spec.ts 3 项 + db.spec 1 项 | ✅ |

## 2. 门禁结果（合并后终态代码）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 内容/类型/静态/单测 | `npm run check` | **279/279**（29 文件）；typecheck 0 错误；lint 0 错误（112 条既有 vue 风格 warnings） |
| 生产构建 | `npm run build:release` | exit 0；release-info.json 生成（0.1.0 unversioned + 6 包清单） |
| E2E（E2E 构建 + 生产 preview） | `npm run test:e2e` | 主配置 **29/29**（Chromium 全量 23 + Firefox/WebKit 基础流程各 3）+ 离线 **3/3** |
| 发布冒烟 | `node scripts/smoke-release.mjs` | **SMOKE OK**（dist 无 fixtures 痕迹、shell 标题、无 E2E 桥、SW 注册、release-info 与 BUILD_SHA 一致） |

新增用例验证点：

1. db.spec「迁移失败韧性」：v3 upgrade 抛错 → `db.open()` reject 原错误 → 重开库后 v2 数据（settings）完整。钉住 Dexie 升级失败不写坏存量数据的不变量。
2. onboarding-setup「空库默认值 + 合并保存」：默认空值显示；选择年级/目标/时长后 personal 记录为完整合并形状（含 profileId/sound/timeZone 默认值）。
3. onboarding-setup「回显与保留」：预置 grade/_goal/25 分钟/UTC/静音 → 字段正确回显；仅改年级保存 → 其余字段不被覆盖。
4. onboarding-setup「首启入口出现/消失」：无 personal 记录 → 今日页出现「前往学习设置」；保存后再次进入 → 入口消失。

## 3. 环境怪癖记录（非产品缺陷）

本机自动化框架把长时命令转入后台沙箱执行时，`smoke-release.mjs` 的 loopback fetch 与 vitest 启动会以 0% CPU 无限挂起（采样显示主进程空闲于事件循环、无 socket、无 worker）；同一命令非沙箱前台裸调用全部正常。CI（ubuntu）不受影响。本地复跑冒烟建议直接 `node scripts/smoke-release.mjs`，勿经 npm/管道包装。

## 4. 未完成移交（如实声明）

1. **正式内容**：P07 要求约 718 项（词汇 360+、阅读 54、完形/语法/听力等最低量），现库 11 项；独立人工审核未做 → `npm run content:release` BLOCKED，正式 catalog 禁止生成。需内容作者 + 与作者不同的独立审核者。
2. **真机**：device-matrix 四类设备 × 8 场景全部未执行（无真机）；v1→v2 迁移未在真机验证。
3. **试用**：七天真人试用未开始；pilot-report D1–D7 为占位；第 7 天平行题抽取待真实备份产生后运行 `npm run pilot:day7`。
4. **发布**：HTTPS 托管入口与发布授权待定；回滚演练未执行。v0.1 不标注完成。
5. **代码待办池**：评审清单 CR6–CR12（暂停/退出草稿保护一致性、复习列表可用性、卸载包统计口径、恢复后音频提示、重复实现抽取、STALE 自动恢复、备份体积治理）；112 条 lint warnings 可 `--fix` 消化。
6. **文档**：根 README/CHANGELOG 尚未向读者介绍应用。

## 5. 结论

应用 v0.1 的**全部可自动化验收项**在合并后的主仓库基线上通过；阻塞正式发布的三件事均不属于代码范畴——内容编写与独立审核、真机验收、真人试用。当前状态允许以 draft（预览内容、受控入口）做真机验收与试用，与 deployment-runbook 的口径一致。
